import copy
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.deps import get_current_reviewer_or_admin, get_current_user
from api.v1.automation_jobs import AutomationJobPublic, to_public_job
from core.db import engine, get_session
from models.core import AuditLog, AutomationEngineConfig, AutomationJob, Experiment, SchoolSyncSnapshot, Submission, SubmissionVersion, User, get_utc_now
from services.automation_job_service import (
    AutomationJobConflict,
    create_or_reuse_automation_job,
    make_idempotency_key,
)
from services.school_overview_sync import run_school_overview_sync
from services.school_completion_check import run_school_completion_check
from services.school_report_sync import _artifact_dir, run_school_detail_sync, run_school_experiment_submit, run_school_report_screenshot
from services.school_submission_screenshots import run_school_submission_screenshots

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
    one_click_fused_image_upload_ai_enabled: bool = Field(alias="oneClickFusedImageUploadAiEnabled")
    one_click_fused_image_auto_confirm_enabled: bool = Field(alias="oneClickFusedImageAutoConfirmEnabled")

    model_config = {"populate_by_name": True}


class CompletionMissingItem(BaseModel):
    key: str
    label: str


class CompletionExperimentResult(BaseModel):
    experiment_id: str = Field(alias="experimentId")
    experiment_name: str = Field(alias="experimentName")
    school_status: str = Field(default="school_unknown", alias="schoolStatus")
    original_status_text: str = Field(default="", alias="originalStatusText")
    score: Optional[str] = None
    check_status: str = Field(default="checked", alias="checkStatus")
    complete: bool
    missing: list[CompletionMissingItem] = Field(default_factory=list)
    reason: Optional[str] = None

    model_config = {"populate_by_name": True}


class CompletionCheckSummary(BaseModel):
    experiment_count: int = Field(alias="experimentCount")
    checked_experiment_count: int = Field(default=0, alias="checkedExperimentCount")
    complete_experiment_count: int = Field(alias="completeExperimentCount")
    incomplete_experiment_count: int = Field(alias="incompleteExperimentCount")
    skipped_experiment_count: int = Field(default=0, alias="skippedExperimentCount")
    error_experiment_count: int = Field(default=0, alias="errorExperimentCount")
    missing_count: int = Field(alias="missingCount")

    model_config = {"populate_by_name": True}


class CompletionCheckResponse(BaseModel):
    student_id: int = Field(alias="studentId")
    student_no: Optional[str] = Field(default=None, alias="studentNo")
    real_name: Optional[str] = Field(default=None, alias="realName")
    summary: CompletionCheckSummary
    experiments: list[CompletionExperimentResult]

    model_config = {"populate_by_name": True}


class SubmissionScreenshotExperimentResult(BaseModel):
    experiment_id: str = Field(alias="experimentId")
    experiment_name: str = Field(alias="experimentName")
    school_status: str = Field(default="school_unknown", alias="schoolStatus")
    original_status_text: str = Field(default="", alias="originalStatusText")
    score: Optional[str] = None
    capture_status: str = Field(default="captured", alias="captureStatus")
    screenshot_available: bool = Field(default=False, alias="screenshotAvailable")
    reason: Optional[str] = None

    model_config = {"populate_by_name": True}


class SubmissionScreenshotSummary(BaseModel):
    experiment_count: int = Field(alias="experimentCount")
    captured_experiment_count: int = Field(default=0, alias="capturedExperimentCount")
    skipped_experiment_count: int = Field(default=0, alias="skippedExperimentCount")
    error_experiment_count: int = Field(default=0, alias="errorExperimentCount")

    model_config = {"populate_by_name": True}


class SubmissionScreenshotsResponse(BaseModel):
    student_id: int = Field(alias="studentId")
    student_no: Optional[str] = Field(default=None, alias="studentNo")
    real_name: Optional[str] = Field(default=None, alias="realName")
    summary: SubmissionScreenshotSummary
    experiments: list[SubmissionScreenshotExperimentResult]

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
    automation_config = _active_automation_config_json(session)
    one_click = automation_config.get("oneClick") or {}
    return SchoolSyncSettings(
        autoLoadDetailForStudent=auto_load_student,
        autoLoadDetailForInternalUser=auto_load_internal,
        autoLoadDetail=auto_load_internal if is_internal else auto_load_student,
        oneClickFusedImageUploadAiEnabled=one_click.get("fusedImageUploadAiEnabled") is True,
        oneClickFusedImageAutoConfirmEnabled=one_click.get("fusedImageAutoConfirmEnabled") is not False,
    )


