from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from core.db import engine
from models.core import AuditLog, AutomationJob, Experiment, SchoolSyncSnapshot, Submission, User, get_utc_now
from services.school_overview_sync import (
    SchoolAutomationError,
    deep_get,
    extract_report_list,
    load_active_config,
    map_school_status,
    perform_school_overview_sync,
    safe_int,
    set_job_progress,
    wait_for_loading_to_disappear,
)
from services.school_dom import SchoolDomTimeout, read_locator_value, wait_for_locator_value
from services.school_session_manager import school_session_manager


BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = BACKEND_ROOT / "configs"
ARTIFACT_ROOT = BACKEND_ROOT / "tmp" / "school_report_sync"


@dataclass
class SchoolReportOpenResult:
    experiment_name: str
    school_status: Optional[Dict[str, str]]
    snapshot: Dict[str, Any]
    summary: Dict[str, Any]
    artifacts: Dict[str, str]
    session_diagnostic: Dict[str, Any]


def _artifact_dir(job_id: str) -> Path:
    path = ARTIFACT_ROOT / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read_experiment_config(experiment_id: str) -> Dict[str, Any]:
    if "/" in experiment_id or "\\" in experiment_id or ".." in experiment_id:
        return {}
    path = CONFIG_DIR / f"{experiment_id}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _experiment_display_name(session: Session, experiment_id: str, corrected_json: Optional[Dict[str, Any]] = None) -> str:
    if corrected_json:
        name = corrected_json.get("experiment_name") or corrected_json.get("experimentName")
        if name:
            return str(name)

    config_json = _read_experiment_config(experiment_id)
    name = ((config_json.get("meta") or {}).get("name") or "").strip()
    if name:
        return name

    experiment = session.get(Experiment, experiment_id)
    return experiment.title if experiment and experiment.title else experiment_id


async def _return_to_report_list(page: Any, config: Dict[str, Any]) -> None:
    report_nav = deep_get(config, "selectors.dashboard.reportNav", "#reportA")
    default_timeout_ms = safe_int(deep_get(config, "runtime.defaultTimeoutMs"), 30000)
    row_selector = deep_get(config, "selectors.dashboard.reportTableRows", "tbody[data-bind='foreach: CompleteReportList'] tr")
    if await page.locator(report_nav).count() > 0:
        await page.locator(report_nav).first.click()
    try:
        await page.wait_for_load_state("networkidle", timeout=default_timeout_ms)
    except Exception:
        pass
    await wait_for_loading_to_disappear(page, default_timeout_ms)
    await page.locator(row_selector).first.wait_for(state="visible", timeout=default_timeout_ms)


async def _close_modal_if_present(page: Any, config: Dict[str, Any]) -> None:
    close_selector = deep_get(config, "selectors.modal.close", "#ReportModal button:has-text('关闭')")
    for selector in [close_selector, "#ReportModal .close", "#ReportModal button:has-text('关闭')", ".bootbox .close", ".bootbox button:has-text('OK')", ".bootbox button:has-text('确定')"]:
        try:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click()
                await page.wait_for_timeout(300)
        except Exception:
            continue


async def get_or_login_school_page(job_id: str, user: User, config: Dict[str, Any], connecting_code: str) -> Tuple[Any, Dict[str, Any]]:
    page, diagnostic = await school_session_manager.ensure_report_list(user.id, config)
    if page:
        return page, diagnostic

    set_job_progress(job_id, connecting_code)
    if diagnostic.get("hasSession"):
        await school_session_manager.close(user.id, reason="relogin_required")
    await perform_school_overview_sync(job_id=job_id, user=user, config=config)
    session = school_session_manager.get(user.id)
    if not session:
        raise SchoolAutomationError(
            "SCHOOL_SESSION_UNAVAILABLE",
            "学校系统会话不可用",
            message=json.dumps(diagnostic, ensure_ascii=False),
            current_step=connecting_code,
        )
    page = session.page
    try:
        await _return_to_report_list(page, config)
    except Exception as exc:
        relogin_diagnostic = await school_session_manager.diagnose(user.id, config)
        relogin_diagnostic["reuseDecision"] = "relogin_created_session_but_recovery_failed"
        relogin_diagnostic["recoveryError"] = f"{type(exc).__name__}: {exc}"
        raise SchoolAutomationError(
            "SCHOOL_SESSION_UNAVAILABLE",
            "学校系统会话不可用",
            message=json.dumps(relogin_diagnostic, ensure_ascii=False),
            current_step=connecting_code,
        ) from exc
    relogin_diagnostic = await school_session_manager.diagnose(user.id, config)
    relogin_diagnostic["reuseDecision"] = "relogin_created_session"
    return page, relogin_diagnostic


