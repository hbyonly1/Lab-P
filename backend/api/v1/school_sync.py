import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.deps import get_current_reviewer_or_admin, get_current_user
from api.v1.automation_jobs import AutomationJobPublic, to_public_job
from core.db import engine, get_session
from models.core import AuditLog, AutomationEngineConfig, AutomationJob, SchoolSyncSnapshot, Submission, SubmissionVersion, User, get_utc_now
from services.automation_job_service import (
    AutomationJobConflict,
    create_or_reuse_automation_job,
    make_idempotency_key,
)
from services.school_overview_sync import run_school_overview_sync
from services.school_report_sync import run_school_detail_sync, run_school_experiment_submit

router = APIRouter()


class OverviewSyncRequest(BaseModel):
    force: bool = Field(default=False)


class SchoolOverviewLatest(BaseModel):
    last_synced_at: Optional[datetime] = Field(default=None, alias="lastSyncedAt")
    should_sync: bool = Field(alias="shouldSync")
    cooldown_seconds: int = Field(alias="cooldownSeconds")
    remaining_cooldown_seconds: int = Field(alias="remainingCooldownSeconds")
    summary: Dict[str, Any] = Field(default_factory=dict)
    experiments: list[Dict[str, Any]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class SchoolExperimentDetailLatest(BaseModel):
    last_synced_at: Optional[datetime] = Field(default=None, alias="lastSyncedAt")
    experiment_id: str = Field(alias="experimentId")
    experiment_name: Optional[str] = Field(default=None, alias="experimentName")
    form_values: Dict[str, Any] = Field(default_factory=dict, alias="formValues")
    summary: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class SchoolSubmitRequest(BaseModel):
    submission_id: str = Field(alias="submissionId")
    mode: str = Field(pattern="^(draft|final)$")

    model_config = {"populate_by_name": True}


class SchoolSyncSettings(BaseModel):
    auto_load_detail_for_student: bool = Field(alias="autoLoadDetailForStudent")
    auto_load_detail_for_internal_user: bool = Field(alias="autoLoadDetailForInternalUser")
    auto_load_detail: bool = Field(alias="autoLoadDetail")

    model_config = {"populate_by_name": True}


def _active_automation_config_json(session: Session) -> Dict[str, Any]:
    config = session.exec(
        select(AutomationEngineConfig)
        .where(AutomationEngineConfig.name == "default")
        .where(AutomationEngineConfig.is_active == True)  # noqa: E712
        .order_by(AutomationEngineConfig.id.desc())
    ).first()
    return (config.config_json or {}) if config else {}


def _sync_policy(session: Session) -> Dict[str, Any]:
    return _active_automation_config_json(session).get("syncPolicy") or {}


def _automation_conflict_response(exc: AutomationJobConflict) -> HTTPException:
    detail: Dict[str, Any] = {"code": exc.code}
    if exc.job:
        detail["job"] = jsonable_encoder(to_public_job(exc.job))
    return HTTPException(status_code=409, detail=detail)


def _add_audit_log(
    session: Session,
    *,
    user_id: int,
    action: str,
    status: str,
    target_id: Optional[str] = None,
    details: str,
) -> None:
    session.add(
        AuditLog(
            user_id=user_id,
            action=action,
            status=status,
            target_id=target_id,
            details=details,
        )
    )


def _sync_cooldown_seconds(session: Session) -> int:
    value = _sync_policy(session).get("syncCooldownSeconds")
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        seconds = 1800
    return max(seconds, 0)


@router.get("/settings", response_model=SchoolSyncSettings)
def get_school_sync_settings(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SchoolSyncSettings:
    sync_policy = _sync_policy(session)
    auto_load_student = sync_policy.get("autoLoadDetailForStudent")
    auto_load_internal = sync_policy.get("autoLoadDetailForInternalUser")
    if not isinstance(auto_load_student, bool):
        auto_load_student = True
    if not isinstance(auto_load_internal, bool):
        auto_load_internal = False

    is_internal = current_user.role in ["admin", "reviewer"]
    return SchoolSyncSettings(
        autoLoadDetailForStudent=auto_load_student,
        autoLoadDetailForInternalUser=auto_load_internal,
        autoLoadDetail=auto_load_internal if is_internal else auto_load_student,
    )


def _latest_overview_snapshot(session: Session, user_id: int) -> Optional[SchoolSyncSnapshot]:
    return session.exec(
        select(SchoolSyncSnapshot)
        .where(SchoolSyncSnapshot.user_id == user_id)
        .where(SchoolSyncSnapshot.submission_id == None)  # noqa: E711
        .where(SchoolSyncSnapshot.experiment_id == None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.synced_at.desc())
    ).first()


def _overview_latest_data(session: Session, user_id: int) -> SchoolOverviewLatest:
    cooldown_seconds = _sync_cooldown_seconds(session)
    latest = _latest_overview_snapshot(session, user_id)
    if not latest:
        return SchoolOverviewLatest(
            lastSyncedAt=None,
            shouldSync=True,
            cooldownSeconds=cooldown_seconds,
            remainingCooldownSeconds=0,
            summary={},
            experiments=[],
        )

    latest_synced_at = latest.synced_at
    if latest_synced_at.tzinfo is None:
        latest_synced_at = latest_synced_at.replace(tzinfo=timezone.utc)
    elapsed = max(int((get_utc_now() - latest_synced_at).total_seconds()), 0)
    remaining = max(cooldown_seconds - elapsed, 0)
    return SchoolOverviewLatest(
        lastSyncedAt=latest.synced_at,
        shouldSync=remaining == 0,
        cooldownSeconds=cooldown_seconds,
        remainingCooldownSeconds=remaining,
        summary=latest.summary_json or {},
        experiments=(latest.snapshot_json or {}).get("experiments") or [],
    )


def _latest_detail_snapshot(session: Session, user_id: int, experiment_id: str) -> Optional[SchoolSyncSnapshot]:
    return session.exec(
        select(SchoolSyncSnapshot)
        .where(SchoolSyncSnapshot.user_id == user_id)
        .where(SchoolSyncSnapshot.experiment_id == experiment_id)
        .where(SchoolSyncSnapshot.submission_id == None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.synced_at.desc())
    ).first()


def _detail_latest_data(session: Session, user_id: int, experiment_id: str) -> SchoolExperimentDetailLatest:
    latest = _latest_detail_snapshot(session, user_id, experiment_id)
    if not latest:
        return SchoolExperimentDetailLatest(
            lastSyncedAt=None,
            experimentId=experiment_id,
            experimentName=None,
            formValues={},
            summary={},
        )
    snapshot = latest.snapshot_json or {}
    return SchoolExperimentDetailLatest(
        lastSyncedAt=latest.synced_at,
        experimentId=experiment_id,
        experimentName=snapshot.get("experimentName"),
        formValues=snapshot.get("formValues") or {},
        summary=latest.summary_json or {},
    )


@router.post("/experiments/{experiment_id}", response_model=AutomationJobPublic)
def start_school_experiment_detail_sync(
    experiment_id: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can sync school experiment data.")

    idempotency_key = make_idempotency_key(
        "school_detail_sync",
        current_user.id,
        experiment_id=experiment_id,
    )
    public_params = {"experimentName": experiment_id}

    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=current_user.id,
            action="school_detail_sync",
            idempotency_key=idempotency_key,
            public_message_code="school.detail.syncing",
            public_message_params=public_params,
            experiment_id=experiment_id,
            request_payload={
                "source": "student_experiment_detail",
                "experiment_id": experiment_id,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校单实验同步请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_detail_sync, job.id, current_user.id, experiment_id)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_started",
            status="success",
            target_id=job.id,
            details="学校单实验同步任务已创建。",
        )
    else:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_reused",
            status="success",
            target_id=job.id,
            details="复用正在执行的学校单实验同步任务。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/experiments/{experiment_id}/submissions/{submission_id}", response_model=AutomationJobPublic)
def start_school_submission_experiment_detail_sync(
    experiment_id: str,
    submission_id: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin),
) -> AutomationJobPublic:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if submission.experiment_id != experiment_id:
        raise HTTPException(status_code=400, detail="Submission does not belong to this experiment.")

    student = session.get(User, submission.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Submission student not found.")

    idempotency_key = make_idempotency_key(
        "school_detail_sync",
        student.id,
        experiment_id=experiment_id,
        submission_id=submission.id,
    )
    public_params = {"experimentName": experiment_id}

    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_detail_sync",
            idempotency_key=idempotency_key,
            public_message_code="school.detail.syncing",
            public_message_params=public_params,
            experiment_id=experiment_id,
            submission_id=submission.id,
            request_payload={
                "source": "review_submission_detail",
                "experiment_id": experiment_id,
                "submission_id": submission.id,
                "requested_by": current_user.id,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校单实验同步请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_detail_sync, job.id, student.id, experiment_id)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_started",
            status="success",
            target_id=job.id,
            details=f"审核页学校单实验同步任务已创建，submission={submission.id}。",
        )
    else:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_detail_sync_reused",
            status="success",
            target_id=job.id,
            details=f"复用学生 {student.id} 正在执行的学校单实验同步任务。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.get("/experiments/{experiment_id}/latest", response_model=SchoolExperimentDetailLatest)