def _latest_overview_snapshot(session: Session, user_id: int) -> Optional[SchoolSyncSnapshot]:
    return session.exec(
        select(SchoolSyncSnapshot)
        .where(SchoolSyncSnapshot.user_id == user_id)
        .where(SchoolSyncSnapshot.submission_id == None)  # noqa: E711
        .where(SchoolSyncSnapshot.experiment_id == None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.synced_at.desc())
    ).first()


def _normalized_experiment_name(value: Any) -> str:
    return "".join(str(value or "").split())


def _submit_confirmed_status_matches(summary: Dict[str, Any]) -> bool:
    mode = summary.get("mode")
    school_status = summary.get("schoolStatus")
    if mode == "draft":
        return school_status == "school_draft_submitted"
    if mode == "final":
        return school_status == "school_final_submitted"
    return False


def _latest_confirmed_submit_snapshots(session: Session, user_id: int) -> list[SchoolSyncSnapshot]:
    snapshots = session.exec(
        select(SchoolSyncSnapshot)
        .where(SchoolSyncSnapshot.user_id == user_id)
        .where(SchoolSyncSnapshot.submission_id != None)  # noqa: E711
        .where(SchoolSyncSnapshot.experiment_id != None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.synced_at.desc())
    ).all()
    latest_by_experiment: Dict[str, SchoolSyncSnapshot] = {}
    for snapshot in snapshots:
        summary = snapshot.summary_json or {}
        if summary.get("source") != "school_submit_confirmed":
            continue
        if summary.get("statusConfirmation") != "list_confirmed":
            continue
        if not _submit_confirmed_status_matches(summary):
            continue
        key = snapshot.experiment_id or _normalized_experiment_name(summary.get("experimentName"))
        if key and key not in latest_by_experiment:
            latest_by_experiment[key] = snapshot
    return list(latest_by_experiment.values())


def _experiment_from_submit_snapshot(snapshot: SchoolSyncSnapshot) -> Dict[str, Any]:
    summary = snapshot.summary_json or {}
    status = (snapshot.snapshot_json or {}).get("status") or {}
    experiment_name = summary.get("experimentName") or status.get("experimentName") or snapshot.experiment_id
    return {
        "experimentId": snapshot.experiment_id,
        "experimentName": experiment_name,
        "originalStatusText": summary.get("originalStatusText") or status.get("originalStatusText") or "",
        "score": summary.get("score") or status.get("score") or "",
        "schoolStatus": summary.get("schoolStatus") or status.get("schoolStatus") or "school_unknown",
        "schoolStatusSource": "school_submit_confirmed",
        "schoolStatusSyncedAt": snapshot.synced_at,
        "submissionId": snapshot.submission_id,
        "statusConfirmation": summary.get("statusConfirmation"),
    }


def _recalculate_school_status_summary(summary: Dict[str, Any], experiments: list[Dict[str, Any]]) -> Dict[str, Any]:
    next_summary = dict(summary or {})
    draft_count = sum(1 for item in experiments if item.get("schoolStatus") == "school_draft_submitted")
    final_count = sum(1 for item in experiments if item.get("schoolStatus") in {"school_final_submitted", "school_graded"})
    unsubmitted_count = sum(1 for item in experiments if item.get("schoolStatus") == "school_not_submitted")
    unknown_count = sum(
        1
        for item in experiments
        if item.get("schoolStatus") not in ["school_not_submitted", "school_draft_submitted", "school_final_submitted", "school_graded"]
    )
    next_summary.update(
        {
            "total": len(experiments),
            "completed": draft_count + final_count,
            "unsubmitted": unsubmitted_count,
            "draftSubmitted": draft_count,
            "finalSubmitted": final_count,
            "unknown": unknown_count,
        }
    )
    return next_summary


