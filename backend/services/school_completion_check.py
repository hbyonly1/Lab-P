from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from core.db import engine
from models.core import AuditLog, AutomationJob, Experiment, User, get_utc_now
from services.school_overview_sync import (
    SchoolAutomationError,
    deep_get,
    load_active_config,
    perform_school_overview_sync,
    set_job_progress,
)
from services.school_report_sync import (
    _close_modal_if_present,
    _read_experiment_config,
    _return_to_report_list,
    open_report_modal,
)
from services.school_session_manager import school_session_manager


CHECKABLE_SCHOOL_STATUSES = {"school_draft_submitted", "school_final_submitted"}
DEFAULT_COMPLETION_CHECK_TIMEOUT_MS = 300000


def _graded_skip_reason(score: Any) -> str:
    return f"学校系统已评分：{score}，完成报告不可打开" if score else "学校系统已评分，完成报告不可打开"


def _normalize_name(value: Any) -> str:
    return "".join(str(value or "").split())


def _enabled_experiments(session: Session) -> List[Experiment]:
    experiments = session.exec(select(Experiment)).all()
    visible: List[Experiment] = []
    for experiment in experiments:
        config = experiment.config_json or {}
        meta = config.get("meta") or {}
        enabled = meta.get("enabled", True)
        if enabled is False or (isinstance(enabled, str) and enabled.strip().lower() in {"false", "0", "no", "off"}):
            continue
        visible.append(experiment)
    return sorted(
        visible,
        key=lambda item: int(((item.config_json or {}).get("meta") or {}).get("sortOrder", 9999) or 9999),
    )


def _enabled_experiments_by_ids(session: Session, experiment_ids: Optional[List[str]]) -> List[Experiment]:
    experiments = _enabled_experiments(session)
    if not experiment_ids:
        return experiments
    allowed_ids = {str(experiment_id) for experiment_id in experiment_ids if experiment_id}
    return [experiment for experiment in experiments if experiment.id in allowed_ids]


def _node_labels(config: Dict[str, Any]) -> Dict[str, str]:
    labels: Dict[str, str] = {}
    for field in (config.get("inputs") or {}).get("fields", []):
        field_id = field.get("id")
        if field_id:
            labels[str(field_id)] = str(field.get("label") or field.get("title") or field_id)

    ui = config.get("ui") or {}
    for table in ui.get("dataTables") or []:
        caption = str(table.get("caption") or "")
        for row in table.get("rows") or []:
            cells = row.get("cells") or []
            row_label = next((str(cell.get("text")) for cell in cells if cell.get("text")), caption)
            for cell in cells:
                node_id = cell.get("nodeId")
                if node_id:
                    labels.setdefault(str(node_id), row_label or str(node_id))

    for question in ui.get("questions") or []:
        node_id = question.get("nodeId")
        if node_id:
            labels.setdefault(str(node_id), str(question.get("title") or question.get("prompt") or question.get("label") or node_id))

    return labels


def _completion_mappings(experiment_id: str, config: Dict[str, Any]) -> List[Dict[str, str]]:
    labels = _node_labels(config)
    mappings = ((config.get("automation") or {}).get("mappings") or [])
    result: List[Dict[str, str]] = []
    seen = set()
    for item in mappings:
        source_id = str(item.get("sourceId") or "").strip()
        selector = str(item.get("targetLocator") or "").strip()
        if not source_id or not selector or source_id in seen:
            continue
        seen.add(source_id)
        result.append(
            {
                "sourceId": source_id,
                "targetLocator": selector,
                "targetType": str(item.get("targetType") or "text"),
                "label": labels.get(source_id) or source_id,
            }
        )
    return result


