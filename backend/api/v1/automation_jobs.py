import json
import os
import threading
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.deps import get_current_admin, get_current_user
from core.db import get_session
from models.core import AuditLog, AutomationJob, Submission, User, get_utc_now
from services.automation_job_service import ACTIVE_JOB_STATUSES, can_retry_job, public_job_data, user_can_view_job
from services.school_overview_sync import load_active_config
from services.school_report_sync import _artifact_dir, _read_visible_bootbox, _save_bootbox_artifacts
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
    target_student_no: Optional[str] = Field(default=None, alias="targetStudentNo")
    target_real_name: Optional[str] = Field(default=None, alias="targetRealName")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    finished_at: Optional[datetime] = Field(default=None, alias="finishedAt")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class SchoolBrowserSessionPublic(BaseModel):
    user_id: int = Field(alias="userId")
    student_no: Optional[str] = Field(default=None, alias="studentNo")
    real_name: Optional[str] = Field(default=None, alias="realName")
    source: str
    state: str
    created_by_job_id: str = Field(alias="createdByJobId")
    created_at: datetime = Field(alias="createdAt")
    last_used_at: datetime = Field(alias="lastUsedAt")
    page_closed: Optional[bool] = Field(default=None, alias="pageClosed")
    url: Optional[str] = None
    row_count: Optional[int] = Field(default=None, alias="rowCount")
    bootbox_visible: Optional[bool] = Field(default=None, alias="bootboxVisible")
    modal_visible: Optional[bool] = Field(default=None, alias="modalVisible")
    loading_visible: Optional[bool] = Field(default=None, alias="loadingVisible")
    active_job_count: int = Field(default=0, alias="activeJobCount")
    diagnostic: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class CloseSchoolBrowserSessionResponse(BaseModel):
    closed: int


class RestartBackendResponse(BaseModel):
    accepted: bool
    message: str


def to_public_job(job: AutomationJob, session: Optional[Session] = None) -> AutomationJobPublic:
    data = public_job_data(job)
    if session and job.submission_id:
        submission = session.get(Submission, job.submission_id)
        if submission:
            student = session.get(User, submission.student_id)
            if student:
                data["targetStudentNo"] = student.student_no
                data["targetRealName"] = student.real_name
    return AutomationJobPublic(**data)


def _to_public_browser_session(
    browser_session: Any,
    diagnostic: Dict[str, Any],
    user: Optional[User],
    active_job_count: int,
) -> SchoolBrowserSessionPublic:
    return SchoolBrowserSessionPublic(
        userId=browser_session.user_id,
        studentNo=user.student_no if user else None,
        realName=user.real_name if user else None,
        source=browser_session.source,
        state=str(diagnostic.get("state") or browser_session.state or "unknown"),
        createdByJobId=browser_session.created_by_job_id,
        createdAt=browser_session.created_at,
        lastUsedAt=browser_session.last_used_at,
        pageClosed=diagnostic.get("pageClosed"),
        url=diagnostic.get("url"),
        rowCount=diagnostic.get("rowCount"),
        bootboxVisible=diagnostic.get("bootboxVisible"),
        modalVisible=diagnostic.get("modalVisible"),
        loadingVisible=diagnostic.get("loadingVisible"),
        activeJobCount=active_job_count,
        diagnostic=diagnostic,
    )


SCHOOL_AUTOMATION_ACTIONS = {
    "school_overview_sync",
    "school_detail_sync",
    "school_report_screenshot",
    "school_submission_screenshots",
    "school_completion_check",
    "draft_submit",
    "final_submit",
}

BOOTBOX_BLOCKING_MESSAGE_CODES = {
    "school.detail.syncing",
    "school.detail.connecting",
    "school.detail.opening",
    "school.screenshot.syncing",
    "school.screenshot.connecting",
    "school.screenshot.opening",
    "school.screenshot.capturing",
    "school.submissionScreenshots.syncing",
    "school.submissionScreenshots.connecting",
    "school.submissionScreenshots.opening",
    "school.submissionScreenshots.capturingExperiment",
    "school.submissionScreenshots.savingResult",
    "school.completion.connecting",
    "school.completion.opening",
    "school.completion.checkingExperiment",
    "school.submit.connecting",
    "school.submit.opening",
}