def _merge_confirmed_submit_statuses(
    experiments: list[Dict[str, Any]],
    confirmed_snapshots: list[SchoolSyncSnapshot],
    *,
    newer_than: Optional[datetime] = None,
) -> list[Dict[str, Any]]:
    merged = [dict(item) for item in experiments]
    index_by_name = {
        _normalized_experiment_name(item.get("experimentName")): idx
        for idx, item in enumerate(merged)
        if _normalized_experiment_name(item.get("experimentName"))
    }
    index_by_experiment_id = {
        str(item.get("experimentId")): idx
        for idx, item in enumerate(merged)
        if item.get("experimentId")
    }

    for snapshot in confirmed_snapshots:
        if newer_than and snapshot.synced_at and snapshot.synced_at < newer_than:
            continue
        confirmed_item = _experiment_from_submit_snapshot(snapshot)
        name_key = _normalized_experiment_name(confirmed_item.get("experimentName"))
        experiment_id_key = str(snapshot.experiment_id) if snapshot.experiment_id else ""
        target_idx = index_by_experiment_id.get(experiment_id_key)
        if target_idx is None:
            target_idx = index_by_name.get(name_key)

        if target_idx is None:
            index_by_name[name_key] = len(merged)
            if experiment_id_key:
                index_by_experiment_id[experiment_id_key] = len(merged)
            merged.append(confirmed_item)
            continue

        if merged[target_idx].get("schoolStatus") == "school_graded":
            continue

        merged[target_idx] = {
            **merged[target_idx],
            **confirmed_item,
            "experimentName": merged[target_idx].get("experimentName") or confirmed_item.get("experimentName"),
        }
    return merged


def _overview_latest_data(session: Session, user_id: int) -> SchoolOverviewLatest:
    cooldown_seconds = _sync_cooldown_seconds(session)
    latest = _latest_overview_snapshot(session, user_id)
    confirmed_snapshots = _latest_confirmed_submit_snapshots(session, user_id)
    if not latest:
        experiments = _merge_confirmed_submit_statuses([], confirmed_snapshots)
        return SchoolOverviewLatest(
            lastSyncedAt=None,
            shouldSync=True,
            cooldownSeconds=cooldown_seconds,
            remainingCooldownSeconds=0,
            summary=_recalculate_school_status_summary({}, experiments) if experiments else {},
            experiments=experiments,
        )

    latest_synced_at = latest.synced_at
    if latest_synced_at.tzinfo is None:
        latest_synced_at = latest_synced_at.replace(tzinfo=timezone.utc)
    elapsed = max(int((get_utc_now() - latest_synced_at).total_seconds()), 0)
    remaining = max(cooldown_seconds - elapsed, 0)
    experiments = _merge_confirmed_submit_statuses(
        copy.deepcopy((latest.snapshot_json or {}).get("experiments") or []),
        confirmed_snapshots,
        newer_than=latest.synced_at,
    )
    return SchoolOverviewLatest(
        lastSyncedAt=latest.synced_at,
        shouldSync=remaining == 0,
        cooldownSeconds=cooldown_seconds,
        remainingCooldownSeconds=remaining,
        summary=_recalculate_school_status_summary(latest.summary_json or {}, experiments),
        experiments=experiments,
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


def _ensure_student(current_user: User) -> None:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can use this school sync action.")


def _ensure_enabled_experiment(session: Session, experiment_id: str) -> Experiment:
    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found.")
    meta = (experiment.config_json or {}).get("meta") or {}
    enabled = meta.get("enabled", True)
    if enabled is False or (isinstance(enabled, str) and enabled.strip().lower() in {"false", "0", "no", "off"}):
        raise HTTPException(status_code=404, detail="Experiment not found.")
    return experiment


def _experiment_public_name(experiment: Experiment) -> str:
    meta = (experiment.config_json or {}).get("meta") or {}
    return str(meta.get("name") or experiment.title or experiment.id)


def _start_student_completion_check_job(
    *,
    session: Session,
    background_tasks: BackgroundTasks,
    current_user: User,
    experiment_id: Optional[str] = None,
) -> AutomationJobPublic:
    _ensure_student(current_user)
    experiment_ids = None
    public_params: Dict[str, Any] = {}
    if experiment_id:
        experiment = _ensure_enabled_experiment(session, experiment_id)
        experiment_ids = [experiment_id]
        public_params = {"experimentName": _experiment_public_name(experiment)}

    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=current_user.id,
            action="school_completion_check",
            idempotency_key=make_idempotency_key(
                "school_completion_check",
                current_user.id,
                experiment_id=experiment_id,
                force_token=force_token,
            ),
            public_message_code="school.completion.syncing",
            public_message_params=public_params,
            experiment_id=experiment_id,
            request_payload={
                "source": "student_experiment_completion_check" if experiment_id else "student_completion_check",
                "experiment_ids": experiment_ids,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_completion_check_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校系统填空完整性检查请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_completion_check, job.id, current_user.id, experiment_ids)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_completion_check_started",
            status="success",
            target_id=job.id,
            details=f"学生触发学校系统填空完整性检查，experiment_id={experiment_id or '*'}。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/completion-check", response_model=AutomationJobPublic)
