from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from core.db import engine
from models.core import AuditLog, AutomationJob, Experiment, User, get_utc_now
from services.school_completion_check import CHECKABLE_SCHOOL_STATUSES, _enabled_experiments_by_ids, _graded_skip_reason, _normalize_name
from services.school_overview_sync import (
    SchoolAutomationError,
    load_active_config,
    perform_school_overview_sync,
    set_job_progress,
)
from services.school_report_sync import (
    _artifact_dir,
    _capture_report_long_screenshot,
    _close_modal_if_present,
    _read_experiment_config,
    _return_to_report_list,
    open_report_modal,
)
from services.school_session_manager import school_session_manager


def _safe_screenshot_filename(experiment_id: str) -> str:
    safe_id = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in str(experiment_id or "experiment"))
    return f"{safe_id}_report_long_screenshot.png"


async def _run_school_submission_screenshots(
    job_id: str,
    user: User,
    config: Dict[str, Any],
    experiments: List[Experiment],
) -> Dict[str, Any]:
    set_job_progress(job_id, "school.submissionScreenshots.connecting")
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
            current_step="school.submissionScreenshots.connecting",
        )
    page = browser_session.page
    out_dir = _artifact_dir(job_id)

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
                    "captureStatus": "skipped",
                    "screenshotAvailable": False,
                    "reason": _graded_skip_reason(score) if school_status == "school_graded" else "学校状态未临时提交或正式提交，跳过截图",
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
                step_group="submissionScreenshots",
                read_snapshot=False,
                modal_timeout_ms=13000,
            )
            set_job_progress(
                job_id,
                "school.submissionScreenshots.capturingExperiment",
                {"experimentName": opened.experiment_name or experiment_name},
            )
            screenshot_path = await _capture_report_long_screenshot(
                detail_page,
                config,
                out_dir,
                filename=_safe_screenshot_filename(experiment.id),
            )
            results.append(
                {
                    "experimentId": experiment.id,
                    "experimentName": opened.experiment_name or experiment_name,
                    "schoolStatus": school_status,
                    "originalStatusText": original_status_text,
                    "score": score,
                    "captureStatus": "captured",
                    "screenshotAvailable": True,
                    "screenshotPath": screenshot_path,
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
                    "captureStatus": "error",
                    "screenshotAvailable": False,
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

    captured_count = sum(1 for item in results if item.get("captureStatus") == "captured")
    skipped_count = sum(1 for item in results if item.get("captureStatus") == "skipped")
    error_count = sum(1 for item in results if item.get("captureStatus") == "error")
    return {
        "studentId": user.id,
        "studentNo": user.student_no,
        "realName": overview.real_name or user.real_name,
        "summary": {
            "experimentCount": len(results),
            "capturedExperimentCount": captured_count,
            "skippedExperimentCount": skipped_count,
            "errorExperimentCount": error_count,
        },
        "experiments": results,
    }


def _mark_screenshots_failed(session: Session, job: AutomationJob, error: SchoolAutomationError) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.submissionScreenshots.failed"
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
            action="school_submission_screenshots_failed",
            status="failed",
            target_id=job.id,
            details=json.dumps(job.result_payload, ensure_ascii=False),
        )
    )


def run_school_submission_screenshots(job_id: str, user_id: int, experiment_ids: Optional[List[str]] = None) -> None:
    config: Optional[Dict[str, Any]] = None
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            experiments = _enabled_experiments_by_ids(session, experiment_ids)

        async def _run() -> Dict[str, Any]:
            async with school_session_manager.user_operation(user.id):
                return await _run_school_submission_screenshots(job_id, user, config or {}, experiments)

        result = school_session_manager.run(_run())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            now = get_utc_now()
            set_job_progress(job_id, "school.submissionScreenshots.savingResult")
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.submissionScreenshots.success"
            job.result_payload = {"submissionScreenshots": result}
            job.finished_at = now
            job.updated_at = now
            session.add(job)
            session.add(
                AuditLog(
                    user_id=user_id,
                    action="school_submission_screenshots_completed",
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
            _mark_screenshots_failed(session, job, exc)
            session.commit()
