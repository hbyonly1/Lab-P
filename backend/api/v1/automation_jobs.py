from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.deps import get_current_admin, get_current_user
from core.db import get_session
from models.core import AuditLog, AutomationJob, Submission, User, get_utc_now
from services.automation_job_service import ACTIVE_JOB_STATUSES, can_retry_job, public_job_data, user_can_view_job
from services.school_overview_sync import load_active_config
from services.school_session_manager import school_session_manager

router = APIRouter()


class AutomationJobPublic(BaseModel):
    job_id: str = Field(alias="jobId")
    action: str
    status: str
    message_code: str = Field(alias="messageCode")
    message_params: Dict[str, Any] = Field(default_factory=dict, alias="messageParams")
    can_retry: bool = Field(default=False, alias="canRetry")
    submission_id: Optional[str] = Field(default=None, alias="submissionId")
    experiment_id: Optional[str] = Field(default=None, alias="experimentId")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    finished_at: Optional[datetime] = Field(default=None, alias="finishedAt")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


def to_public_job(job: AutomationJob) -> AutomationJobPublic:
    return AutomationJobPublic(**public_job_data(job))


SCHOOL_AUTOMATION_ACTIONS = {
    "school_overview_sync",
    "school_detail_sync",
    "draft_submit",
    "final_submit",
}


def mark_job_failed(
    session: Session,
    job: AutomationJob,
    *,
    error_code: str,
    reason: str,
    details: str,
) -> None:
    now = get_utc_now()
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.submit.failed" if job.action in ["draft_submit", "final_submit"] else (
        "school.overview.failed" if job.action == "school_overview_sync" else "school.detail.failed"
    )
    job.public_message_params = {"reason": reason}
    job.error_code = error_code
    job.error_message = details[:1000]
    job.finished_at = now
    job.updated_at = now
    job.result_payload = {
        **(job.result_payload or {}),
        "errorCode": error_code,
        "reason": reason,
    }
    if job.submission_id:
        submission = session.get(Submission, job.submission_id)
        if submission:
            submission.status = "error"
            submission.updated_at = now
            session.add(submission)
    session.add(job)
    session.add(
        AuditLog(
            user_id=job.actor_user_id,
            action=f"{job.action}_failed",
            status="failed",
            target_id=job.id,
            details=details,
        )
    )


def fail_if_school_browser_closed(session: Session, job: AutomationJob) -> None:
    if job.status not in ACTIVE_JOB_STATUSES or job.action not in SCHOOL_AUTOMATION_ACTIONS or not job.actor_user_id:
        return
    try:
        config = load_active_config(session)
        diagnostic = school_session_manager.run(school_session_manager.diagnose(job.actor_user_id, config))
    except Exception:
        return
    if diagnostic.get("pageClosed") is True:
        mark_job_failed(
            session,
            job,
            error_code="SCHOOL_BROWSER_CLOSED",
            reason="学校系统浏览器窗口已关闭",
            details=f"学校自动化任务失败：学校系统浏览器窗口已关闭。diagnostic={diagnostic}",
        )
        job.result_payload = {
            **(job.result_payload or {}),
            "sessionDiagnostic": diagnostic,
        }


@router.get("/active", response_model=List[AutomationJobPublic])
def get_active_automation_jobs(
    action: Optional[str] = Query(default=None),
    experiment_id: Optional[str] = Query(default=None),
    submission_id: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> List[AutomationJobPublic]:
    statement = select(AutomationJob).where(AutomationJob.status.in_(ACTIVE_JOB_STATUSES))
    if action:
        statement = statement.where(AutomationJob.action == action)
    if experiment_id:
        statement = statement.where(AutomationJob.experiment_id == experiment_id)
    if submission_id:
        statement = statement.where(AutomationJob.submission_id == submission_id)
    statement = statement.order_by(AutomationJob.created_at.desc())

    jobs = session.exec(statement).all()
    visible_jobs = [job for job in jobs if user_can_view_job(job, current_user, session)]
    return [to_public_job(job) for job in visible_jobs]


@router.get("/{job_id}", response_model=AutomationJobPublic)
def get_automation_job(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    job = session.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found.")
    if not user_can_view_job(job, current_user, session):
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    fail_if_school_browser_closed(session, job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/{job_id}/cancel", response_model=AutomationJobPublic)
def cancel_automation_job(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationJobPublic:
    job = session.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found.")
    if job.status not in ACTIVE_JOB_STATUSES:
        return to_public_job(job)
    original_actor_user_id = job.actor_user_id
    mark_job_failed(
        session,
        job,
        error_code="JOB_CANCELLED",
        reason="任务已手动终止",
        details=f"自动化任务由管理员 {current_user.id} 手动终止。原任务发起人：{original_actor_user_id}。",
    )
    job.result_payload = {
        **(job.result_payload or {}),
        "cancelledBy": current_user.id,
        "originalActorUserId": original_actor_user_id,
    }
    session.commit()
    session.refresh(job)
    return to_public_job(job)