def get_school_experiment_detail_latest(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SchoolExperimentDetailLatest:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can view school experiment detail sync status.")
    return _detail_latest_data(session, current_user.id, experiment_id)


@router.get("/experiments/{experiment_id}/submissions/{submission_id}/latest", response_model=SchoolExperimentDetailLatest)
def get_school_submission_experiment_detail_latest(
    experiment_id: str,
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin),
) -> SchoolExperimentDetailLatest:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if submission.experiment_id != experiment_id:
        raise HTTPException(status_code=400, detail="Submission does not belong to this experiment.")
    return _detail_latest_data(session, submission.student_id, experiment_id)


@router.post("/overview", response_model=AutomationJobPublic)
def start_school_overview_sync(
    request: OverviewSyncRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can sync school overview data.")

    force_token = uuid.uuid4().hex if request.force else None
    idempotency_key = make_idempotency_key(
        "school_overview_sync",
        current_user.id,
        force_token=force_token,
    )
    request_payload = {
        "force": request.force,
        "source": "student_overview",
    }

    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=current_user.id,
            action="school_overview_sync",
            idempotency_key=idempotency_key,
            public_message_code="school.overview.syncing",
            request_payload=request_payload,
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_overview_sync_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校概览同步请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_overview_sync, job.id, current_user.id)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_overview_sync_started",
            status="success",
            target_id=job.id,
            details="学校概览同步任务已创建。",
        )
    else:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_overview_sync_reused",
            status="success",
            target_id=job.id,
            details="复用正在执行的学校概览同步任务。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.get("/overview/latest", response_model=SchoolOverviewLatest)