async def _read_fast_missing_fields(page: Any, config: Dict[str, Any], mappings: List[Dict[str, str]]) -> List[Dict[str, str]]:
    modal_root = deep_get(config, "selectors.modal.root", "#ReportModal")
    return await page.evaluate(
        """
        ({ modalRoot, mappings }) => {
          const root = document.querySelector(modalRoot) || document;
          const normalize = (value) => String(value || '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\\u00a0/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
          const htmlHasMeaning = (html) => normalize(String(html || '').replace(/<br\\s*\\/?>/gi, '').replace(/<[^>]+>/g, '')) !== '';
          const result = [];

          for (const mapping of mappings) {
            const target = root.querySelector(mapping.targetLocator) || document.querySelector(mapping.targetLocator);
            if (!target) {
              result.push({ key: mapping.sourceId, label: mapping.label, reason: '节点不存在' });
              continue;
            }

            const wrapper = target.closest('.wysiwyg-wrapper');
            const container = target.closest('.wysiwyg-container') || (wrapper && wrapper.closest('.wysiwyg-container'));
            const editor = (wrapper || container || target.parentElement)?.querySelector('.wysiwyg-editor[contenteditable="true"], .wysiwyg-editor');
            let filled = false;

            if (mapping.targetType === 'wysiwyg_image') {
              filled = Boolean(editor?.querySelector('img')) || /<img\\b/i.test(String(target.value || target.innerHTML || ''));
            } else if (mapping.targetType === 'wysiwyg_text') {
              filled = normalize(editor?.innerText || editor?.textContent || '').length > 0
                || htmlHasMeaning(editor?.innerHTML)
                || normalize(target.value || target.textContent || '').length > 0;
            } else if (target.tagName === 'SELECT') {
              filled = normalize(target.value).length > 0;
            } else if ('value' in target) {
              filled = normalize(target.value).length > 0;
            } else if (target.isContentEditable) {
              filled = normalize(target.innerText || target.textContent || '').length > 0 || htmlHasMeaning(target.innerHTML);
            } else {
              filled = normalize(target.innerText || target.textContent || target.innerHTML || '').length > 0;
            }

            if (!filled) result.push({ key: mapping.sourceId, label: mapping.label, reason: '空值' });
          }
          return result;
        }
        """,
        {"modalRoot": modal_root, "mappings": mappings},
    )


def _apply_experiment_completion_overrides(
    experiment_id: str,
    mappings: List[Dict[str, str]],
    missing: List[Dict[str, str]],
) -> List[Dict[str, str]]:
    if experiment_id != "exp_falling_ball_viscosity":
        return missing

    optional_temperature_nodes = {
        "L20-0",
        "L21-0",
        "L22-0",
        "L23-0",
        "L24-0",
        "L25-0",
        "L26-0",
        "L27-0",
    }
    mapped_optional_nodes = {
        str(item.get("sourceId") or "")
        for item in mappings
        if str(item.get("sourceId") or "") in optional_temperature_nodes
    }
    if not mapped_optional_nodes:
        return missing

    missing_optional_nodes = {
        str(item.get("key") or "")
        for item in missing
        if str(item.get("key") or "") in mapped_optional_nodes
    }
    filled_optional_count = len(mapped_optional_nodes) - len(missing_optional_nodes)
    if filled_optional_count < 4:
        return missing

    return [
        item
        for item in missing
        if str(item.get("key") or "") not in mapped_optional_nodes
    ]


async def _run_school_completion_check(job_id: str, user: User, config: Dict[str, Any], experiments: List[Experiment]) -> Dict[str, Any]:
    set_job_progress(job_id, "school.completion.connecting")
    overview = await perform_school_overview_sync(job_id=job_id, user=user, config=config)
    school_by_name = {
        _normalize_name(item.get("experimentName")): item
        for item in overview.experiments
        if _normalize_name(item.get("experimentName"))
    }
    browser_session = school_session_manager.get(user.id)
    if not browser_session or not browser_session.page:
        raise SchoolAutomationError(
            "SCHOOL_SESSION_UNAVAILABLE",
            "学校系统会话不可用",
            current_step="school.completion.connecting",
        )
    page = browser_session.page

    results: List[Dict[str, Any]] = []
    for index, experiment in enumerate(experiments, start=1):
        exp_config = experiment.config_json or _read_experiment_config(experiment.id) or {}
        meta = exp_config.get("meta") or {}
        experiment_name = str(meta.get("name") or experiment.title or experiment.id)
        school_item = school_by_name.get(_normalize_name(experiment_name)) or {}
        school_status = school_item.get("schoolStatus") or "school_unknown"
        original_status_text = school_item.get("originalStatusText") or ""
        score = school_item.get("score") or ""

        if school_status not in CHECKABLE_SCHOOL_STATUSES:
            results.append(
                {
                    "experimentId": experiment.id,
                    "experimentName": experiment_name,
                    "schoolStatus": school_status,
                    "originalStatusText": original_status_text,
                    "score": score,
                    "checkStatus": "skipped",
                    "complete": False,
                    "missing": [],
                    "reason": _graded_skip_reason(score) if school_status == "school_graded" else "学校状态未临时提交或正式提交，跳过检查",
                }
            )
            continue

        detail_page = page
        try:
            detail_page, opened = await open_report_modal(
                job_id,
                user,
                experiment.id,
                experiment_name,
                config,
                step_group="completion",
                read_snapshot=False,
                modal_timeout_ms=13000,
            )
            mappings = _completion_mappings(experiment.id, exp_config)
            set_job_progress(
                job_id,
                "school.completion.checkingExperiment",
                {"experimentName": experiment_name, "current": index, "total": len(experiments)},
            )
            missing = await _read_fast_missing_fields(detail_page, config, mappings)
            missing = _apply_experiment_completion_overrides(experiment.id, mappings, missing)
            results.append(
                {
                    "experimentId": experiment.id,
                    "experimentName": opened.experiment_name or experiment_name,
                    "schoolStatus": school_status,
                    "originalStatusText": original_status_text,
                    "score": score,
                    "checkStatus": "checked",
                    "complete": len(missing) == 0,
                    "missing": missing,
                }
            )
        except SchoolAutomationError as exc:
            results.append(
                {
                    "experimentId": experiment.id,
                    "experimentName": experiment_name,
                    "schoolStatus": school_status,
                    "originalStatusText": original_status_text,
                    "score": score,
                    "checkStatus": "error",
                    "complete": False,
                    "missing": [],
                    "reason": exc.reason,
                    "errorCode": exc.error_code,
                }
            )
        finally:
            try:
                await _close_modal_if_present(detail_page, config)
                await _return_to_report_list(detail_page, config)
            except Exception:
                pass

    checked = [item for item in results if item.get("checkStatus") == "checked"]
    complete_count = sum(1 for item in checked if item.get("complete"))
    missing_count = sum(len(item.get("missing") or []) for item in checked)
    skipped_count = sum(1 for item in results if item.get("checkStatus") == "skipped")
    error_count = sum(1 for item in results if item.get("checkStatus") == "error")
    return {
        "studentId": user.id,
        "studentNo": user.student_no,
        "realName": overview.real_name or user.real_name,
        "summary": {
            "experimentCount": len(results),
            "checkedExperimentCount": len(checked),
            "completeExperimentCount": complete_count,
            "incompleteExperimentCount": len(checked) - complete_count,
            "skippedExperimentCount": skipped_count,
            "errorExperimentCount": error_count,
            "missingCount": missing_count,
        },
        "experiments": results,
    }