async def _click_report_open_button(page: Any, config: Dict[str, Any], experiment_name: str, opening_code: str) -> Optional[Dict[str, str]]:
    row_selector = deep_get(config, "selectors.dashboard.reportTableRows", "tbody[data-bind='foreach: CompleteReportList'] tr")
    columns = deep_get(config, "selectors.reportList.columns", {}) or {}
    experiment_idx = safe_int(columns.get("experimentName"), 2)
    status_idx = safe_int(columns.get("status"), 6)
    button_text = deep_get(config, "selectors.reportList.openReportButtonText", "完成报告")
    result = await page.evaluate(
        """
        ({ rowSelector, experimentIdx, statusIdx, buttonText, experimentName }) => {
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const targetName = normalize(experimentName);
          const rows = Array.from(document.querySelectorAll(rowSelector));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            const rowName = normalize(cells[experimentIdx]?.innerText || cells[experimentIdx]?.textContent);
            if (rowName !== targetName && !rowName.includes(targetName) && !targetName.includes(rowName)) continue;
            const statusText = normalize(cells[statusIdx]?.innerText || cells[statusIdx]?.textContent);
            const candidates = Array.from(row.querySelectorAll('input, button, a'));
            const button = candidates.find((el) => {
              const text = normalize(el.value || el.innerText || el.textContent || el.getAttribute('title'));
              return text === buttonText || text.includes(buttonText);
            });
            if (!button) return { found: true, clicked: false, experimentName: rowName, statusText };
            button.click();
            return { found: true, clicked: true, experimentName: rowName, statusText };
          }
          return { found: false, clicked: false };
        }
        """,
        {
            "rowSelector": row_selector,
            "experimentIdx": experiment_idx,
            "statusIdx": status_idx,
            "buttonText": button_text,
            "experimentName": experiment_name,
        },
    )
    if not result.get("found"):
        raise SchoolAutomationError(
            "REPORT_ROW_NOT_FOUND",
            "学校实验列表中未找到对应实验",
            message=f"experimentName={experiment_name}",
            current_step=opening_code,
        )
    if not result.get("clicked"):
        raise SchoolAutomationError(
            "REPORT_OPEN_BUTTON_MISSING",
            "学校实验列表中未找到完成报告按钮",
            message=f"experimentName={experiment_name}",
            current_step=opening_code,
        )
    return {
        "experimentName": result.get("experimentName") or experiment_name,
        "originalStatusText": result.get("statusText") or "",
        "schoolStatus": map_school_status(result.get("statusText") or ""),
    }


async def _wait_for_report_modal(page: Any, config: Dict[str, Any], opening_code: str) -> None:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    timeout_ms = safe_int(deep_get(config, "waitPolicy.modalOpenTimeoutMs"), safe_int(deep_get(config, "runtime.defaultTimeoutMs"), 30000))
    try:
        await page.locator(modal_root).first.wait_for(state="visible", timeout=timeout_ms)
    except Exception as exc:
        raise SchoolAutomationError(
            "REPORT_MODAL_NOT_FOUND",
            "学校实验报告窗口未打开",
            current_step=opening_code,
        ) from exc