def get_school_overview_latest(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SchoolOverviewLatest:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can view school overview sync status.")
    return _overview_latest_data(session, current_user.id)


@router.post("/experiments/{experiment_id}/submit", response_model=AutomationJobPublic)
def start_school_experiment_submit(
    experiment_id: str,
    request: SchoolSubmitRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    submission = session.get(Submission, request.submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if submission.experiment_id != experiment_id:
        raise HTTPException(status_code=400, detail="Submission does not belong to this experiment.")
    if current_user.role == "student" and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    if submission.is_one_click_handoff and current_user.role == "student":
        raise HTTPException(status_code=403, detail="One-click handoff submissions must be processed by reviewer or admin.")

    action = "final_submit" if request.mode == "final" else "draft_submit"
    content_payload = {
        "corrected_json": submission.corrected_json,
        "image_paths": submission.image_paths,
        "mode": request.mode,
    }
    idempotency_key = make_idempotency_key(
        action,
        current_user.id,
        experiment_id=experiment_id,
        submission_id=submission.id,
        content_payload=content_payload,
    )
    public_params = {"experimentName": (submission.corrected_json or {}).get("experiment_name") or experiment_id}

    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=current_user.id,
            action=action,
            idempotency_key=idempotency_key,
            public_message_code="school.submit.saving",
            public_message_params=public_params,
            experiment_id=experiment_id,
            submission_id=submission.id,
            request_payload={
                "mode": request.mode,
                "experiment_id": experiment_id,
                "submission_id": submission.id,
                "content_payload": content_payload,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action=f"school_{request.mode}_submit_rejected",
            status="failed",
            target_id=submission.id,
            details=(
                f"学校系统{'正式' if request.mode == 'final' else '临时'}提交请求被拒绝：{exc.code}。"
                f"job_id={exc.job.id if exc.job else ''}"
            ),
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        previous_versions = session.exec(
            select(SubmissionVersion).where(SubmissionVersion.submission_id == submission.id)
        ).all()
        session.add(
            SubmissionVersion(
                submission_id=submission.id,
                version_no=len(previous_versions) + 1,
                source="platform_before_submit",
                snapshot_json={
                    "mode": request.mode,
                    "status": submission.status,
                    "corrected_json": submission.corrected_json,
                    "image_paths": submission.image_paths,
                },
                created_by=current_user.id,
            )
        )
        job.status = "running"
        job.public_status = "running"
        job.public_message_code = "school.submit.saving"
        job.started_at = now
        job.updated_at = now
        submission.status = "submitting"
        submission.updated_at = now
        session.add(submission)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action=f"school_{request.mode}_submit_started",
            status="success",
            target_id=submission.id,
            details=f"学校系统{'正式' if request.mode == 'final' else '临时'}提交任务已创建。job_id={job.id}",
        )
        background_tasks.add_task(run_school_experiment_submit, job.id, submission.id, request.mode)
    else:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action=f"school_{request.mode}_submit_reused",
            status="success",
            target_id=submission.id,
            details=f"复用正在执行的学校系统{'正式' if request.mode == 'final' else '临时'}提交任务。job_id={job.id}",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)
