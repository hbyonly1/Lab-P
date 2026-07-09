from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from core.db import engine
from models.core import AuditLog, AutomationJob, Experiment, SchoolSyncSnapshot, User, get_utc_now
from services.school_overview_sync import (
    SchoolAutomationError,
    extract_report_list,
    load_active_config,
    set_job_progress,
    summarize_experiments,
)
from services.school_report_sync import (
    _artifact_dir,
    _click_submit_and_wait_feedback,
    _close_modal_if_present,
    _close_submit_feedback_dialog,
    _read_experiment_status_from_list,
    _return_to_report_list,
    get_or_login_school_page,
    open_report_modal,
)
from services.school_session_manager import school_session_manager


REQUIRED_SUBMITTED_COUNT = 8


def _normalize_school_name(value: Any) -> str:
    return "".join(str(value or "").split())


def _experiment_id_by_school_name(session: Session) -> Dict[str, str]:
    rows = session.exec(select(Experiment)).all()
    mapping: Dict[str, str] = {}
    for experiment in rows:
        config = experiment.config_json or {}
        meta = config.get("meta") or {}
        enabled = meta.get("enabled", True)
        if enabled is False or (isinstance(enabled, str) and enabled.strip().lower() in {"false", "0", "no", "off"}):
            continue
        name = meta.get("name") or experiment.title or experiment.id
        key = _normalize_school_name(name)
        if key:
            mapping[key] = experiment.id
    return mapping


def _mark_job_success(
    session: Session,
    *,
    job: AutomationJob,
    user: User,
    experiments: List[Dict[str, str]],
    processed: List[Dict[str, Any]],
) -> None:
    now = get_utc_now()
    summary = summarize_experiments(experiments, user.real_name)
    snapshot = SchoolSyncSnapshot(
        user_id=user.id,
        snapshot_json={
            "source": "admin_final_submit_drafts",
            "realName": user.real_name,
            "experiments": experiments,
        },
        summary_json=summary,
        synced_at=now,
        automation_job_id=job.id,
    )
    job.status = "succeeded"
    job.public_status = "succeeded"
    job.public_message_code = "school.finalSubmitDrafts.success"
    job.public_message_params = {"count": len(processed)}
    job.result_payload = {
        "summary": summary,
        "processed": processed,
        "experiments": experiments,
    }
    job.finished_at = now
    job.updated_at = now
    session.add(snapshot)
    session.add(job)
    session.add(
        AuditLog(
            user_id=job.actor_user_id or user.id,
            action="admin_student_final_submit_drafts_completed",
            status="success",
            target_id=str(user.id),
            details=f"已将 {len(processed)} 个临时提交实验转为正式提交。job_id={job.id}",
        )
    )


def _mark_job_failed(
    session: Session,
    *,
    job: AutomationJob,
    user_id: int,
    error: SchoolAutomationError,
) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.finalSubmitDrafts.failed"
    job.public_message_params = {"reason": error.reason}
    job.error_code = error.error_code
    job.error_message = error.message[:1000]
    job.result_payload = {
        "currentStep": error.current_step,
        "errorCode": error.error_code,
        "reason": error.reason,
        "message": error.message,
    }
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    session.add(
        AuditLog(
            user_id=job.actor_user_id or user_id,
            action="admin_student_final_submit_drafts_failed",
            status="failed",
            target_id=str(user_id),
            details=json.dumps(
                {
                    "jobId": job.id,
                    "errorCode": error.error_code,
                    "reason": error.reason,
                    "message": error.message,
                    "currentStep": error.current_step,
                },
                ensure_ascii=False,
            ),
        )
    )


def _save_confirmed_submit_snapshot(
    session: Session,
    *,
    user: User,
    job: AutomationJob,
    experiment_id: Optional[str],
    status: Dict[str, str],
    feedback: List[str],
) -> None:
    if not experiment_id:
        return
    now = get_utc_now()
    session.add(
        SchoolSyncSnapshot(
            user_id=user.id,
            submission_id=None,
            experiment_id=experiment_id,
            snapshot_json={
                "source": "school_submit_confirmed",
                "mode": "final",
                "feedback": feedback,
                "submitAccepted": True,
                "statusConfirmation": "list_confirmed",
                "status": status,
            },
            summary_json={
                "source": "school_submit_confirmed",
                "mode": "final",
                "submitAccepted": True,
                "statusConfirmation": "list_confirmed",
                **status,
            },
            synced_at=now,
            automation_job_id=job.id,
        )
    )


