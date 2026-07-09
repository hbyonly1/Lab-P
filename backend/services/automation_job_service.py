import hashlib
import json
import uuid
from typing import Any, Dict, Optional, Tuple

from sqlmodel import Session, select

from core.messages import message_code_for_error, public_message_params
from models.core import AutomationJob, Submission, User, get_utc_now

ACTIVE_JOB_STATUSES = {
    "queued",
    "running",
    "retrying",
    "waiting_manual_vpn_auth",
    "waiting_manual_2fa",
}

BLOCKING_RETRY_ERRORS = {"CREDENTIAL_FAILED", "VPN_AUTH_REQUIRED", "MANUAL_VERIFICATION_REQUIRED"}


class AutomationJobConflict(Exception):
    def __init__(self, code: str, job: Optional[AutomationJob] = None):
        self.code = code
        self.job = job
        super().__init__(code)


def stable_payload_hash(payload: Optional[Dict[str, Any]]) -> str:
    normalized = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def make_idempotency_key(
    action: str,
    actor_user_id: int,
    *,
    experiment_id: Optional[str] = None,
    submission_id: Optional[str] = None,
    content_payload: Optional[Dict[str, Any]] = None,
    force_token: Optional[str] = None,
) -> str:
    parts = [action, f"user:{actor_user_id}"]
    if submission_id:
        parts.append(f"submission:{submission_id}")
    if experiment_id:
        parts.append(f"experiment:{experiment_id}")
    if force_token:
        parts.append(f"force:{force_token}")
    if content_payload is not None:
        parts.append(f"content:{stable_payload_hash(content_payload)}")
    return ":".join(parts)


def user_can_view_job(job: AutomationJob, current_user: User, session: Session) -> bool:
    if current_user.role in ["admin", "reviewer"]:
        return True
    if job.actor_user_id == current_user.id:
        return True
    if not job.submission_id:
        return False
    submission = session.get(Submission, job.submission_id)
    return bool(submission and submission.student_id == current_user.id)


def can_retry_job(job: AutomationJob) -> bool:
    if job.status != "failed":
        return False
    return job.error_code not in BLOCKING_RETRY_ERRORS


def _field_write_diagnostic_summary(result_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    field_report = (result_payload or {}).get("fieldWriteReport")
    if not isinstance(field_report, dict):
        return None
    failed_items = []
    for bucket in ["failedFields", "unsupportedFields", "missingFields"]:
        for item in field_report.get(bucket) or []:
            if not isinstance(item, dict):
                continue
            failed_items.append(
                {
                    "nodeId": item.get("nodeId"),
                    "selector": item.get("selector") or item.get("targetLocator"),
                    "targetType": item.get("targetType"),
                    "reason": item.get("reason"),
                    "stage": item.get("stage"),
                    "error": item.get("error") or item.get("message"),
                }
            )
    if not failed_items:
        return None
    return {
        "type": "field_write_report",
        "failedCount": len(failed_items),
        "failedFields": failed_items[:12],
    }


def public_job_data(job: AutomationJob) -> Dict[str, Any]:
    params = public_message_params(job.public_message_params)
    if job.status == "failed" and "reason" not in params:
        params["reason"] = job.error_code or "UNKNOWN_ERROR"
    if job.status == "failed":
        diagnostic_summary = _field_write_diagnostic_summary(job.result_payload or {})
        if diagnostic_summary:
            params["diagnosticSummary"] = diagnostic_summary

    return {
        "jobId": job.id,
        "action": job.action,
        "status": job.public_status or job.status,
        "messageCode": job.public_message_code or message_code_for_error(job.error_code),
        "messageParams": params,
        "canRetry": can_retry_job(job),
        "submissionId": job.submission_id,
        "experimentId": job.experiment_id,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }


def find_active_job_by_key(session: Session, idempotency_key: str) -> Optional[AutomationJob]:
    return session.exec(
        select(AutomationJob)
        .where(AutomationJob.idempotency_key == idempotency_key)
        .where(AutomationJob.status.in_(ACTIVE_JOB_STATUSES))
        .order_by(AutomationJob.created_at.desc())
    ).first()


def find_active_user_job(session: Session, actor_user_id: int) -> Optional[AutomationJob]:
    return session.exec(
        select(AutomationJob)
        .where(AutomationJob.actor_user_id == actor_user_id)
        .where(AutomationJob.status.in_(ACTIVE_JOB_STATUSES))
        .order_by(AutomationJob.created_at.desc())
    ).first()


def create_or_reuse_automation_job(
    session: Session,
    *,
    actor_user_id: int,
    action: str,
    idempotency_key: str,
    public_message_code: str,
    public_message_params: Optional[Dict[str, Any]] = None,
    experiment_id: Optional[str] = None,
    submission_id: Optional[str] = None,
    request_payload: Optional[Dict[str, Any]] = None,
    sensitive_payload: Optional[Dict[str, Any]] = None,
    enforce_single_user_active_job: bool = True,
) -> Tuple[AutomationJob, bool]:
    request_payload = request_payload or {}
    payload_fingerprint = stable_payload_hash(request_payload)

    existing = find_active_job_by_key(session, idempotency_key)
    if existing:
        existing_fingerprint = (existing.request_payload or {}).get("_payload_fingerprint")
        if existing_fingerprint and existing_fingerprint != payload_fingerprint:
            raise AutomationJobConflict("IDEMPOTENCY_CONFLICT", existing)
        if public_message_params:
            existing.public_message_params = {
                **(existing.public_message_params or {}),
                **public_message_params,
            }
            existing.updated_at = get_utc_now()
            session.add(existing)
            session.flush()
        return existing, False

    if enforce_single_user_active_job:
        active_user_job = find_active_user_job(session, actor_user_id)
        if active_user_job:
            raise AutomationJobConflict("JOB_ALREADY_RUNNING", active_user_job)

    now = get_utc_now()
    job = AutomationJob(
        id=f"JOB-{uuid.uuid4().hex[:10].upper()}",
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        action=action,
        status="queued",
        public_status="queued",
        public_message_code=public_message_code,
        public_message_params=public_message_params or {},
        submission_id=submission_id,
        experiment_id=experiment_id,
        request_payload={
            **request_payload,
            "_payload_fingerprint": payload_fingerprint,
        },
        sensitive_payload=sensitive_payload or {},
        created_at=now,
        updated_at=now,
    )
    session.add(job)
    session.flush()
    return job, True