def _mark_completion_failed(session: Session, job: AutomationJob, error: SchoolAutomationError) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.completion.failed"
    job.public_message_params = {"reason": error.reason}
    job.error_code = error.error_code
    job.error_message = error.message[:1000]
    job.result_payload = {
        **(job.result_payload or {}),
        "errorCode": error.error_code,
        "reason": error.reason,
        "currentStep": error.current_step,
    }
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    session.add(
        AuditLog(
            user_id=job.actor_user_id,
            action="school_completion_check_failed",
            status="failed",
            target_id=job.id,
            details=json.dumps(job.result_payload, ensure_ascii=False),
        )
    )


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def run_school_completion_check(job_id: str, user_id: int, experiment_ids: Optional[List[str]] = None) -> None:
    config: Optional[Dict[str, Any]] = None
    timeout_ms = DEFAULT_COMPLETION_CHECK_TIMEOUT_MS
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            experiments = _enabled_experiments_by_ids(session, experiment_ids)
            runtime = config.get("runtime") or {}
            timeout_ms = max(
                _safe_int(runtime.get("completionCheckTimeoutMs"), DEFAULT_COMPLETION_CHECK_TIMEOUT_MS),
                30000,
            )

        async def _run() -> Dict[str, Any]:
            async with school_session_manager.user_operation(user.id):
                return await asyncio.wait_for(
                    _run_school_completion_check(job_id, user, config or {}, experiments),
                    timeout=timeout_ms / 1000,
                )

        result = school_session_manager.run(_run())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            now = get_utc_now()
            set_job_progress(job_id, "school.completion.savingResult")
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.completion.success"
            job.result_payload = {"completionCheck": result}
            job.finished_at = now
            job.updated_at = now
            session.add(job)
            session.add(
                AuditLog(
                    user_id=user_id,
                    action="school_completion_check_completed",
                    status="success",
                    target_id=job.id,
                    details=json.dumps(result.get("summary") or {}, ensure_ascii=False),
                )
            )
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            _mark_completion_failed(session, job, exc)
            session.commit()
    except asyncio.TimeoutError:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            _mark_completion_failed(
                session,
                job,
                SchoolAutomationError(
                    "COMPLETION_CHECK_TIMEOUT",
                    "检查填写完整性超时",
                    message=f"完整性检查超过 {timeout_ms // 1000} 秒未完成。",
                    current_step=job.public_message_code or "school.completion.checkingExperiment",
                ),
            )
            session.commit()
    except Exception as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            _mark_completion_failed(
                session,
                job,
                SchoolAutomationError(
                    "COMPLETION_CHECK_FAILED",
                    "检查填写完整性失败",
                    message=f"{type(exc).__name__}: {exc}",
                    current_step=job.public_message_code or "school.completion.checkingExperiment",
                ),
            )
            session.commit()