def _automation_failed_audit_action(job_action: str) -> str:
    if job_action == "draft_submit":
        return "school_draft_submit_failed"
    if job_action == "final_submit":
        return "school_final_submit_failed"
    return f"{job_action}_failed"


def _automation_audit_target_id(job: AutomationJob) -> str:
    if job.action in {"draft_submit", "final_submit"}:
        if not job.submission_id:
            raise ValueError(f"{job.action} job {job.id} is missing submission_id")
        return job.submission_id
    return job.id


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
    if job.action in ["draft_submit", "final_submit"]:
        job.public_message_code = "school.submit.failed"
    elif job.action == "school_overview_sync":
        job.public_message_code = "school.overview.failed"
    elif job.action == "school_completion_check":
        job.public_message_code = "school.completion.failed"
    elif job.action == "school_report_screenshot":
        job.public_message_code = "school.screenshot.failed"
    elif job.action == "school_submission_screenshots":
        job.public_message_code = "school.submissionScreenshots.failed"
    else:
        job.public_message_code = "school.detail.failed"
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
            action=_automation_failed_audit_action(job.action),
            status="failed",
            target_id=_automation_audit_target_id(job),
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


def fail_if_school_opening_blocked_by_bootbox(session: Session, job: AutomationJob) -> None:
    if (
        job.status not in ACTIVE_JOB_STATUSES
        or job.action not in SCHOOL_AUTOMATION_ACTIONS
        or job.public_message_code not in BOOTBOX_BLOCKING_MESSAGE_CODES
        or not job.actor_user_id
    ):
        return
    browser_session = school_session_manager.get(job.actor_user_id)
    if not browser_session or not browser_session.page:
        return
    try:
        bootbox = school_session_manager.run(_read_visible_bootbox(browser_session.page))
    except Exception:
        return
    if not bootbox:
        return

    current_step = job.public_message_code or "school.detail.opening"
    body_text = str(bootbox.get("bodyText") or bootbox.get("textPreview") or "学校系统出现弹窗").strip()
    reason = f"学校系统弹窗提示：{body_text[:200]}"
    try:
        artifacts = school_session_manager.run(_save_bootbox_artifacts(browser_session.page, _artifact_dir(job.id), "polling_bootbox"))
    except Exception as exc:
        artifacts = {"polling_bootbox_artifact_error": f"{type(exc).__name__}: {exc}"}
    diagnostic = {
        "errorCode": "SCHOOL_BOOTBOX_ERROR",
        "reason": reason,
        "currentStep": current_step,
        "bootbox": bootbox,
        "artifacts": artifacts,
    }
    if browser_session.last_diagnostic:
        diagnostic["sessionDiagnostic"] = browser_session.last_diagnostic
    mark_job_failed(
        session,
        job,
        error_code="SCHOOL_BOOTBOX_ERROR",
        reason=reason,
        details=json.dumps(diagnostic, ensure_ascii=False),
    )
    session_reset: Dict[str, Any] = {"attempted": True}
    try:
        school_session_manager.run(school_session_manager.close(job.actor_user_id, reason="blocking_bootbox_error"))
        session_reset["closed"] = True
    except Exception as exc:
        session_reset = {
            "attempted": True,
            "closed": False,
            "error": f"{type(exc).__name__}: {exc}",
        }
    job.result_payload = {
        **(job.result_payload or {}),
        "currentStep": current_step,
        "bootbox": bootbox,
        "artifacts": artifacts,
        "sessionReset": session_reset,
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
    return [to_public_job(job, session) for job in visible_jobs]


@router.get("/school-browser-sessions", response_model=List[SchoolBrowserSessionPublic])
def list_school_browser_sessions(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> List[SchoolBrowserSessionPublic]:
    config = load_active_config(session)
    browser_sessions = school_session_manager.list_sessions()
    active_jobs = session.exec(
        select(AutomationJob).where(AutomationJob.status.in_(ACTIVE_JOB_STATUSES))
    ).all()
    active_count_by_user: Dict[int, int] = {}
    for job in active_jobs:
        if job.actor_user_id:
            active_count_by_user[job.actor_user_id] = active_count_by_user.get(job.actor_user_id, 0) + 1

    rows: List[SchoolBrowserSessionPublic] = []
    for browser_session in browser_sessions:
        user = session.get(User, browser_session.user_id)
        try:
            diagnostic = school_session_manager.run(
                school_session_manager.detect_state(browser_session.user_id, config)
            )
        except Exception as exc:
            diagnostic = {
                "hasSession": True,
                "state": browser_session.state or "unknown",
                "diagnosticError": f"{type(exc).__name__}: {exc}",
            }
        rows.append(
            _to_public_browser_session(
                browser_session,
                diagnostic,
                user,
                active_count_by_user.get(browser_session.user_id, 0),
            )
        )
    return sorted(rows, key=lambda item: item.last_used_at, reverse=True)


@router.delete("/school-browser-sessions/{user_id}", response_model=CloseSchoolBrowserSessionResponse)
def close_school_browser_session(
    user_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> CloseSchoolBrowserSessionResponse:
    browser_session = school_session_manager.get(user_id)
    if not browser_session:
        return CloseSchoolBrowserSessionResponse(closed=0)
    school_session_manager.run(
        school_session_manager.close(user_id, reason=f"admin_closed_by_{current_user.id}")
    )
    session.add(
        AuditLog(
            user_id=current_user.id,
            action="school_browser_session_closed",
            status="success",
            target_id=str(user_id),
            details=f"管理员关闭学校系统 Playwright 会话，目标用户 ID：{user_id}",
        )
    )
    session.commit()
    return CloseSchoolBrowserSessionResponse(closed=1)


@router.delete("/school-browser-sessions", response_model=CloseSchoolBrowserSessionResponse)
def close_all_school_browser_sessions(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> CloseSchoolBrowserSessionResponse:
    count = school_session_manager.run(
        school_session_manager.close_all(reason=f"admin_closed_all_by_{current_user.id}")
    )
    session.add(
        AuditLog(
            user_id=current_user.id,
            action="school_browser_sessions_closed_all",
            status="success",
            target_id="all",
            details=f"管理员关闭全部学校系统 Playwright 会话，数量：{count}",
        )
    )
    session.commit()
    return CloseSchoolBrowserSessionResponse(closed=count)


@router.post("/backend/restart", response_model=RestartBackendResponse)
def restart_backend_service(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> RestartBackendResponse:
    session.add(
        AuditLog(
            user_id=current_user.id,
            action="backend_restart_requested",
            status="success",
            target_id="backend",
            details=f"管理员请求重启 backend 服务，用户 ID：{current_user.id}",
        )
    )
    session.commit()

    def delayed_exit() -> None:
        os._exit(0)

    threading.Timer(0.8, delayed_exit).start()
    return RestartBackendResponse(
        accepted=True,
        message="Backend restart requested. Docker restart policy will bring it back.",
    )


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
    fail_if_school_opening_blocked_by_bootbox(session, job)
    session.commit()
    session.refresh(job)
    return to_public_job(job, session)


@router.get("/{job_id}/screenshot")
def get_automation_job_screenshot(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    job = session.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Automation job not found.")
    if not user_can_view_job(job, current_user, session):
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    if job.action != "school_report_screenshot":
        raise HTTPException(status_code=400, detail="This job does not contain a report screenshot.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Screenshot is not ready.")

    screenshot = (job.result_payload or {}).get("screenshot") or {}
    raw_path = screenshot.get("path")
    if not raw_path:
        raise HTTPException(status_code=404, detail="Screenshot artifact not found.")

    artifact_root = _artifact_dir(job.id).resolve()
    screenshot_path = Path(str(raw_path)).resolve()
    try:
        screenshot_path.relative_to(artifact_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid screenshot artifact path.")
    if not screenshot_path.exists() or not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot artifact not found.")
    return FileResponse(
        screenshot_path,
        media_type=screenshot.get("contentType") or "image/png",
        filename=f"{job.id}-school-report.png",
    )


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
        return to_public_job(job, session)
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
    return to_public_job(job, session)