async def _read_modal_snapshot(page: Any, config: Dict[str, Any]) -> Dict[str, Any]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    return await page.evaluate(
        """
        (modalRoot) => {
          const root = document.querySelector(modalRoot);
          if (!root) return { values: {}, fields: [], text: '', htmlLength: 0 };
          const values = {};
          const fields = Array.from(root.querySelectorAll('input, textarea, select, [contenteditable="true"]')).map((el) => {
            const key = el.id || el.name || el.getAttribute('data-bind') || '';
            const value = el.matches('[contenteditable="true"]') ? (el.innerHTML || '') : (el.value || '');
            if (key) values[key] = value;
            return {
              id: el.id || '',
              name: el.name || '',
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || '',
              value,
              text: (el.innerText || el.textContent || '').trim()
            };
          });
          return {
            values,
            fields,
            text: (root.innerText || root.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 5000),
            htmlLength: (root.innerHTML || '').length
          };
        }
        """,
        modal_root,
    )


async def _save_modal_artifacts(page: Any, config: Dict[str, Any], out_dir: Path, prefix: str) -> Dict[str, str]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    artifacts: Dict[str, str] = {}
    screenshot_path = out_dir / f"{prefix}_modal.png"
    html_path = out_dir / f"{prefix}_modal.html"
    try:
        await page.locator(modal_root).first.screenshot(path=str(screenshot_path))
        artifacts[f"{prefix}_modal_screenshot"] = str(screenshot_path)
    except Exception:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        artifacts[f"{prefix}_page_screenshot"] = str(screenshot_path)
    html = await page.locator(modal_root).first.evaluate("(el) => el.outerHTML")
    html_path.write_text(html, encoding="utf-8")
    artifacts[f"{prefix}_modal_html"] = str(html_path)
    return artifacts


async def open_report_modal(
    job_id: str,
    user: User,
    experiment_id: str,
    experiment_name: str,
    config: Dict[str, Any],
    *,
    step_group: str,
) -> Tuple[Any, SchoolReportOpenResult]:
    connecting_code = f"school.{step_group}.connecting"
    opening_code = f"school.{step_group}.opening"
    reading_code = "school.detail.reading" if step_group == "detail" else "school.submit.opening"
    page, session_diagnostic = await get_or_login_school_page(job_id, user, config, connecting_code)
    set_job_progress(job_id, opening_code)
    school_status = await _click_report_open_button(page, config, experiment_name, opening_code)
    await _wait_for_report_modal(page, config, opening_code)
    set_job_progress(job_id, reading_code)
    snapshot = await _read_modal_snapshot(page, config)
    out_dir = _artifact_dir(job_id)
    artifacts = await _save_modal_artifacts(page, config, out_dir, "01_open")
    summary = {
        "source": "school_report_modal",
        "experimentName": school_status.get("experimentName") if school_status else experiment_name,
        "originalStatusText": school_status.get("originalStatusText") if school_status else "",
        "schoolStatus": school_status.get("schoolStatus") if school_status else None,
        "fieldCount": len(snapshot.get("fields") or []),
    }
    return page, SchoolReportOpenResult(
        experiment_name=summary["experimentName"] or experiment_name,
        school_status=school_status,
        snapshot={
            "source": "school_report_modal",
            "experimentId": experiment_id,
            "experimentName": summary["experimentName"] or experiment_name,
            **snapshot,
        },
        summary=summary,
        artifacts=artifacts,
        session_diagnostic=session_diagnostic,
    )


def _submission_values(submission: Submission) -> Dict[str, Any]:
    corrected = submission.corrected_json or {}
    values = corrected.get("values")
    return values if isinstance(values, dict) else {}


def _automation_mappings(experiment_id: str) -> List[Dict[str, str]]:
    config_json = _read_experiment_config(experiment_id)
    mappings = ((config_json.get("automation") or {}).get("mappings") or [])
    return [item for item in mappings if item.get("sourceId") and item.get("targetLocator")]


