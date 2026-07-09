from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlmodel import Session, select

from core.db import engine
from models.core import AuditLog, AutomationJob, Experiment, SchoolSyncSnapshot, Submission, User, get_utc_now
from services.school_overview_sync import (
    SchoolAutomationError,
    deep_get,
    extract_report_list,
    load_active_config,
    map_school_status,
    normalize_score,
    perform_school_overview_sync,
    safe_int,
    set_job_progress,
    wait_for_loading_to_disappear,
)
from services.school_dom import SchoolDomTimeout, read_locator_value, wait_for_locator_value
from services.school_session_manager import school_session_manager
from services.automation_job_service import ACTIVE_JOB_STATUSES


BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = BACKEND_ROOT / "configs"
ARTIFACT_ROOT = BACKEND_ROOT / "tmp" / "school_report_sync"
SUBMIT_QUEUE_POLL_SECONDS = 2
SUBMIT_QUEUE_TIMEOUT_SECONDS = 30 * 60
SUBMIT_OPEN_REPORT_TIMEOUT_SECONDS = 45


@dataclass
class SchoolReportOpenResult:
    experiment_name: str
    school_status: Optional[Dict[str, str]]
    snapshot: Dict[str, Any]
    summary: Dict[str, Any]
    artifacts: Dict[str, str]
    session_diagnostic: Dict[str, Any]
    reused_current_modal: bool = False


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


async def _wait_bootbox_clear(page: Any, timeout_ms: int) -> None:
    try:
        await page.wait_for_function(
            """
            () => {
              const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
              };
              return !Array.from(document.querySelectorAll('.bootbox.modal.in, .bootbox'))
                .some(visible);
            }
            """,
            timeout=timeout_ms,
        )
    except Exception:
        pass


BOOTBOX_DIALOG_SCRIPT = """
    () => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
      const candidates = Array.from(document.querySelectorAll('.bootbox'))
        .filter(visible)
        .map((box) => ({
          className: box.className || '',
          id: box.id || '',
          ariaHidden: box.getAttribute('aria-hidden'),
          bodyText: textOf(box.querySelector('.bootbox-body')).slice(0, 1000),
          textPreview: textOf(box).slice(0, 1000),
        }));
      return candidates.find((item) => item.bodyText || item.textPreview) || null;
    }
"""


async def _read_visible_bootbox(page: Any) -> Optional[Dict[str, Any]]:
    try:
        diagnostic = await page.evaluate(BOOTBOX_DIALOG_SCRIPT)
    except Exception:
        return None
    if not isinstance(diagnostic, dict):
        return None
    body_text = str(diagnostic.get("bodyText") or diagnostic.get("textPreview") or "").strip()
    if not body_text:
        return None
    diagnostic["bodyText"] = body_text
    return diagnostic


async def _save_bootbox_artifacts(page: Any, out_dir: Path, prefix: str) -> Dict[str, str]:
    artifacts: Dict[str, str] = {}
    screenshot_path = out_dir / f"{prefix}_bootbox.png"
    html_path = out_dir / f"{prefix}_bootbox.html"
    try:
        await page.locator(".bootbox").first.screenshot(path=str(screenshot_path))
        artifacts[f"{prefix}_bootbox_screenshot"] = str(screenshot_path)
    except Exception as exc:
        try:
            await page.screenshot(path=str(screenshot_path), full_page=True)
            artifacts[f"{prefix}_page_screenshot"] = str(screenshot_path)
        except Exception:
            artifacts[f"{prefix}_screenshot_error"] = f"{type(exc).__name__}: {exc}"

    html: Optional[str] = None
    try:
        html = await page.locator(".bootbox").first.evaluate("(el) => el.outerHTML")
    except Exception as exc:
        try:
            html = await page.content()
        except Exception:
            artifacts[f"{prefix}_html_error"] = f"{type(exc).__name__}: {exc}"
    if html:
        html_path.write_text(html, encoding="utf-8")
        artifacts[f"{prefix}_bootbox_html"] = str(html_path)
    return artifacts


async def _raise_if_blocking_bootbox(
    page: Any,
    *,
    job_id: str,
    current_step: str,
    phase: str,
    session_diagnostic: Optional[Dict[str, Any]] = None,
    require_error: bool = False,
) -> None:
    bootbox = await _read_visible_bootbox(page)
    if not bootbox and not require_error:
        return
    out_dir = _artifact_dir(job_id)
    artifacts = await _save_bootbox_artifacts(page, out_dir, phase)
    body_text = str((bootbox or {}).get("bodyText") or "学校系统出现弹窗").strip()
    payload = {
        "phase": phase,
        "bootbox": bootbox or {},
        "artifacts": artifacts,
    }
    if session_diagnostic:
        payload["sessionDiagnostic"] = session_diagnostic
    raise SchoolAutomationError(
        "SCHOOL_BOOTBOX_ERROR",
        f"学校系统弹窗提示：{body_text[:200]}",
        message=json.dumps(payload, ensure_ascii=False),
        current_step=current_step,
    )


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


async def _close_submit_feedback_dialog(page: Any, config: Dict[str, Any]) -> None:
    timeout_ms = safe_int(deep_get(config, "runtime.defaultTimeoutMs"), 30000)
    for selector in [
        ".bootbox.modal.in button[data-bb-handler='ok']",
        ".bootbox.modal.in .bootbox-close-button",
        ".bootbox.modal.in [data-dismiss='modal']",
        ".bootbox button:has-text('OK')",
        ".bootbox button:has-text('确定')",
        ".bootbox .close",
    ]:
        try:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click()
                await page.wait_for_timeout(300)
                break
        except Exception:
            continue
    await _wait_bootbox_clear(page, timeout_ms)
    await wait_for_loading_to_disappear(page, timeout_ms)


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


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


async def _current_modal_matches_experiment(page: Any, config: Dict[str, Any], experiment_name: str) -> Tuple[bool, Dict[str, Any]]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    try:
        text = await page.locator(modal_root).first.evaluate("(el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()")
    except Exception:
        return False, {"reason": "modal_text_unavailable"}

    target = _normalize_text(experiment_name)
    current = _normalize_text(text)
    if not target or not current:
        return False, {"reason": "modal_text_empty", "target": target, "modalTextSample": current[:200]}
    return (
        target in current or current in target,
        {
            "targetExperimentName": target,
            "modalTextSample": current[:300],
        },
    )


