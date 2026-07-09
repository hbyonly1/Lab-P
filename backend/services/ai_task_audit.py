import json
from typing import Any, Optional

from sqlmodel import Session, func, select

from models.core import AiTaskRun, AuditLog, get_utc_now


AI_ASSIST_ACTIONS = {
    "fixed_fill": {
        "started": "ai_fixed_fill_started",
        "completed": "ai_fixed_fill_completed",
        "failed": "ai_fixed_fill_failed",
    },
    "image_recognition": {
        "started": "ai_recognition_started",
        "completed": "ai_recognition_completed",
        "failed": "ai_recognition_failed",
    },
    "answer_generation": {
        "started": "ai_answer_generation_started",
        "completed": "ai_answer_generation_completed",
        "failed": "ai_answer_generation_failed",
    },
    "formula_compute": {
        "started": "formula_compute_started",
        "completed": "formula_compute_completed",
        "failed": "formula_compute_failed",
    },
    "score_check": {
        "started": "score_check_started",
        "completed": "score_check_completed",
        "failed": "score_check_failed",
    },
    "experiment_image_auto_match": {
        "started": "experiment_image_auto_match_started",
        "completed": "experiment_image_auto_match_completed",
        "failed": "experiment_image_auto_match_failed",
    },
}


def action_name(task_kind: str, phase: str) -> str:
    return AI_ASSIST_ACTIONS[task_kind][phase]


def audit_target_id(experiment_id: str, submission_id: Optional[str] = None) -> str:
    return submission_id or experiment_id


def next_image_recognition_attempt(session: Session, submission_id: Optional[str]) -> int:
    if not submission_id:
        return 1
    task_count = session.exec(
        select(func.count(AiTaskRun.task_id))
        .where(AiTaskRun.task_kind == "image_recognition")
        .where(AiTaskRun.submission_id == submission_id)
    ).one()
    preprocess_count = session.exec(
        select(func.count(AuditLog.id))
        .where(AuditLog.target_id == submission_id)
        .where(AuditLog.action == "submission_prepare_review_ai_recognize")
    ).one()
    preprocess_failed_count = session.exec(
        select(func.count(AuditLog.id))
        .where(AuditLog.target_id == submission_id)
        .where(AuditLog.action == "submission_prepare_review")
        .where(AuditLog.status == "failed")
        .where(AuditLog.details.like("AI 图片识别失败%"))
    ).one()
    legacy_submission_count = session.exec(
        select(func.count(AuditLog.id))
        .where(AuditLog.target_id == submission_id)
        .where(AuditLog.action == "ai_submission")
    ).one()
    return (
        int(task_count or 0)
        + int(preprocess_count or 0)
        + int(preprocess_failed_count or 0)
        + int(legacy_submission_count or 0)
        + 1
    )


def compact_details(details: Any) -> str:
    if isinstance(details, str):
        return details[:8000]
    return json.dumps(details or {}, ensure_ascii=False, indent=2)[:8000]


def add_ai_task_audit(
    session: Session,
    *,
    user_id: int,
    task_kind: str,
    phase: str,
    target_id: str,
    details: Any = None,
) -> AuditLog:
    log = AuditLog(
        user_id=user_id,
        action=action_name(task_kind, phase),
        status="pending" if phase == "started" else ("success" if phase == "completed" else "failed"),
        target_id=target_id,
        details=compact_details(details),
    )
    session.add(log)
    return log


def _task_run_details(base: Any, task_id: str) -> dict:
    if isinstance(base, dict):
        payload = dict(base)
    else:
        payload = {"message": base} if base else {}
    payload["task_id"] = task_id
    return payload


def start_ai_task_run(
    session: Session,
    *,
    task_id: str,
    user_id: int,
    task_kind: str,
    target_id: str,
    experiment_id: Optional[str] = None,
    submission_id: Optional[str] = None,
    details: Any = None,
) -> AiTaskRun:
    started_log = add_ai_task_audit(
        session,
        user_id=user_id,
        task_kind=task_kind,
        phase="started",
        target_id=target_id,
        details=_task_run_details(details, task_id),
    )
    session.flush()

    run = session.get(AiTaskRun, task_id) or AiTaskRun(task_id=task_id)
    run.task_kind = task_kind
    run.status = "pending"
    run.user_id = user_id
    run.target_id = target_id
    run.experiment_id = experiment_id
    run.submission_id = submission_id
    run.started_audit_log_id = started_log.id
    run.request_payload = details if isinstance(details, dict) else {}
    run.updated_at = get_utc_now()
    session.add(run)
    return run


def _finish_ai_task_run(
    session: Session,
    *,
    task_id: str,
    phase: str,
    details: Any = None,
    fallback_user_id: Optional[int] = None,
    fallback_task_kind: Optional[str] = None,
    fallback_target_id: Optional[str] = None,
) -> Optional[AiTaskRun]:
    run = session.get(AiTaskRun, task_id)
    if not run:
        if not (fallback_user_id and fallback_task_kind and fallback_target_id):
            return None
        run = AiTaskRun(
            task_id=task_id,
            task_kind=fallback_task_kind,
            status="pending",
            user_id=fallback_user_id,
            target_id=fallback_target_id,
        )
        session.add(run)
        session.flush()

    if run.finished_audit_log_id:
        return run

    status = "succeeded" if phase == "completed" else "failed"
    run.status = status
    run.updated_at = get_utc_now()
    run.finished_at = run.updated_at
    if phase == "completed":
        run.result_payload = details if isinstance(details, dict) else {}
    else:
        error_message = details.get("error") if isinstance(details, dict) else details
        error_type = details.get("error_type") if isinstance(details, dict) else None
        run.error_message = str(error_message or "")
        run.error_type = str(error_type or "") or None

    if run.started_audit_log_id:
        started_log = session.get(AuditLog, run.started_audit_log_id)
        if started_log:
            started_log.status = "success" if phase == "completed" else "failed"
            session.add(started_log)

    finished_log = add_ai_task_audit(
        session,
        user_id=run.user_id,
        task_kind=run.task_kind,
        phase=phase,
        target_id=run.target_id,
        details=_task_run_details(details, task_id),
    )
    session.flush()
    run.finished_audit_log_id = finished_log.id
    session.add(run)
    return run


def complete_ai_task_run(session: Session, *, task_id: str, details: Any = None) -> Optional[AiTaskRun]:
    return _finish_ai_task_run(session, task_id=task_id, phase="completed", details=details)


def fail_ai_task_run(
    session: Session,
    *,
    task_id: str,
    details: Any = None,
    fallback_user_id: Optional[int] = None,
    fallback_task_kind: Optional[str] = None,
    fallback_target_id: Optional[str] = None,
) -> Optional[AiTaskRun]:
    return _finish_ai_task_run(
        session,
        task_id=task_id,
        phase="failed",
        details=details,
        fallback_user_id=fallback_user_id,
        fallback_task_kind=fallback_task_kind,
        fallback_target_id=fallback_target_id,
    )


def poll_timeout_seconds(model_timeout_seconds: int, *, minimum: int = 180, queue_buffer_seconds: int = 120) -> int:
    return max(minimum, int(model_timeout_seconds or 60) + queue_buffer_seconds)