async def _write_one_field(page: Any, modal_root: str, selector: str, value: Any, *, timeout_ms: int) -> str:
    text_value = "" if value is None else str(value)
    locator = page.locator(f"{modal_root} {selector}").first
    if await locator.count() == 0:
        locator = page.locator(selector).first
    if await locator.count() == 0:
        raise SchoolAutomationError("FIELD_SELECTOR_MISSING", "学校表单字段节点缺失", message=f"selector={selector}")
    tag = await locator.evaluate("(el) => el.tagName.toLowerCase()")
    is_contenteditable = await locator.evaluate("(el) => el.isContentEditable")
    if tag in ["input", "textarea", "select"]:
        await locator.fill(text_value)
    elif is_contenteditable:
        await locator.evaluate(
            """
            (el, value) => {
              el.innerHTML = value;
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            """,
            text_value,
        )
    else:
        await locator.evaluate(
            """
            (el, value) => {
              el.textContent = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            """,
            text_value,
        )
    await locator.evaluate("(el) => el.dispatchEvent(new Event('blur', { bubbles: true }))")
    try:
        return await wait_for_locator_value(locator, text_value, timeout_ms=timeout_ms)
    except SchoolDomTimeout:
        return await read_locator_value(locator)


async def _write_and_verify_fields(page: Any, config: Dict[str, Any], submission: Submission) -> List[Dict[str, str]]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    timeout_ms = safe_int(deep_get(config, "waitPolicy.fieldWriteTimeoutMs"), 10000)
    values = _submission_values(submission)
    mappings = _automation_mappings(submission.experiment_id)
    failed: List[Dict[str, str]] = []
    for mapping in mappings:
        source_id = mapping["sourceId"]
        if source_id not in values or values[source_id] in [None, ""]:
            continue
        selector = mapping["targetLocator"]
        expected = str(values[source_id])
        try:
            actual = await _write_one_field(page, modal_root, selector, expected, timeout_ms=timeout_ms)
        except SchoolAutomationError as exc:
            failed.append({"nodeId": source_id, "selector": selector, "reason": exc.error_code})
            continue
        if expected.strip() not in actual.strip() and actual.strip() != expected.strip():
            failed.append({"nodeId": source_id, "selector": selector, "reason": "value_mismatch"})
    return failed