async def _click_report_open_button(page: Any, config: Dict[str, Any], experiment_name: str, opening_code: str) -> Optional[Dict[str, str]]:
    row_selector = deep_get(config, "selectors.dashboard.reportTableRows", "tbody[data-bind='foreach: CompleteReportList'] tr")
    columns = deep_get(config, "selectors.reportList.columns", {}) or {}
    experiment_idx = safe_int(columns.get("experimentName"), 0)
    status_idx = safe_int(columns.get("status"), 6)
    score_idx = safe_int(columns.get("score"), 7)
    button_text = deep_get(config, "selectors.reportList.openReportButtonText", "完成报告")
    result = await page.evaluate(
        """
        ({ rowSelector, experimentIdx, statusIdx, scoreIdx, buttonText, experimentName }) => {
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const targetName = normalize(experimentName);
          const rows = Array.from(document.querySelectorAll(rowSelector));
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const cells = Array.from(row.querySelectorAll('td'));
            const rowName = normalize(cells[experimentIdx]?.innerText || cells[experimentIdx]?.textContent);
            if (rowName !== targetName && !rowName.includes(targetName) && !targetName.includes(rowName)) continue;
            const statusText = normalize(cells[statusIdx]?.innerText || cells[statusIdx]?.textContent);
            const scoreText = scoreIdx >= 0 ? normalize(cells[scoreIdx]?.innerText || cells[scoreIdx]?.textContent) : '';
            const candidates = Array.from(row.querySelectorAll('input, button, a'));
            const buttonIndex = candidates.findIndex((el) => {
              const text = normalize(el.value || el.innerText || el.textContent || el.getAttribute('title'));
              return text === buttonText || text.includes(buttonText);
            });
            if (buttonIndex < 0) return { found: true, clicked: false, experimentName: rowName, statusText, scoreText, rowIndex };
            const button = candidates[buttonIndex];
            const buttonLabel = normalize(button.value || button.innerText || button.textContent || button.getAttribute('title'));
            const disabled = Boolean(button.disabled || button.getAttribute('disabled') !== null || button.getAttribute('aria-disabled') === 'true');
            if (disabled) return { found: true, clicked: false, disabled: true, experimentName: rowName, statusText, scoreText, rowIndex, buttonIndex, buttonLabel };
            button.click();
            return { found: true, clicked: true, experimentName: rowName, statusText, scoreText, rowIndex, buttonIndex, buttonLabel };
          }
          return { found: false, clicked: false };
        }
        """,
        {
            "rowSelector": row_selector,
            "experimentIdx": experiment_idx,
            "statusIdx": status_idx,
            "scoreIdx": score_idx,
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
        if result.get("disabled"):
            raise SchoolAutomationError(
                "REPORT_OPEN_BUTTON_DISABLED",
                "学校实验列表中的完成报告按钮不可点击",
                message=json.dumps(result, ensure_ascii=False),
                current_step=opening_code,
            )
        raise SchoolAutomationError(
            "REPORT_OPEN_BUTTON_MISSING",
            "学校实验列表中未找到完成报告按钮",
            message=json.dumps(result, ensure_ascii=False),
            current_step=opening_code,
        )
    return {
        "experimentName": result.get("experimentName") or experiment_name,
        "originalStatusText": result.get("statusText") or "",
        "score": normalize_score(result.get("scoreText") or ""),
        "schoolStatus": map_school_status(result.get("statusText") or "", result.get("scoreText") or ""),
        "rowIndex": result.get("rowIndex"),
        "buttonIndex": result.get("buttonIndex"),
        "buttonLabel": result.get("buttonLabel") or "",
    }


async def _click_report_open_button_with_locator(
    page: Any,
    config: Dict[str, Any],
    click_info: Optional[Dict[str, Any]],
) -> bool:
    if not isinstance(click_info, dict) or click_info.get("rowIndex") is None:
        return False
    row_selector = deep_get(config, "selectors.dashboard.reportTableRows", "tbody[data-bind='foreach: CompleteReportList'] tr")
    button_text = deep_get(config, "selectors.reportList.openReportButtonText", "完成报告")
    row = page.locator(row_selector).nth(int(click_info.get("rowIndex") or 0))
    candidates = [
        f"input[value='{button_text}']",
        f"input[value*='{button_text}']",
        f"button:has-text('{button_text}')",
        f"a:has-text('{button_text}')",
    ]
    for selector in candidates:
        try:
            button = row.locator(selector).first
            if await button.count() > 0 and await button.is_visible():
                await button.click(timeout=5000, force=True)
                return True
        except Exception:
            continue
    return False


async def _save_report_modal_timeout_artifacts(
    page: Any,
    job_id: str,
    phase: str,
    diagnostics: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    out_dir = _artifact_dir(job_id)
    screenshot_path = out_dir / f"{phase}_page.png"
    html_path = out_dir / f"{phase}_page.html"
    artifacts: Dict[str, Any] = {"diagnostics": diagnostics or {}}
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        artifacts["page_screenshot"] = str(screenshot_path)
    except Exception as exc:
        artifacts["screenshot_error"] = f"{type(exc).__name__}: {exc}"
    try:
        html_path.write_text(await page.content(), encoding="utf-8")
        artifacts["page_html"] = str(html_path)
    except Exception as exc:
        artifacts["html_error"] = f"{type(exc).__name__}: {exc}"
    return artifacts


async def _wait_for_report_modal(page: Any, config: Dict[str, Any], opening_code: str, *, job_id: Optional[str] = None) -> None:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    timeout_ms = safe_int(deep_get(config, "waitPolicy.modalOpenTimeoutMs"), safe_int(deep_get(config, "runtime.defaultTimeoutMs"), 30000))
    await _wait_for_report_modal_with_timeout(page, config, opening_code, timeout_ms=timeout_ms, job_id=job_id)


async def _wait_for_report_modal_with_timeout(
    page: Any,
    config: Dict[str, Any],
    opening_code: str,
    *,
    timeout_ms: int,
    job_id: Optional[str] = None,
    diagnostics: Optional[Dict[str, Any]] = None,
) -> None:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    try:
        await page.locator(modal_root).first.wait_for(state="visible", timeout=timeout_ms)
    except Exception as exc:
        if job_id:
            await _raise_if_blocking_bootbox(
                page,
                job_id=job_id,
                current_step=opening_code,
                phase="wait_report_modal",
            )
            artifacts = await _save_report_modal_timeout_artifacts(
                page,
                job_id,
                "wait_report_modal_timeout",
                diagnostics=diagnostics,
            )
        else:
            artifacts = {"diagnostics": diagnostics or {}}
        raise SchoolAutomationError(
            "REPORT_MODAL_NOT_FOUND",
            "学校实验报告窗口未打开",
            message=json.dumps(artifacts, ensure_ascii=False),
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


async def _read_mapped_form_values(page: Any, config: Dict[str, Any], experiment_id: str) -> Dict[str, str]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    form_values: Dict[str, str] = {}
    for mapping in _automation_mappings(experiment_id):
        source_id = mapping["sourceId"]
        selector = mapping["targetLocator"]
        target_type = str(mapping.get("targetType") or "text")
        if target_type == "wysiwyg_text":
            values = await _read_wysiwyg_text(page, modal_root, selector)
            form_values[source_id] = values.get("editorText") or values.get("textareaValue") or values.get("editorHtml") or ""
            continue
        if target_type == "wysiwyg_image":
            image_value = await page.evaluate(
                """
                ({ modalRoot, selector }) => {
                  const root = document.querySelector(modalRoot) || document;
                  const target = root.querySelector(selector) || document.querySelector(selector);
                  if (!target) return '';
                  const wrapper = target.closest('.wysiwyg-wrapper');
                  const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
                  const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
                  const imgs = Array.from(editor?.querySelectorAll('img') || []);
                  return imgs.map((img) => img.getAttribute('src') || '').filter(Boolean).join(',');
                }
                """,
                {"modalRoot": modal_root, "selector": selector},
            )
            form_values[source_id] = str(image_value or "")
            continue
        locator = page.locator(f"{modal_root} {selector}").first
        if await locator.count() == 0:
            locator = page.locator(selector).first
        if await locator.count() == 0:
            continue
        form_values[source_id] = await read_locator_value(locator)
    return form_values


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
    read_snapshot: bool = True,
    modal_timeout_ms: Optional[int] = None,
) -> Tuple[Any, SchoolReportOpenResult]:
    connecting_code = f"school.{step_group}.connecting"
    opening_code = f"school.{step_group}.opening"
    reading_code = "school.detail.reading" if step_group == "detail" else "school.submit.opening"
    set_job_progress(job_id, connecting_code)
    state = await school_session_manager.detect_state(user.id, config)
    session = school_session_manager.get(user.id)
    reused_current_modal = False
    school_status: Optional[Dict[str, str]] = None

    if session and state.get("state") == "bootbox_dialog":
        await _raise_if_blocking_bootbox(
            session.page,
            job_id=job_id,
            current_step=connecting_code,
            phase="before_session_reuse",
            session_diagnostic=state,
            require_error=True,
        )

    if session and state.get("state") == "report_modal":
        matches, match_diagnostic = await _current_modal_matches_experiment(session.page, config, experiment_name)
        state["modalMatch"] = match_diagnostic
        if matches:
            page = session.page
            session_diagnostic = state
            session_diagnostic["reuseDecision"] = "reused_current_report_modal"
            reused_current_modal = True
        else:
            await _close_modal_if_present(session.page, config)
            page, session_diagnostic = await get_or_login_school_page(job_id, user, config, connecting_code)
    else:
        page, session_diagnostic = await get_or_login_school_page(job_id, user, config, connecting_code)

    set_job_progress(job_id, opening_code)
    await _raise_if_blocking_bootbox(
        page,
        job_id=job_id,
        current_step=opening_code,
        phase="before_open_report",
        session_diagnostic=session_diagnostic,
    )
    if not reused_current_modal:
        school_status = await _click_report_open_button(page, config, experiment_name, opening_code)
        try:
            await page.wait_for_timeout(300)
        except Exception:
            pass
        await _raise_if_blocking_bootbox(
            page,
            job_id=job_id,
            current_step=opening_code,
            phase="after_open_report_click",
            session_diagnostic=session_diagnostic,
        )
        if modal_timeout_ms is not None:
            try:
                await _wait_for_report_modal_with_timeout(
                    page,
                    config,
                    opening_code,
                    timeout_ms=modal_timeout_ms,
                    job_id=job_id,
                    diagnostics={"click": school_status, "attempt": 1},
                )
            except SchoolAutomationError as exc:
                if exc.error_code != "REPORT_MODAL_NOT_FOUND":
                    raise
                retried = await _click_report_open_button_with_locator(page, config, school_status)
                if not retried:
                    raise
                try:
                    await page.wait_for_timeout(300)
                except Exception:
                    pass
                await _wait_for_report_modal_with_timeout(
                    page,
                    config,
                    opening_code,
                    timeout_ms=modal_timeout_ms,
                    job_id=job_id,
                    diagnostics={"click": school_status, "attempt": 2, "retry": "playwright_locator_force_click"},
                )
        else:
            try:
                await _wait_for_report_modal(page, config, opening_code, job_id=job_id)
            except SchoolAutomationError as exc:
                if exc.error_code != "REPORT_MODAL_NOT_FOUND":
                    raise
                retried = await _click_report_open_button_with_locator(page, config, school_status)
                if not retried:
                    raise
                try:
                    await page.wait_for_timeout(300)
                except Exception:
                    pass
                await _wait_for_report_modal(page, config, opening_code, job_id=job_id)
    else:
        if modal_timeout_ms is not None:
            await _wait_for_report_modal_with_timeout(
                page,
                config,
                opening_code,
                timeout_ms=modal_timeout_ms,
                job_id=job_id,
                diagnostics={"reusedCurrentModal": True},
            )
        else:
            await _wait_for_report_modal(page, config, opening_code, job_id=job_id)
    await _raise_if_blocking_bootbox(
        page,
        job_id=job_id,
        current_step=opening_code,
        phase="after_report_modal_open",
        session_diagnostic=session_diagnostic,
    )
    snapshot: Dict[str, Any] = {"values": {}, "fields": [], "text": "", "htmlLength": 0}
    form_values: Dict[str, str] = {}
    artifacts: Dict[str, str] = {}
    if read_snapshot:
        set_job_progress(job_id, reading_code)
        snapshot = await _read_modal_snapshot(page, config)
        form_values = await _read_mapped_form_values(page, config, experiment_id)
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
            "formValues": form_values,
            **snapshot,
        },
        summary=summary,
        artifacts=artifacts,
        session_diagnostic=session_diagnostic,
        reused_current_modal=reused_current_modal,
    )


def _submission_values(submission: Submission) -> Dict[str, Any]:
    corrected = submission.corrected_json or {}
    values = corrected.get("values")
    return values if isinstance(values, dict) else {}


def _automation_mappings(experiment_id: str) -> List[Dict[str, Any]]:
    config_json = _read_experiment_config(experiment_id)
    mappings = ((config_json.get("automation") or {}).get("mappings") or [])
    return [item for item in mappings if item.get("sourceId") and item.get("targetLocator")]


async def _resolve_field_locator(page: Any, modal_root: str, selector: str) -> Any:
    locator = page.locator(f"{modal_root} {selector}").first
    if await locator.count() == 0:
        locator = page.locator(selector).first
    return locator


async def _field_node_diagnostic(locator: Any) -> Dict[str, Any]:
    try:
        return await locator.evaluate(
            """
            (el) => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              const visible = style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0
                && rect.width > 0
                && rect.height > 0;
              const wrapper = el.closest('.wysiwyg-wrapper');
              const container = el.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                name: el.getAttribute('name') || '',
                className: el.className || '',
                isVisible: visible,
                isContentEditable: Boolean(el.isContentEditable),
                valueLength: 'value' in el ? String(el.value || '').length : String(el.textContent || '').length,
                hasWysiwygWrapper: Boolean(wrapper),
                hasWysiwygEditor: Boolean((wrapper || container || el.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor')),
                hasImageToolbarButton: Boolean(container?.querySelector('a.wysiwyg-toolbar-icon[title="插入图片"], a.wysiwyg-toolbar-icon[title*="插入图片"]')),
              };
            }
            """
        )
    except Exception:
        return {}


def _field_error_message(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _parse_json_object(value: str) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {"message": value}
    except Exception:
        return {"message": value}


def _field_error(
    code: str,
    reason: str,
    *,
    source_id: str,
    selector: str,
    target_type: str,
    stage: str,
    diagnostic: Optional[Dict[str, Any]] = None,
) -> SchoolAutomationError:
    payload = {
        "nodeId": source_id,
        "targetLocator": selector,
        "targetType": target_type,
        "stage": stage,
        **(diagnostic or {}),
    }
    return SchoolAutomationError(
        code,
        reason,
        message=_field_error_message(payload),
        current_step="school.submit.filling",
    )


def _html_text_contains(actual: str, expected: str) -> bool:
    actual_norm = _normalize_text(re.sub(r"<[^>]+>", " ", actual or ""))
    expected_norm = _normalize_text(expected)
    return bool(expected_norm) and (actual_norm == expected_norm or expected_norm in actual_norm or expected.strip() in str(actual or ""))


async def _read_wysiwyg_text(page: Any, modal_root: str, selector: str) -> Dict[str, str]:
    return await page.evaluate(
        """
        ({ modalRoot, selector }) => {
          const root = document.querySelector(modalRoot) || document;
          const target = root.querySelector(selector) || document.querySelector(selector);
          if (!target) return { editorText: '', editorHtml: '', textareaValue: '' };
          const wrapper = target.closest('.wysiwyg-wrapper');
          const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
          const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
          return {
            editorText: (editor && (editor.innerText || editor.textContent || '')) || '',
            editorHtml: (editor && editor.innerHTML) || '',
            textareaValue: target.value || '',
          };
        }
        """,
        {"modalRoot": modal_root, "selector": selector},
    )


async def _write_wysiwyg_text_field(
    page: Any,
    modal_root: str,
    selector: str,
    value: Any,
    *,
    source_id: str,
    timeout_ms: int,
) -> str:
    text_value = "" if value is None else str(value)
    result = await page.evaluate(
        """
        ({ modalRoot, selector, value }) => {
          const root = document.querySelector(modalRoot) || document;
          const target = root.querySelector(selector) || document.querySelector(selector);
          if (!target) return { ok: false, stage: 'target_missing' };
          const wrapper = target.closest('.wysiwyg-wrapper');
          const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
          const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
          const diagnostic = {
            tag: target.tagName.toLowerCase(),
            id: target.id || '',
            className: target.className || '',
            hasWysiwygWrapper: Boolean(wrapper),
            hasWysiwygEditor: Boolean(editor),
          };
          if (!editor) return { ok: false, stage: 'editor_not_found', ...diagnostic };

          const escapeHtml = (text) => String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          const html = String(value ?? '').split(/\\r?\\n/).map(escapeHtml).join('<br>');
          let usedApi = false;
          try {
            const jq = window.jQuery || window.$;
            const instance = jq ? jq(target).data('wysiwygjs') : null;
            if (instance && typeof instance.setHTML === 'function') {
              instance.setHTML(html);
              usedApi = true;
            }
          } catch (_) {}
          if (!usedApi) editor.innerHTML = html;
          target.value = html;
          target.textContent = html;
          for (const el of [editor, target]) {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value ?? '') }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          return {
            ok: true,
            stage: 'written',
            usedApi,
            editorText: editor.innerText || editor.textContent || '',
            editorHtml: editor.innerHTML || '',
            textareaValue: target.value || '',
            ...diagnostic,
          };
        }
        """,
        {"modalRoot": modal_root, "selector": selector, "value": text_value},
    )
    if not result.get("ok"):
        raise _field_error(
            "WYSIWYG_TEXT_WRITE_FAILED",
            "学校富文本字段写入失败",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_text",
            stage=result.get("stage") or "write",
            diagnostic=result,
        )

    deadline = asyncio.get_running_loop().time() + max(timeout_ms, 1) / 1000
    last_values = result
    while True:
        if _html_text_contains(last_values.get("editorText") or last_values.get("editorHtml") or "", text_value) or _html_text_contains(last_values.get("textareaValue") or "", text_value):
            return last_values.get("editorText") or last_values.get("editorHtml") or last_values.get("textareaValue") or ""
        if asyncio.get_running_loop().time() >= deadline:
            break
        await asyncio.sleep(0.2)
        last_values = await _read_wysiwyg_text(page, modal_root, selector)

    raise _field_error(
        "WYSIWYG_TEXT_WRITE_FAILED",
        "学校富文本字段回读不匹配",
        source_id=source_id,
        selector=selector,
        target_type="wysiwyg_text",
        stage="verify",
        diagnostic={
            "editorTextLength": len(last_values.get("editorText") or ""),
            "editorHtmlLength": len(last_values.get("editorHtml") or ""),
            "textareaValueLength": len(last_values.get("textareaValue") or ""),
        },
    )


def _first_image_value(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            candidate = _first_image_value(item)
            if candidate:
                return candidate
        return ""
    if isinstance(value, dict):
        return str(value.get("url") or value.get("path") or value.get("src") or "")
    text = str(value or "").strip()
    data_url_match = re.search(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+", text)
    if data_url_match:
        return re.sub(r"\s+", "", data_url_match.group(0))
    return text.split(",")[0].strip()


def _materialize_data_image_url(image_value: str) -> Path:
    match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", image_value, re.DOTALL)
    if not match:
        raise ValueError("invalid data image url")
    mime = match.group(1).lower()
    suffix_by_mime = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    suffix = suffix_by_mime.get(mime)
    if not suffix:
        raise ValueError(f"unsupported data image mime: {mime}")
    encoded = re.sub(r"\s+", "", match.group(2))
    payload = base64.b64decode(encoded, validate=True)
    if not payload:
        raise ValueError("empty data image payload")
    digest = hashlib.sha256(payload).hexdigest()[:24]
    out_dir = BACKEND_ROOT / "tmp" / "school_report_sync" / "data_url_uploads"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{digest}{suffix}"
    if not out_path.exists():
        out_path.write_bytes(payload)
    return out_path


def _resolve_upload_file_path(value: Any) -> Path:
    image_value = _first_image_value(value)
    if not image_value:
        raise ValueError("empty image value")
    if image_value.startswith("data:image/"):
        return _materialize_data_image_url(image_value)
    parsed = urlparse(image_value)
    path_part = parsed.path if parsed.scheme else image_value
    path_part = path_part.split("?", 1)[0]
    candidates: List[Path] = []
    raw_path = Path(path_part)
    if raw_path.is_absolute():
        candidates.append(raw_path)
        if path_part.startswith("/uploads/"):
            rel = path_part.lstrip("/")
            candidates.extend([Path.cwd() / rel, BACKEND_ROOT / rel, BACKEND_ROOT.parent / rel])
    else:
        candidates.extend([Path.cwd() / path_part, BACKEND_ROOT / path_part, BACKEND_ROOT.parent / path_part])
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise FileNotFoundError(f"image file not found: {image_value}")


async def _write_wysiwyg_image_field(
    page: Any,
    modal_root: str,
    selector: str,
    value: Any,
    *,
    source_id: str,
    timeout_ms: int,
    job_id: Optional[str] = None,
) -> str:
    try:
        local_path = _resolve_upload_file_path(value)
    except Exception as exc:
        raise _field_error(
            "WYSIWYG_IMAGE_UPLOAD_FAILED",
            "平台图片文件不可用",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_image",
            stage="resolve_local_file",
            diagnostic={"imageValue": _first_image_value(value), "error": str(exc)},
        ) from exc

    prepared = await page.evaluate(
        """
        ({ modalRoot, selector }) => {
          const root = document.querySelector(modalRoot) || document;
          const target = root.querySelector(selector) || document.querySelector(selector);
          if (!target) return { ok: false, stage: 'target_missing' };
          const wrapper = target.closest('.wysiwyg-wrapper');
          const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
          const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
          const button = container?.querySelector('a.wysiwyg-toolbar-icon[title="插入图片"], a.wysiwyg-toolbar-icon[title*="插入图片"]');
          const diagnostic = {
            tag: target.tagName.toLowerCase(),
            id: target.id || '',
            className: target.className || '',
            hasWysiwygWrapper: Boolean(wrapper),
            hasWysiwygEditor: Boolean(editor),
            hasImageToolbarButton: Boolean(button),
          };
          if (!editor) return { ok: false, stage: 'editor_not_found', ...diagnostic };
          if (!button) return { ok: false, stage: 'image_toolbar_button_missing', ...diagnostic };
          editor.innerHTML = '';
          target.value = '';
          target.textContent = '';
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          button.click();
          return { ok: true, stage: 'popup_opening', ...diagnostic };
        }
        """,
        {"modalRoot": modal_root, "selector": selector},
    )
    if not prepared.get("ok"):
        raise _field_error(
            "WYSIWYG_IMAGE_UPLOAD_FAILED",
            "学校富文本图片上传入口不可用",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_image",
            stage=prepared.get("stage") or "prepare",
            diagnostic=prepared,
        )

    try:
        file_input = page.locator(".wysiwyg-popup input[type='file']").last
        await file_input.wait_for(state="attached", timeout=timeout_ms)
        await file_input.set_input_files(str(local_path))
        if job_id:
            await asyncio.sleep(0.3)
            await _raise_if_blocking_bootbox(
                page,
                job_id=job_id,
                current_step="school.submit.filling",
                phase=f"field_{source_id}_image_upload",
            )
        await page.wait_for_function(
            """
            ({ modalRoot, selector }) => {
              const root = document.querySelector(modalRoot) || document;
              const target = root.querySelector(selector) || document.querySelector(selector);
              if (!target) return false;
              const wrapper = target.closest('.wysiwyg-wrapper');
              const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
              const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
              return Boolean(editor && Array.from(editor.querySelectorAll('img')).some((img) => img.getAttribute('src')));
            }
            """,
            arg={"modalRoot": modal_root, "selector": selector},
            timeout=timeout_ms,
        )
    except Exception as exc:
        if isinstance(exc, SchoolAutomationError):
            raise
        if job_id:
            await _raise_if_blocking_bootbox(
                page,
                job_id=job_id,
                current_step="school.submit.filling",
                phase=f"field_{source_id}_image_upload_failed",
            )
        raise _field_error(
            "WYSIWYG_IMAGE_UPLOAD_FAILED",
            "学校富文本图片上传失败",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_image",
            stage="upload_or_verify",
            diagnostic={"localPath": str(local_path), "error": f"{type(exc).__name__}: {exc}"},
        ) from exc

    result = await page.evaluate(
        """
        ({ modalRoot, selector }) => {
          const root = document.querySelector(modalRoot) || document;
          const target = root.querySelector(selector) || document.querySelector(selector);
          const wrapper = target?.closest('.wysiwyg-wrapper');
          const container = target?.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
          const editor = (wrapper || container || target?.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
          const imgs = Array.from(editor?.querySelectorAll('img') || []);
          const html = editor?.innerHTML || '';
          if (target && html) {
            target.value = html;
            target.textContent = html;
            for (const el of [editor, target]) {
              if (!el) continue;
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertHTML', data: html }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
          }
          return {
            imageCount: imgs.length,
            firstSrc: imgs[0]?.getAttribute('src') || '',
            firstTitle: imgs[0]?.getAttribute('title') || '',
            editorHtmlLength: html.length,
            textareaValueLength: String(target?.value || '').length,
          };
        }
        """,
        {"modalRoot": modal_root, "selector": selector},
    )
    if not result.get("imageCount") or not result.get("firstSrc"):
        raise _field_error(
            "WYSIWYG_IMAGE_UPLOAD_FAILED",
            "学校富文本图片回读失败",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_image",
            stage="verify",
            diagnostic=result,
        )
    if not result.get("textareaValueLength"):
        raise _field_error(
            "WYSIWYG_IMAGE_UPLOAD_FAILED",
            "学校富文本图片未同步到提交字段",
            source_id=source_id,
            selector=selector,
            target_type="wysiwyg_image",
            stage="sync_textarea",
            diagnostic=result,
        )
    return result.get("firstSrc") or ""


async def _write_one_field(
    page: Any,
    modal_root: str,
    mapping: Dict[str, Any],
    value: Any,
    *,
    timeout_ms: int,
    job_id: Optional[str] = None,
) -> str:
    source_id = str(mapping.get("sourceId") or "")
    selector = str(mapping.get("targetLocator") or "")
    target_type = str(mapping.get("targetType") or "text")
    if target_type == "wysiwyg_text":
        return await _write_wysiwyg_text_field(page, modal_root, selector, value, source_id=source_id, timeout_ms=timeout_ms)
    if target_type == "wysiwyg_image":
        return await _write_wysiwyg_image_field(page, modal_root, selector, value, source_id=source_id, timeout_ms=timeout_ms, job_id=job_id)
    if target_type != "text":
        raise _field_error(
            "FIELD_TARGET_TYPE_UNSUPPORTED",
            "学校字段写入类型暂不支持",
            source_id=source_id,
            selector=selector,
            target_type=target_type,
            stage="dispatch",
        )

    text_value = "" if value is None else str(value)
    locator = await _resolve_field_locator(page, modal_root, selector)
    if await locator.count() == 0:
        raise _field_error(
            "FIELD_SELECTOR_MISSING",
            "学校表单字段节点缺失",
            source_id=source_id,
            selector=selector,
            target_type=target_type,
            stage="resolve",
        )
    tag = await locator.evaluate("(el) => el.tagName.toLowerCase()")
    is_contenteditable = await locator.evaluate("(el) => el.isContentEditable")
    is_visible = await locator.is_visible()
    if tag in ["input", "textarea", "select"] and not is_visible:
        diagnostic = await _field_node_diagnostic(locator)
        code = "FIELD_TARGET_TYPE_REQUIRED" if diagnostic.get("hasWysiwygEditor") else "FIELD_WRITE_FAILED"
        raise _field_error(
            code,
            "学校表单字段不可见，不能按普通文本写入",
            source_id=source_id,
            selector=selector,
            target_type=target_type,
            stage="visibility",
            diagnostic={
                **diagnostic,
                "recommendedTargetType": "wysiwyg_text" if diagnostic.get("hasWysiwygEditor") else None,
            },
        )
    if tag in ["input", "textarea", "select"]:
        try:
            await locator.fill(text_value)
        except Exception as exc:
            diagnostic = await _field_node_diagnostic(locator)
            raise _field_error(
                "FIELD_WRITE_FAILED",
                "学校表单字段写入失败",
                source_id=source_id,
                selector=selector,
                target_type=target_type,
                stage="fill",
                diagnostic={**diagnostic, "error": f"{type(exc).__name__}: {exc}"},
            ) from exc
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


def _has_submit_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_has_submit_value(item) for item in value)
    if isinstance(value, dict):
        return any(_has_submit_value(item) for item in value.values())
    return True


async def _build_mapping_audit(page: Any, modal_root: str, experiment_id: str, values: Dict[str, Any]) -> List[Dict[str, Any]]:
    mappings = _automation_mappings(experiment_id)
    mapping_by_source = {str(item.get("sourceId")): item for item in mappings}
    source_ids = set(mapping_by_source.keys()) | {str(key) for key, value in values.items() if not str(key).startswith("_") and _has_submit_value(value)}
    audit: List[Dict[str, Any]] = []
    for source_id in sorted(source_ids):
        mapping = mapping_by_source.get(source_id)
        value = values.get(source_id)
        item: Dict[str, Any] = {
            "sourceId": source_id,
            "platformHasValue": _has_submit_value(value),
            "mappingExists": bool(mapping),
            "targetLocator": mapping.get("targetLocator") if mapping else None,
            "targetType": (mapping.get("targetType") if mapping else None) or ("text" if mapping else None),
        }
        if mapping:
            locator = await _resolve_field_locator(page, modal_root, str(mapping.get("targetLocator") or ""))
            item["schoolNodeExists"] = await locator.count() > 0
            if item["schoolNodeExists"]:
                diagnostic = await _field_node_diagnostic(locator)
                item.update(
                    {
                        "schoolNodeTag": diagnostic.get("tag"),
                        "schoolNodeClass": diagnostic.get("className"),
                        "schoolNodeVisible": diagnostic.get("isVisible"),
                        "hasWysiwygWrapper": diagnostic.get("hasWysiwygWrapper"),
                        "hasWysiwygEditor": diagnostic.get("hasWysiwygEditor"),
                        "hasImageToolbarButton": diagnostic.get("hasImageToolbarButton"),
                    }
                )
                if item["targetType"] == "text" and diagnostic.get("hasWysiwygEditor") and not diagnostic.get("isVisible"):
                    item["recommendedTargetType"] = "wysiwyg_image" if diagnostic.get("hasImageToolbarButton") and "Drawing" in str(diagnostic.get("className") or "") else "wysiwyg_text"
                    item["risk"] = "hidden_textarea_with_wysiwyg_editor"
            else:
                item["risk"] = "school_node_missing"
        elif item["platformHasValue"]:
            item["recommendedTargetType"] = "unknown"
            item["risk"] = "platform_value_without_automation_mapping"
        audit.append(item)
    return audit


async def _write_and_verify_fields(page: Any, config: Dict[str, Any], submission: Submission, *, job_id: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    timeout_ms = safe_int(deep_get(config, "waitPolicy.fieldWriteTimeoutMs"), 10000)
    values = _submission_values(submission)
    mappings = _automation_mappings(submission.experiment_id)
    report: Dict[str, List[Dict[str, Any]]] = {
        "succeededFields": [],
        "skippedEmptyFields": [],
        "missingFields": [],
        "failedFields": [],
        "unsupportedFields": [],
        "mappingAudit": await _build_mapping_audit(page, modal_root, submission.experiment_id, values),
    }
    for audit_item in report["mappingAudit"]:
        if audit_item.get("platformHasValue") and not audit_item.get("mappingExists"):
            report["missingFields"].append(
                {
                    "nodeId": audit_item.get("sourceId"),
                    "reason": "platform_value_without_automation_mapping",
                    "recommendedTargetType": audit_item.get("recommendedTargetType"),
                }
            )

    for mapping in mappings:
        source_id = mapping["sourceId"]
        target_type = str(mapping.get("targetType") or "text")
        selector = mapping["targetLocator"]
        if target_type not in ["text", "wysiwyg_text", "wysiwyg_image"]:
            report["unsupportedFields"].append(
                {"nodeId": source_id, "selector": selector, "targetType": target_type, "reason": "unsupported_target_type"}
            )
            continue
        if source_id not in values or not _has_submit_value(values[source_id]):
            report["skippedEmptyFields"].append({"nodeId": source_id, "selector": selector, "targetType": target_type})
            continue
        expected = values[source_id]
        try:
            actual = await _write_one_field(page, modal_root, mapping, expected, timeout_ms=timeout_ms, job_id=job_id)
        except SchoolAutomationError as exc:
            if exc.error_code == "SCHOOL_BOOTBOX_ERROR":
                raise
            try:
                diagnostic = json.loads(exc.message) if exc.message else {}
            except Exception:
                diagnostic = {"message": exc.message}
            bucket = "unsupportedFields" if exc.error_code == "FIELD_TARGET_TYPE_UNSUPPORTED" else "failedFields"
            report[bucket].append(
                {
                    "nodeId": source_id,
                    "selector": selector,
                    "targetType": target_type,
                    "reason": exc.error_code,
                    **diagnostic,
                }
            )
            continue
        if job_id:
            await _raise_if_blocking_bootbox(
                page,
                job_id=job_id,
                current_step="school.submit.filling",
                phase=f"field_{source_id}_after_write",
            )
        if target_type == "wysiwyg_image":
            report["succeededFields"].append({"nodeId": source_id, "selector": selector, "targetType": target_type, "actualLength": len(str(actual or ""))})
            continue
        expected_text = str(expected)
        if expected_text.strip() not in str(actual or "").strip() and str(actual or "").strip() != expected_text.strip():
            report["failedFields"].append({"nodeId": source_id, "selector": selector, "targetType": target_type, "reason": "value_mismatch"})
        else:
            report["succeededFields"].append({"nodeId": source_id, "selector": selector, "targetType": target_type, "actualLength": len(str(actual or ""))})
    return report


SUBMIT_FEEDBACK_SCRIPT = """
    () => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const bodies = Array.from(document.querySelectorAll('.bootbox .bootbox-body'));
      return bodies
        .filter((body) => visible(body) && visible(body.closest('.bootbox')))
        .map((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(-5);
    }
"""


async def _read_submit_feedback_messages(page: Any) -> List[str]:
    try:
        messages = await page.evaluate(SUBMIT_FEEDBACK_SCRIPT)
    except Exception:
        return []
    return [str(message).strip() for message in (messages or []) if str(message or "").strip()]


async def _collect_submit_feedback_diagnostic(page: Any, stage: str, *, timeout_ms: int, wait_error: Optional[str] = None) -> Dict[str, Any]:
    diagnostic_script = """
        ({ stage, timeoutMs, waitError }) => {
          const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && rect.width > 0
              && rect.height > 0;
          };
          const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
          const bootboxes = Array.from(document.querySelectorAll('.bootbox')).map((box) => ({
            className: box.className || '',
            ariaHidden: box.getAttribute('aria-hidden'),
            display: window.getComputedStyle(box).display,
            visible: visible(box),
            bodyText: textOf(box.querySelector('.bootbox-body')).slice(0, 500),
          }));
          const modalSelectors = ['#kvFileinputModal', '.file-zoom-dialog', '.wysiwyg-popup', '.modal:not(.bootbox)'];
          const modalMap = new Map();
          for (const selector of modalSelectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              if (!modalMap.has(el)) modalMap.set(el, selector);
            }
          }
          const visibleModalSummaries = Array.from(modalMap.entries())
            .filter(([el]) => visible(el))
            .map(([el, selector]) => ({
              selectorHint: selector,
              id: el.id || '',
              className: el.className || '',
              textPreview: textOf(el).slice(0, 500),
            }))
            .slice(0, 8);
          return {
            submitStage: stage,
            feedbackTimeoutMs: timeoutMs,
            waitError,
            currentUrl: window.location.href,
            visibleBootboxCount: bootboxes.filter((item) => item.visible).length,
            bootboxCandidates: bootboxes,
            visibleModalSummaries,
            hasWysiwygPopup: Array.from(document.querySelectorAll('.wysiwyg-popup')).some(visible),
            hasFileUploadDialog: Array.from(document.querySelectorAll('#kvFileinputModal, .file-zoom-dialog')).some(visible),
            modalBackdropCount: document.querySelectorAll('.modal-backdrop').length,
            bodyClassName: document.body?.className || '',
          };
        }
    """
    try:
        return await page.evaluate(
            diagnostic_script,
            {"stage": stage, "timeoutMs": timeout_ms, "waitError": wait_error},
        )
    except Exception as exc:
        return {
            "submitStage": stage,
            "feedbackTimeoutMs": timeout_ms,
            "waitError": wait_error,
            "diagnosticError": f"{type(exc).__name__}: {exc}",
        }


async def _click_submit_and_wait_feedback(page: Any, config: Dict[str, Any], mode: str, *, job_id: Optional[str] = None) -> Dict[str, Any]:
    if mode == "draft":
        selector = deep_get(config, "selectors.modal.saveDraft", "#ReportModal button:has-text('临时提交')")
        fallback_selector = "#ReportModal input[value='临时提交'], #ReportModal button:has-text('临时提交'), #ReportModal a:has-text('临时提交')"
        missing_code = "DRAFT_SUBMIT_BUTTON_MISSING"
        missing_reason = "学校临时提交按钮缺失"
    else:
        selector = deep_get(config, "selectors.modal.submitFinal", "#ReportModal button:has-text('正式提交')")
        fallback_selector = "#ReportModal input[value='正式提交'], #ReportModal button:has-text('正式提交'), #ReportModal a:has-text('正式提交')"
        missing_code = "FINAL_SUBMIT_BUTTON_MISSING"
        missing_reason = "学校正式提交按钮缺失"
    timeout_ms = safe_int(deep_get(config, "waitPolicy.submitFeedbackTimeoutMs"), 30000)
    settle_ms = safe_int(
        deep_get(config, "waitPolicy.submitFeedbackSettleMs"),
        safe_int(deep_get(config, "waitPolicy.afterClickMs"), 300),
    )
    locator = page.locator(selector).first
    if await locator.count() == 0:
        locator = page.locator(fallback_selector).first
    if await locator.count() == 0:
        raise SchoolAutomationError(missing_code, missing_reason, current_step="school.submit.submitAction")

    before_click_diagnostic = await _collect_submit_feedback_diagnostic(page, "before_click", timeout_ms=timeout_ms)
    page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
    await locator.click()
    if settle_ms > 0:
        await asyncio.sleep(settle_ms / 1000)
    wait_error: Optional[str] = None
    try:
        await page.wait_for_function(
            """
            (feedbackScript) => {
              const messages = Function(`return (${feedbackScript})`)()();
              return messages.length > 0;
            }
            """,
            arg=SUBMIT_FEEDBACK_SCRIPT,
            timeout=timeout_ms,
        )
    except Exception as exc:
        wait_error = f"{type(exc).__name__}: {exc}"
    if settle_ms > 0:
        await asyncio.sleep(min(settle_ms, 500) / 1000)
    messages = await _read_submit_feedback_messages(page)
    submit_accepted = any(re.search(r"提交成功|保存成功|成功", message) for message in messages)
    if messages and not submit_accepted:
        artifacts = await _save_bootbox_artifacts(page, _artifact_dir(job_id), "submit_feedback") if job_id else {}
        raise SchoolAutomationError(
            "SCHOOL_BOOTBOX_ERROR",
            f"学校系统弹窗提示：{messages[-1][:200]}",
            message=json.dumps(
                {
                    "stage": "submit_feedback",
                    "feedback": messages,
                    "artifacts": artifacts,
                    "beforeClickDiagnostic": before_click_diagnostic,
                },
                ensure_ascii=False,
            ),
            current_step="school.submit.confirming",
        )
    if not messages:
        timeout_diagnostic = await _collect_submit_feedback_diagnostic(
            page,
            "submit_feedback_timeout",
            timeout_ms=timeout_ms,
            wait_error=wait_error,
        )
        raise SchoolAutomationError(
            "SUBMIT_FEEDBACK_TIMEOUT",
            "未收到学校系统提交反馈",
            message=json.dumps(
                {
                    "stage": "submit_feedback",
                    "feedback": [],
                    "beforeClickDiagnostic": before_click_diagnostic,
                    "timeoutDiagnostic": timeout_diagnostic,
                },
                ensure_ascii=False,
            ),
            current_step="school.submit.confirming",
        )
    return {
        "feedback": messages,
        "submitAccepted": submit_accepted,
    }


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


def _school_status_confirms_submit(mode: str, school_status: Optional[str]) -> bool:
    if mode == "draft":
        return school_status == "school_draft_submitted"
    return school_status in {"school_final_submitted", "school_graded"}


def _field_report_summary(field_report: Any) -> Dict[str, Any]:
    if not isinstance(field_report, dict):
        return {}
    summary: Dict[str, Any] = {
        "succeededCount": len(field_report.get("succeededFields") or []),
        "skippedEmptyCount": len(field_report.get("skippedEmptyFields") or []),
        "missingCount": len(field_report.get("missingFields") or []),
        "failedCount": len(field_report.get("failedFields") or []),
        "unsupportedCount": len(field_report.get("unsupportedFields") or []),
        "mappingAuditCount": len(field_report.get("mappingAudit") or []),
        "blockingFields": [],
    }
    for key in ["missingFields", "failedFields", "unsupportedFields"]:
        for item in (field_report.get(key) or [])[:10]:
            summary["blockingFields"].append(
                {
                    "nodeId": item.get("nodeId") or item.get("sourceId"),
                    "targetType": item.get("targetType"),
                    "selector": item.get("selector") or item.get("targetLocator"),
                    "reason": item.get("reason") or item.get("stage") or key,
                }
            )
    return summary


def _submit_audit_action(job_action: str, suffix: str) -> str:
    if job_action == "draft_submit":
        return f"school_draft_submit_{suffix}"
    if job_action == "final_submit":
        return f"school_final_submit_{suffix}"
    raise ValueError(f"Unsupported submit job action: {job_action}")


def _failed_audit_action(job_action: str) -> str:
    if job_action in ["draft_submit", "final_submit"]:
        return _submit_audit_action(job_action, "failed")
    if job_action == "school_detail_sync":
        return "school_detail_sync_failed"
    if job_action == "school_report_screenshot":
        return "school_report_screenshot_failed"
    if job_action == "school_overview_sync":
        return "school_overview_sync_failed"
    return f"{job_action}_failed"


def _activate_submit_job_when_ready(job_id: str) -> bool:
    deadline = time.monotonic() + SUBMIT_QUEUE_TIMEOUT_SECONDS
    while True:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job or job.status not in ACTIVE_JOB_STATUSES:
                return False
            earlier_active_job = session.exec(
                select(AutomationJob)
                .where(AutomationJob.actor_user_id == job.actor_user_id)
                .where(AutomationJob.id != job.id)
                .where(AutomationJob.status.in_(ACTIVE_JOB_STATUSES))
                .where(AutomationJob.created_at < job.created_at)
                .order_by(AutomationJob.created_at.asc())
            ).first()
            if not earlier_active_job:
                now = get_utc_now()
                job.status = "running"
                job.public_status = "running"
                job.started_at = job.started_at or now
                job.updated_at = now
                session.add(job)
                session.commit()
                return True
        if time.monotonic() >= deadline:
            with Session(engine) as session:
                job = session.get(AutomationJob, job_id)
                if job:
                    _mark_job_failed(
                        session,
                        job,
                        SchoolAutomationError(
                            "SUBMIT_QUEUE_TIMEOUT",
                            "学校系统提交排队超时",
                            message="等待前序学校系统任务完成超时",
                            current_step="school.submit.queueing",
                        ),
                    )
                    session.commit()
            return False
        time.sleep(SUBMIT_QUEUE_POLL_SECONDS)


def _failed_audit_target_id(job: AutomationJob) -> Optional[str]:
    if job.action in ["draft_submit", "final_submit"]:
        return job.submission_id
    return job.id


def _mark_job_failed(session: Session, job: AutomationJob, error: SchoolAutomationError) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    if job.action in ["draft_submit", "final_submit"]:
        job.public_message_code = "school.submit.failed"
    elif job.action == "school_report_screenshot":
        job.public_message_code = "school.screenshot.failed"
    else:
        job.public_message_code = "school.detail.failed"
    job.public_message_params = {"reason": error.reason}
    job.error_code = error.error_code
    job.error_message = error.message[:1000]
    result_payload = {"errorCode": error.error_code, "currentStep": error.current_step}
    parsed_error_message: Dict[str, Any] = {}
    if error.message:
        parsed_error_message = _parse_json_object(error.message)
        result_payload["errorDetail"] = parsed_error_message
        for key in ["fieldWriteReport", "feedback", "submitError", "artifacts", "openedSummary", "status", "statusError", "submitStage", "phase", "bootbox", "sessionDiagnostic"]:
            if key in parsed_error_message:
                result_payload[key] = parsed_error_message[key]
        if "fieldWriteReport" not in parsed_error_message and parsed_error_message.get("nodeId"):
            result_payload["fieldDiagnostic"] = parsed_error_message
    diagnostic_user_id = job.actor_user_id
    if job.submission_id:
        failed_submission = session.get(Submission, job.submission_id)
        if failed_submission:
            diagnostic_user_id = failed_submission.student_id
    if diagnostic_user_id:
        browser_session = school_session_manager.get(diagnostic_user_id)
        if browser_session and browser_session.last_diagnostic:
            result_payload["sessionDiagnostic"] = browser_session.last_diagnostic
        should_reset_session = error.error_code in {
            "SCHOOL_BOOTBOX_ERROR",
            "REPORT_MODAL_NOT_FOUND",
            "REPORT_ROW_NOT_FOUND",
            "REPORT_OPEN_BUTTON_DISABLED",
            "REPORT_OPEN_BUTTON_MISSING",
            "SCHOOL_SUBMIT_UNKNOWN_ERROR",
        }
        if should_reset_session:
            session_reset: Dict[str, Any] = {"attempted": True}
            try:
                school_session_manager.run(
                    school_session_manager.close(diagnostic_user_id, reason=f"school_submit_failed:{error.error_code}")
                )
                session_reset["closed"] = True
            except Exception as exc:
                session_reset = {
                    "attempted": True,
                    "closed": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            result_payload["sessionReset"] = session_reset
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
    audit_payload: Dict[str, Any] = {
        "errorCode": error.error_code,
        "reason": error.reason,
        "currentStep": error.current_step,
    }
    if parsed_error_message:
        audit_payload["errorDetail"] = parsed_error_message
    field_report = result_payload.get("fieldWriteReport") if isinstance(result_payload, dict) else None
    if isinstance(field_report, dict):
        audit_payload["fieldWriteSummary"] = _field_report_summary(field_report)
    elif parsed_error_message.get("nodeId"):
        audit_payload["fieldDiagnosticSummary"] = {
            "nodeId": parsed_error_message.get("nodeId"),
            "targetType": parsed_error_message.get("targetType", "unknown"),
            "stage": parsed_error_message.get("stage", "write"),
            "targetLocator": parsed_error_message.get("targetLocator"),
        }
    if result_payload.get("feedback"):
        audit_payload["feedback"] = result_payload["feedback"]
    if result_payload.get("artifacts"):
        audit_payload["artifacts"] = result_payload["artifacts"]
    session.add(
        AuditLog(
            user_id=job.actor_user_id,
            action=_failed_audit_action(job.action),
            status="failed",
            target_id=_failed_audit_target_id(job),
            details=json.dumps(audit_payload, ensure_ascii=False, indent=2)[:8000],
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


async def _capture_report_long_screenshot(
    page: Any,
    config: Dict[str, Any],
    out_dir: Path,
    filename: str = "report_long_screenshot.png",
) -> str:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    screenshot_path = out_dir / filename
    expanded = False
    try:
        expanded = bool(
            await page.evaluate(
                """
                ({ modalRoot }) => {
                  const root = document.querySelector(modalRoot);
                  if (!root) return false;
                  const content = root.querySelector('.modal-content') || root;
                  const body = root.querySelector('.modal-body') || content;
                  const dialog = root.querySelector('.modal-dialog') || content;
                  const targets = [root, dialog, content, body, document.body, document.documentElement].filter(Boolean);
                  window.__labPReportScreenshotStyles = targets.map((el) => ({
                    el,
                    style: el.getAttribute('style') || '',
                  }));
                  root.style.display = 'block';
                  root.style.position = 'absolute';
                  root.style.inset = '0 auto auto 0';
                  root.style.overflow = 'visible';
                  root.style.height = 'auto';
                  dialog.style.margin = '0';
                  dialog.style.width = '1200px';
                  dialog.style.maxWidth = 'none';
                  content.style.overflow = 'visible';
                  content.style.height = 'auto';
                  content.style.maxHeight = 'none';
                  body.style.overflow = 'visible';
                  body.style.height = 'auto';
                  body.style.maxHeight = 'none';
                  const width = Math.ceil(Math.max(1200, content.scrollWidth, body.scrollWidth, document.documentElement.scrollWidth));
                  const height = Math.ceil(Math.max(content.scrollHeight, body.scrollHeight, root.scrollHeight, document.documentElement.scrollHeight));
                  document.body.style.width = `${width}px`;
                  document.body.style.minHeight = `${height + 80}px`;
                  document.documentElement.style.width = `${width}px`;
                  document.documentElement.style.minHeight = `${height + 80}px`;
                  window.scrollTo(0, 0);
                  return true;
                }
                """,
                {"modalRoot": modal_root},
            )
        )
        await page.wait_for_timeout(200)
    except Exception:
        expanded = False

    try:
        target = page.locator(f"{modal_root} .modal-content").first
        if await target.count() == 0:
            target = page.locator(modal_root).first
        if await target.count() > 0:
            await target.screenshot(path=str(screenshot_path))
        else:
            await page.screenshot(path=str(screenshot_path), full_page=True)
    finally:
        if expanded:
            try:
                await page.evaluate(
                    """
                    () => {
                      const saved = window.__labPReportScreenshotStyles || [];
                      saved.forEach(({ el, style }) => {
                        if (!el) return;
                        if (style) el.setAttribute('style', style);
                        else el.removeAttribute('style');
                      });
                      delete window.__labPReportScreenshotStyles;
                    }
                    """
                )
            except Exception:
                pass
    return str(screenshot_path)


def run_school_report_screenshot(job_id: str, user_id: int, experiment_id: str) -> None:
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            experiment_name = _experiment_display_name(session, experiment_id)

        async def _run_screenshot() -> Tuple[SchoolReportOpenResult, str]:
            async with school_session_manager.user_operation(user.id):
                page, opened = await open_report_modal(
                    job_id,
                    user,
                    experiment_id,
                    experiment_name,
                    config,
                    step_group="screenshot",
                    read_snapshot=False,
                )
                set_job_progress(job_id, "school.screenshot.capturing")
                screenshot_path = await _capture_report_long_screenshot(page, config, _artifact_dir(job_id))
                return opened, screenshot_path

        opened, screenshot_path = school_session_manager.run(_run_screenshot())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job or job.status not in ["queued", "running", "retrying"]:
                return
            now = get_utc_now()
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.screenshot.success"
            job.result_payload = {
                "summary": opened.summary,
                "screenshot": {
                    "path": screenshot_path,
                    "contentType": "image/png",
                },
                "artifacts": {**opened.artifacts, "report_long_screenshot": screenshot_path},
                "sessionDiagnostic": opened.session_diagnostic,
            }
            job.finished_at = now
            job.updated_at = now
            session.add(job)
            session.add(
                AuditLog(
                    user_id=user_id,
                    action="school_report_screenshot_completed",
                    status="success",
                    target_id=job.id,
                    details="学校系统报告长截图已生成。",
                )
            )
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if job:
                _mark_job_failed(session, job, exc)
                session.commit()


def run_school_experiment_submit(job_id: str, submission_id: str, mode: str) -> None:
    try:
        if not _activate_submit_job_when_ready(job_id):
            return
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
                try:
                    page, opened = await asyncio.wait_for(
                        open_report_modal(
                            job_id,
                            user,
                            submission.experiment_id,
                            experiment_name,
                            config,
                            step_group="submit",
                            read_snapshot=False,
                            modal_timeout_ms=13000,
                        ),
                        timeout=SUBMIT_OPEN_REPORT_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    raise SchoolAutomationError(
                        "REPORT_MODAL_NOT_FOUND",
                        "学校实验报告窗口未打开",
                        message=json.dumps(
                            {
                                "phase": "open_report_modal_hard_timeout",
                                "timeoutSeconds": SUBMIT_OPEN_REPORT_TIMEOUT_SECONDS,
                                "experimentId": submission.experiment_id,
                                "experimentName": experiment_name,
                            },
                            ensure_ascii=False,
                        ),
                        current_step="school.submit.opening",
                    ) from exc
                set_job_progress(job_id, "school.submit.filling")
                field_write_report = await _write_and_verify_fields(page, config, submission, job_id=job_id)
                blocking_fields = (
                    field_write_report.get("failedFields", [])
                    + field_write_report.get("unsupportedFields", [])
                    + field_write_report.get("missingFields", [])
                )
                if blocking_fields:
                    raise SchoolAutomationError(
                        "FIELD_WRITE_VERIFY_FAILED",
                        "部分内容未能成功写入学校系统",
                        message=json.dumps({"fieldWriteReport": field_write_report}, ensure_ascii=False),
                        current_step="school.submit.verifying",
                    )
                await _raise_if_blocking_bootbox(
                    page,
                    job_id=job_id,
                    current_step="school.submit.filling",
                    phase="after_field_write",
                )
                set_job_progress(job_id, "school.submit.verifying")
                out_dir = _artifact_dir(job_id)
                before_artifacts = await _save_modal_artifacts(page, config, out_dir, "02_before_submit")
                set_job_progress(job_id, "school.submit.submittingDraft" if mode == "draft" else "school.submit.submittingFinal")
                try:
                    feedback_result = await _click_submit_and_wait_feedback(page, config, mode, job_id=job_id)
                except SchoolAutomationError as exc:
                    failure_artifacts: Dict[str, str] = {}
                    try:
                        failure_artifacts = await _save_modal_artifacts(page, config, out_dir, "03_submit_failed")
                    except Exception as artifact_exc:
                        failure_artifacts = {"submit_failed_artifact_error": f"{type(artifact_exc).__name__}: {artifact_exc}"}
                    submit_error = _parse_json_object(exc.message)
                    raise SchoolAutomationError(
                        exc.error_code,
                        exc.reason,
                        message=json.dumps(
                            {
                                "submitStage": "submit_feedback",
                                "submitError": submit_error,
                                "feedback": submit_error.get("feedback") or [],
                                "fieldWriteReport": field_write_report,
                                "artifacts": {**opened.artifacts, **before_artifacts, **failure_artifacts},
                                "openedSummary": opened.summary,
                            },
                            ensure_ascii=False,
                        ),
                        current_step=exc.current_step,
                    ) from exc
                set_job_progress(job_id, "school.submit.confirming")
                await _close_submit_feedback_dialog(page, config)
                await _close_modal_if_present(page, config)
                set_job_progress(job_id, "school.submit.readingStatus")
                status: Optional[Dict[str, str]] = None
                status_error: Optional[str] = None
                try:
                    status = await _read_experiment_status_from_list(page, config, opened.experiment_name)
                except SchoolAutomationError as exc:
                    status_error = f"{exc.error_code}: {exc.reason}"
                    if not feedback_result.get("submitAccepted"):
                        raise
                after_path = out_dir / "03_after_submit_list.png"
                await page.screenshot(path=str(after_path), full_page=True)
                school_status = status.get("schoolStatus") if status else None
                list_confirmed = _school_status_confirms_submit(mode, school_status)
                status_confirmation = "list_confirmed" if list_confirmed else (
                    "feedback_only" if feedback_result.get("submitAccepted") else "unconfirmed"
                )
                return {
                    "opened": opened,
                    "feedback": feedback_result.get("feedback") or [],
                    "submitAccepted": bool(feedback_result.get("submitAccepted")),
                    "statusConfirmation": status_confirmation,
                    "status": status,
                    "statusError": status_error,
                    "fieldWriteReport": field_write_report,
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
            status = result.get("status") or {}
            school_status = status.get("schoolStatus")
            submit_accepted = bool(result.get("submitAccepted"))
            if not submit_accepted and not _school_status_confirms_submit(mode, school_status):
                raise SchoolAutomationError(
                    "SCHOOL_STATUS_NOT_CONFIRMED",
                    "学校系统未确认临时提交状态",
                    message=json.dumps(status, ensure_ascii=False),
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
                    "submitAccepted": submit_accepted,
                    "statusConfirmation": result.get("statusConfirmation"),
                    "status": status,
                    "statusError": result.get("statusError"),
                    "fieldWriteReport": result.get("fieldWriteReport"),
                    "modalBeforeSubmit": result["opened"].snapshot,
                },
                summary_json={
                    "source": "school_submit_confirmed",
                    "mode": mode,
                    "submitAccepted": submit_accepted,
                    "statusConfirmation": result.get("statusConfirmation"),
                    **status,
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
                "status": status,
                "feedback": result["feedback"],
                "submitAccepted": submit_accepted,
                "statusConfirmation": result.get("statusConfirmation"),
                "statusError": result.get("statusError"),
                "fieldWriteReport": result.get("fieldWriteReport"),
                "artifacts": result["artifacts"],
                "sessionDiagnostic": result["sessionDiagnostic"],
            }
            job.finished_at = now
            job.updated_at = now
            session.add(snapshot)
            session.add(submission)
            session.add(job)
            submit_label = "正式提交" if mode == "final" else "临时提交"
            audit_details = (
                f"学校系统{submit_label}状态已确认。job_id={job.id}"
                if result.get("statusConfirmation") == "list_confirmed"
                else f"学校系统已返回{submit_label}成功，列表状态待后续同步确认。job_id={job.id}"
            )
            session.add(AuditLog(
                user_id=job.actor_user_id,
                action=f"school_{mode}_submit_completed",
                status="success",
                target_id=submission.id,
                details=audit_details,
            ))
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