def start_student_completion_check(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    return _start_student_completion_check_job(
        session=session,
        background_tasks=background_tasks,
        current_user=current_user,
    )


@router.post("/experiments/{experiment_id}/completion-check", response_model=AutomationJobPublic)
def start_student_experiment_completion_check(
    experiment_id: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    return _start_student_completion_check_job(
        session=session,
        background_tasks=background_tasks,
        current_user=current_user,
        experiment_id=experiment_id,
    )


@router.get("/completion-check/{job_id}", response_model=CompletionCheckResponse)
def get_student_completion_check_result(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> CompletionCheckResponse:
    _ensure_student(current_user)
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != current_user.id or job.action != "school_completion_check":
        raise HTTPException(status_code=404, detail="Completion check job not found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Completion check job has not succeeded.")
    result = (job.result_payload or {}).get("completionCheck")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="Completion check result not found.")
    return CompletionCheckResponse(**result)


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


def _start_school_report_screenshot_job(
    *,
    session: Session,
    background_tasks: BackgroundTasks,
    actor_user_id: int,
    requested_by_user_id: int,
    experiment_id: str,
    submission_id: Optional[str],
    source: str,
) -> AutomationJobPublic:
    idempotency_key = make_idempotency_key(
        "school_report_screenshot",
        actor_user_id,
        experiment_id=experiment_id,
        submission_id=submission_id,
    )
    public_params = {"experimentName": experiment_id}

    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=actor_user_id,
            action="school_report_screenshot",
            idempotency_key=idempotency_key,
            public_message_code="school.screenshot.syncing",
            public_message_params=public_params,
            experiment_id=experiment_id,
            submission_id=submission_id,
            request_payload={
                "source": source,
                "experiment_id": experiment_id,
                "submission_id": submission_id,
                "requested_by": requested_by_user_id,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=requested_by_user_id,
            action="school_report_screenshot_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校报告截图请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_report_screenshot, job.id, actor_user_id, experiment_id)
        _add_audit_log(
            session,
            user_id=requested_by_user_id,
            action="school_report_screenshot_started",
            status="success",
            target_id=job.id,
            details=f"学校报告截图任务已创建，experiment={experiment_id}。",
        )
    else:
        _add_audit_log(
            session,
            user_id=requested_by_user_id,
            action="school_report_screenshot_reused",
            status="success",
            target_id=job.id,
            details=f"复用正在执行的学校报告截图任务，experiment={experiment_id}。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/experiments/{experiment_id}/screenshot", response_model=AutomationJobPublic)
def start_school_experiment_report_screenshot(
    experiment_id: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can capture school experiment screenshots.")
    return _start_school_report_screenshot_job(
        session=session,
        background_tasks=background_tasks,
        actor_user_id=current_user.id,
        requested_by_user_id=current_user.id,
        experiment_id=experiment_id,
        submission_id=None,
        source="student_experiment_detail",
    )


@router.post("/experiments/{experiment_id}/submissions/{submission_id}/screenshot", response_model=AutomationJobPublic)
def start_school_submission_experiment_report_screenshot(
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
    return _start_school_report_screenshot_job(
        session=session,
        background_tasks=background_tasks,
        actor_user_id=submission.student_id,
        requested_by_user_id=current_user.id,
        experiment_id=experiment_id,
        submission_id=submission.id,
        source="review_submission_detail",
    )


def _start_student_submission_screenshots_job(
    *,
    session: Session,
    background_tasks: BackgroundTasks,
    current_user: User,
) -> AutomationJobPublic:
    _ensure_student(current_user)
    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=current_user.id,
            action="school_submission_screenshots",
            idempotency_key=make_idempotency_key(
                "school_submission_screenshots",
                current_user.id,
                force_token=force_token,
            ),
            public_message_code="school.submissionScreenshots.syncing",
            request_payload={
                "source": "student_submission_screenshots",
                "experiment_ids": None,
            },
        )
    except AutomationJobConflict as exc:
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_submission_screenshots_rejected",
            status="failed",
            target_id=exc.job.id if exc.job else None,
            details=f"学校系统所有提交截图请求被拒绝：{exc.code}",
        )
        session.commit()
        raise _automation_conflict_response(exc)

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_submission_screenshots, job.id, current_user.id)
        _add_audit_log(
            session,
            user_id=current_user.id,
            action="school_submission_screenshots_started",
            status="success",
            target_id=job.id,
            details="学生触发学校系统所有提交截图。",
        )

    session.add(job)
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/submission-screenshots", response_model=AutomationJobPublic)
def start_student_submission_screenshots(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AutomationJobPublic:
    return _start_student_submission_screenshots_job(
        session=session,
        background_tasks=background_tasks,
        current_user=current_user,
    )


@router.get("/submission-screenshots/{job_id}", response_model=SubmissionScreenshotsResponse)
def get_student_submission_screenshots_result(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SubmissionScreenshotsResponse:
    _ensure_student(current_user)
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != current_user.id or job.action != "school_submission_screenshots":
        raise HTTPException(status_code=404, detail="Submission screenshots job not found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Submission screenshots job has not succeeded.")
    result = (job.result_payload or {}).get("submissionScreenshots")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="Submission screenshots result not found.")
    return SubmissionScreenshotsResponse(**result)


@router.get("/submission-screenshots/{job_id}/files/{experiment_id}")
def get_student_submission_screenshot_file(
    job_id: str,
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    _ensure_student(current_user)
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != current_user.id or job.action != "school_submission_screenshots":
        raise HTTPException(status_code=404, detail="Submission screenshots job not found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Submission screenshots job has not succeeded.")
    result = (job.result_payload or {}).get("submissionScreenshots")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="Submission screenshots result not found.")
    experiment_result = next(
        (
            item
            for item in (result.get("experiments") or [])
            if item.get("experimentId") == experiment_id and item.get("captureStatus") == "captured"
        ),
        None,
    )
    if not experiment_result:
        raise HTTPException(status_code=404, detail="Submission screenshot not found.")
    raw_path = experiment_result.get("screenshotPath")
    if not raw_path:
        raise HTTPException(status_code=404, detail="Submission screenshot file not found.")

    artifact_root = _artifact_dir(job.id).resolve()
    screenshot_path = Path(str(raw_path)).resolve()
    try:
        screenshot_path.relative_to(artifact_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid screenshot artifact path.")
    if not screenshot_path.exists() or not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Submission screenshot file not found.")
    return FileResponse(
        screenshot_path,
        media_type="image/png",
        filename=f"{experiment_id}-school-report.png",
    )


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
    student = session.get(User, submission.student_id)
    public_params = {
        "experimentName": (submission.corrected_json or {}).get("experiment_name") or experiment_id,
        "studentNo": student.student_no if student else None,
    }

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
            enforce_single_user_active_job=False,
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
        job.public_message_code = "school.submit.saving"
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
            details=f"学校系统{'正式' if request.mode == 'final' else '临时'}提交任务已进入队列。job_id={job.id}",
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