async def _click_submit_and_wait_feedback(page: Any, config: Dict[str, Any], mode: str) -> List[str]:
    if mode != "draft":
        raise SchoolAutomationError("FINAL_SUBMIT_DISABLED", "正式提交暂未开放", current_step="school.submit.submitAction")
    selector = deep_get(config, "selectors.modal.saveDraft", "#ReportModal button:has-text('临时提交')")
    timeout_ms = safe_int(deep_get(config, "waitPolicy.submitFeedbackTimeoutMs"), 30000)
    locator = page.locator(selector).first
    if await locator.count() == 0:
        locator = page.locator("#ReportModal input[value='临时提交'], #ReportModal button:has-text('临时提交'), #ReportModal a:has-text('临时提交')").first
    if await locator.count() == 0:
        raise SchoolAutomationError("DRAFT_SUBMIT_BUTTON_MISSING", "学校临时提交按钮缺失", current_step="school.submit.submitAction")

    messages: List[str] = []
    page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
    await locator.click()
    try:
        await page.wait_for_function(
            """
            () => {
              const texts = Array.from(document.querySelectorAll('.bootbox-body, .modal-body, .toast, .layui-layer-content, .alert'))
                .map((el) => (el.innerText || el.textContent || '').trim())
                .filter(Boolean);
              return texts.some((text) => /成功|保存|提交|失败|错误/.test(text));
            }
            """,
            timeout=timeout_ms,
        )
    except Exception:
        pass
    messages = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('.bootbox-body, .modal-body, .toast, .layui-layer-content, .alert'))
          .map((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(-10)
        """
    )
    if any(re.search(r"失败|错误|不正确", message) for message in messages):
        raise SchoolAutomationError(
            "SUBMIT_REJECTED_BY_SCHOOL",
            "学校系统返回提交失败",
            message="; ".join(messages),
            current_step="school.submit.confirming",
        )
    if not messages:
        raise SchoolAutomationError(
            "SUBMIT_FEEDBACK_TIMEOUT",
            "未收到学校系统提交反馈",
            current_step="school.submit.confirming",
        )
    return messages


async def _read_experiment_status_from_list(page: Any, config: Dict[str, Any], experiment_name: str) -> Dict[str, str]:
    await _return_to_report_list(page, config)
    experiments = await extract_report_list(page, config)
    for item in experiments:
        row_name = item.get("experimentName") or ""
        if row_name == experiment_name or row_name in experiment_name or experiment_name in row_name:
            return item
    raise SchoolAutomationError(
        "REPORT_STATUS_NOT_FOUND",
        "提交后未能在学校列表读取实验状态",
        message=f"experimentName={experiment_name}",
        current_step="school.submit.readingStatus",
    )


def _mark_job_failed(session: Session, job: AutomationJob, error: SchoolAutomationError) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.submit.failed" if job.action in ["draft_submit", "final_submit"] else "school.detail.failed"
    job.public_message_params = {"reason": error.reason}
    job.error_code = error.error_code
    job.error_message = error.message[:1000]
    result_payload = {"errorCode": error.error_code, "currentStep": error.current_step}
    diagnostic_user_id = job.actor_user_id
    if job.submission_id:
        failed_submission = session.get(Submission, job.submission_id)
        if failed_submission:
            diagnostic_user_id = failed_submission.student_id
    if diagnostic_user_id:
        browser_session = school_session_manager.get(diagnostic_user_id)
        if browser_session and browser_session.last_diagnostic:
            result_payload["sessionDiagnostic"] = browser_session.last_diagnostic
    job.result_payload = result_payload
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    if job.submission_id:
        submission = session.get(Submission, job.submission_id)
        if submission:
            submission.status = "error"
            submission.updated_at = now
            session.add(submission)
    session.add(
        AuditLog(
            user_id=job.actor_user_id,
            action=f"{job.action}_failed",
            status="failed",
            target_id=job.id,
            details=f"{error.error_code}: {error.reason}",
        )
    )


def run_school_detail_sync(job_id: str, user_id: int, experiment_id: str) -> None:
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            experiment_name = _experiment_display_name(session, experiment_id)

        async def _run_detail() -> Tuple[Any, SchoolReportOpenResult]:
            async with school_session_manager.user_operation(user.id):
                return await open_report_modal(job_id, user, experiment_id, experiment_name, config, step_group="detail")

        page, result = school_session_manager.run(_run_detail())
        _ = page

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job or job.status not in ["queued", "running", "retrying"]:
                return
            now = get_utc_now()
            set_job_progress(job_id, "school.detail.savingSnapshot")
            snapshot = SchoolSyncSnapshot(
                user_id=user_id,
                experiment_id=experiment_id,
                snapshot_json=result.snapshot,
                summary_json=result.summary,
                synced_at=now,
                automation_job_id=job.id,
            )
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.detail.success"
            job.result_payload = {"summary": result.summary, "artifacts": result.artifacts, "sessionDiagnostic": result.session_diagnostic}
            job.finished_at = now
            job.updated_at = now
            session.add(snapshot)
            session.add(job)
            session.add(AuditLog(user_id=user_id, action="school_detail_sync_completed", status="success", target_id=job.id, details="学校单实验同步已完成。"))
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if job:
                _mark_job_failed(session, job, exc)
                session.commit()


def run_school_experiment_submit(job_id: str, submission_id: str, mode: str) -> None:
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            submission = session.get(Submission, submission_id)
            if not job or not submission or job.status not in ["queued", "running", "retrying"]:
                return
            user = session.get(User, submission.student_id)
            if not user:
                raise SchoolAutomationError("USER_NOT_FOUND", "提交所属学生不存在")
            config = load_active_config(session)
            experiment_name = _experiment_display_name(session, submission.experiment_id, submission.corrected_json)

        async def _run() -> Dict[str, Any]:
            async with school_session_manager.user_operation(user.id):
                page, opened = await open_report_modal(job_id, user, submission.experiment_id, experiment_name, config, step_group="submit")
                set_job_progress(job_id, "school.submit.filling")
                failed_fields = await _write_and_verify_fields(page, config, submission)
                if failed_fields:
                    raise SchoolAutomationError(
                        "FIELD_WRITE_VERIFY_FAILED",
                        "部分内容未能成功写入学校系统",
                        message=json.dumps({"failedFields": failed_fields}, ensure_ascii=False),
                        current_step="school.submit.verifying",
                    )
                set_job_progress(job_id, "school.submit.verifying")
                out_dir = _artifact_dir(job_id)
                before_artifacts = await _save_modal_artifacts(page, config, out_dir, "02_before_submit")
                set_job_progress(job_id, "school.submit.submittingDraft" if mode == "draft" else "school.submit.submittingFinal")
                feedback = await _click_submit_and_wait_feedback(page, config, mode)
                set_job_progress(job_id, "school.submit.confirming")
                await _close_modal_if_present(page, config)
                set_job_progress(job_id, "school.submit.returningList")
                status = await _read_experiment_status_from_list(page, config, opened.experiment_name)
                set_job_progress(job_id, "school.submit.readingStatus")
                after_path = out_dir / "03_after_submit_list.png"
                await page.screenshot(path=str(after_path), full_page=True)
                return {
                    "opened": opened,
                    "feedback": feedback,
                    "status": status,
                    "artifacts": {**opened.artifacts, **before_artifacts, "after_submit_list_screenshot": str(after_path)},
                    "sessionDiagnostic": opened.session_diagnostic,
                }

        result = school_session_manager.run(_run())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            submission = session.get(Submission, submission_id)
            if not job or not submission or job.status not in ["queued", "running", "retrying"]:
                return
            now = get_utc_now()
            school_status = result["status"].get("schoolStatus")
            if mode == "draft" and school_status != "school_draft_submitted":
                raise SchoolAutomationError(
                    "SCHOOL_STATUS_NOT_CONFIRMED",
                    "学校系统未确认临时提交状态",
                    message=json.dumps(result["status"], ensure_ascii=False),
                    current_step="school.submit.readingStatus",
                )
            snapshot = SchoolSyncSnapshot(
                user_id=submission.student_id,
                submission_id=submission.id,
                experiment_id=submission.experiment_id,
                snapshot_json={
                    "source": "school_submit_confirmed",
                    "mode": mode,
                    "feedback": result["feedback"],
                    "status": result["status"],
                    "modalBeforeSubmit": result["opened"].snapshot,
                },
                summary_json={
                    "source": "school_submit_confirmed",
                    "mode": mode,
                    **result["status"],
                },
                synced_at=now,
                automation_job_id=job.id,
            )
            submission.status = "draft_submitted" if mode == "draft" else "completed"
            submission.updated_at = now
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.submit.success"
            job.result_payload = {
                "status": result["status"],
                "feedback": result["feedback"],
                "artifacts": result["artifacts"],
                "sessionDiagnostic": result["sessionDiagnostic"],
            }
            job.finished_at = now
            job.updated_at = now
            session.add(snapshot)
            session.add(submission)
            session.add(job)
            session.add(AuditLog(user_id=job.actor_user_id, action=f"school_{mode}_submit_completed", status="success", target_id=job.id, details="学校系统提交状态已确认。"))
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if job:
                _mark_job_failed(session, job, exc)
                session.commit()
    except Exception as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if job:
                _mark_job_failed(
                    session,
                    job,
                    SchoolAutomationError("SCHOOL_SUBMIT_UNKNOWN_ERROR", "学校系统提交失败", message=str(exc), current_step="school.submit.connecting"),
                )
                session.commit()