def run_admin_final_submit_drafts(job_id: str, user_id: int) -> None:
    config: Optional[Dict[str, Any]] = None
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            name_to_experiment_id = _experiment_id_by_school_name(session)

        async def _run() -> Dict[str, Any]:
            async with school_session_manager.user_operation(user.id):
                set_job_progress(job_id, "school.finalSubmitDrafts.connecting")
                page, _diagnostic = await get_or_login_school_page(job_id, user, config, "school.finalSubmitDrafts.connecting")
                set_job_progress(job_id, "school.overview.readingList")
                await _return_to_report_list(page, config)
                initial_experiments = await extract_report_list(page, config)
                submitted_items = [
                    item for item in initial_experiments
                    if item.get("schoolStatus") in {"school_draft_submitted", "school_final_submitted", "school_graded"}
                ]
                if len(submitted_items) != REQUIRED_SUBMITTED_COUNT:
                    raise SchoolAutomationError(
                        "FINAL_SUBMIT_DRAFTS_COUNT_MISMATCH",
                        f"当前正式提交和临时提交实验数量必须等于 {REQUIRED_SUBMITTED_COUNT}",
                        message=json.dumps(
                            {
                                "required": REQUIRED_SUBMITTED_COUNT,
                                "actual": len(submitted_items),
                                "draft": sum(1 for item in submitted_items if item.get("schoolStatus") == "school_draft_submitted"),
                                "final": sum(1 for item in submitted_items if item.get("schoolStatus") in {"school_final_submitted", "school_graded"}),
                            },
                            ensure_ascii=False,
                        ),
                        current_step="school.overview.readingList",
                    )
                draft_items = [
                    item for item in initial_experiments
                    if item.get("schoolStatus") == "school_draft_submitted"
                ]
                processed: List[Dict[str, Any]] = []
                for item in draft_items:
                    experiment_name = item.get("experimentName") or ""
                    set_job_progress(job_id, "school.finalSubmitDrafts.opening", {"experimentName": experiment_name})
                    experiment_id = name_to_experiment_id.get(_normalize_school_name(experiment_name)) or experiment_name
                    page, opened = await open_report_modal(
                        job_id,
                        user,
                        experiment_id,
                        experiment_name,
                        config,
                        step_group="submit",
                        read_snapshot=False,
                    )
                    out_dir = _artifact_dir(job_id)
                    set_job_progress(job_id, "school.submit.submittingFinal", {"experimentName": experiment_name})
                    feedback = await _click_submit_and_wait_feedback(page, config, "final", job_id=job_id)
                    await _close_submit_feedback_dialog(page, config)
                    await _close_modal_if_present(page, config)
                    set_job_progress(job_id, "school.submit.readingStatus", {"experimentName": experiment_name})
                    status = await _read_experiment_status_from_list(page, config, opened.experiment_name)
                    if status.get("schoolStatus") != "school_final_submitted":
                        raise SchoolAutomationError(
                            "FINAL_SUBMIT_STATUS_NOT_CONFIRMED",
                            f"{experiment_name} 未确认正式提交状态",
                            message=json.dumps(status, ensure_ascii=False),
                            current_step="school.submit.readingStatus",
                        )
                    try:
                        after_path = out_dir / f"final_submit_{len(processed) + 1:02d}.png"
                        await page.screenshot(path=str(after_path), full_page=True)
                    except Exception:
                        after_path = None
                    processed.append(
                        {
                            "experimentName": status.get("experimentName") or experiment_name,
                            "experimentId": name_to_experiment_id.get(_normalize_school_name(status.get("experimentName") or experiment_name)),
                            "feedback": feedback.get("feedback") or [],
                            "status": status,
                            "screenshot": str(after_path) if after_path else "",
                        }
                    )
                set_job_progress(job_id, "school.finalSubmitDrafts.refreshing")
                await _return_to_report_list(page, config)
                final_experiments = await extract_report_list(page, config)
                return {"experiments": final_experiments, "processed": processed}

        result = school_session_manager.run(_run())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            for item in result.get("processed") or []:
                _save_confirmed_submit_snapshot(
                    session,
                    user=user,
                    job=job,
                    experiment_id=item.get("experimentId"),
                    status=item.get("status") or {},
                    feedback=item.get("feedback") or [],
                )
            _mark_job_success(
                session,
                job=job,
                user=user,
                experiments=result.get("experiments") or [],
                processed=result.get("processed") or [],
            )
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            _mark_job_failed(session, job=job, user_id=user_id, error=exc)
            session.commit()
    except Exception as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            _mark_job_failed(
                session,
                job=job,
                user_id=user_id,
                error=SchoolAutomationError(
                    "FINAL_SUBMIT_DRAFTS_UNKNOWN_ERROR",
                    "批量正式提交失败",
                    message=str(exc),
                    current_step=job.public_message_code,
                ),
                config=config,
            )
            session.commit()
