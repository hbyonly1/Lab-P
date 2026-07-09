import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from sqlalchemy import func, or_

from api.deps import get_current_admin
from api.v1.automation_jobs import AutomationJobPublic, to_public_job
from api.v1.school_sync import (
    _merge_confirmed_submit_statuses,
    _overview_latest_data,
    _recalculate_school_status_summary,
    _submit_confirmed_status_matches,
)
from core.db import get_session
from core.school_password import encrypt_school_password
from core.security import get_password_hash
from models.core import AuditLog, AutomationJob, Experiment, SchoolSyncSnapshot, Submission, User, get_utc_now
from services.automation_job_service import AutomationJobConflict, create_or_reuse_automation_job, make_idempotency_key
from services.admin_final_submit_drafts import run_admin_final_submit_drafts
from services.school_completion_check import run_school_completion_check
from services.school_overview_sync import run_school_overview_sync
from services.school_report_sync import _artifact_dir
from services.school_submission_screenshots import run_school_submission_screenshots

router = APIRouter()

STUDENT_REGEX = re.compile(r"^26A\d{10}$")


@dataclass
class LightweightSubmitSnapshot:
    user_id: int
    experiment_id: Optional[str]
    synced_at: Any
    summary_json: Dict[str, Any]


class AdminStudentCreateRequest(BaseModel):
    student_no: str = Field(alias="studentNo")
    password: str

    model_config = {"populate_by_name": True}


class AdminStudentOverviewSyncRequest(BaseModel):
    close_session_after_finish: bool = Field(default=False, alias="closeSessionAfterFinish")

    model_config = {"populate_by_name": True}


class AdminStudentExperiment(BaseModel):
    id: str
    name: str
    status: str
    submission_id: Optional[str] = Field(default=None, alias="submissionId")
    submission_batch_id: Optional[str] = Field(default=None, alias="submissionBatchId")
    image_count: int = Field(default=0, alias="imageCount")
    assigned_image_count: int = Field(default=0, alias="assignedImageCount")
    preprocess_status: Optional[str] = Field(default=None, alias="preprocessStatus")
    preprocess_error: Optional[str] = Field(default=None, alias="preprocessError")
    school_status: str = Field(default="school_not_synced", alias="schoolStatus")
    original_status_text: str = Field(default="", alias="originalStatusText")
    score: Optional[str] = None
    school_status_synced_at: Optional[str] = Field(default=None, alias="schoolStatusSyncedAt")

    model_config = {"populate_by_name": True}


def _assigned_image_count(image_slots: Optional[Dict[str, Any]]) -> int:
    total = 0
    for raw_items in (image_slots or {}).values():
        items = raw_items if isinstance(raw_items, list) else [raw_items]
        total += len([
            item for item in items
            if (isinstance(item, str) and item.strip()) or (isinstance(item, dict) and item.get("url"))
        ])
    return total


class AdminStudentSummary(BaseModel):
    total_experiment_count: int = Field(alias="totalExperimentCount")
    final_submitted_count: int = Field(alias="finalSubmittedCount")
    draft_submitted_count: int = Field(alias="draftSubmittedCount")
    platform_completed_count: int = Field(alias="platformCompletedCount")
    pending_sync_count: int = Field(alias="pendingSyncCount")

    model_config = {"populate_by_name": True}


class AdminStudentItem(BaseModel):
    id: int
    username: str
    student_no: Optional[str] = Field(default=None, alias="studentNo")
    real_name: Optional[str] = Field(default=None, alias="realName")
    last_synced_at: Optional[str] = Field(default=None, alias="lastSyncedAt")
    summary: AdminStudentSummary
    experiments: List[AdminStudentExperiment] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AdminStudentListSummary(BaseModel):
    total_students: int = Field(alias="totalStudents")
    final_submitted_count: int = Field(default=0, alias="finalSubmittedCount")
    draft_submitted_count: int = Field(default=0, alias="draftSubmittedCount")
    pending_sync_count: int = Field(default=0, alias="pendingSyncCount")

    model_config = {"populate_by_name": True}


class AdminStudentListResponse(BaseModel):
    items: List[AdminStudentItem]
    total: int
    page: int
    pageSize: int
    summary: AdminStudentListSummary

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
    missing: List[CompletionMissingItem] = Field(default_factory=list)
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
    experiments: List[CompletionExperimentResult]

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
    experiments: List[SubmissionScreenshotExperimentResult]

    model_config = {"populate_by_name": True}


def _add_audit_log(
    session: Session,
    *,
    user_id: int,
    action: str,
    status: str,
    target_id: Optional[str],
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


def _normalize_school_name(value: Any) -> str:
    return "".join(str(value or "").split())


def _enabled_experiments(session: Session) -> List[Experiment]:
    experiments = session.exec(select(Experiment)).all()
    visible = []
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


def _latest_submissions_by_experiment(session: Session, student_id: int) -> Dict[str, Submission]:
    submissions = session.exec(
        select(Submission)
        .where(Submission.student_id == student_id)
        .order_by(Submission.created_at.desc())
    ).all()
    latest: Dict[str, Submission] = {}
    for submission in submissions:
        if submission.experiment_id not in latest:
            latest[submission.experiment_id] = submission
    return latest


def _school_status_by_name(overview: Any) -> Dict[str, Dict[str, Any]]:
    mapping: Dict[str, Dict[str, Any]] = {}
    for item in overview.experiments or []:
        key = _normalize_school_name(item.get("experimentName"))
        if key:
            mapping[key] = item
    return mapping


def _student_experiments(session: Session, student: User, experiments: List[Experiment]) -> tuple[List[AdminStudentExperiment], AdminStudentSummary, Optional[str]]:
    latest_submissions = _latest_submissions_by_experiment(session, student.id)
    overview = _overview_latest_data(session, student.id)
    school_by_name = _school_status_by_name(overview)
    rows: List[AdminStudentExperiment] = []

    final_count = 0
    draft_count = 0
    platform_completed_count = 0
    pending_sync_count = 0

    for experiment in experiments:
        config = experiment.config_json or {}
        meta = config.get("meta") or {}
        name = meta.get("name") or experiment.title or experiment.id
        submission = latest_submissions.get(experiment.id)
        school_item = school_by_name.get(_normalize_school_name(name)) or {}
        school_status = school_item.get("schoolStatus") or "school_not_synced"

        if school_status in {"school_final_submitted", "school_graded"}:
            final_count += 1
        elif school_status == "school_draft_submitted":
            draft_count += 1
        elif school_status in {"school_not_synced", "school_unknown"}:
            pending_sync_count += 1

        if submission and submission.status == "completed":
            platform_completed_count += 1

        synced_at = school_item.get("schoolStatusSyncedAt") or overview.last_synced_at
        rows.append(
            AdminStudentExperiment(
                id=experiment.id,
                name=name,
                status=submission.status if submission else "unsubmitted",
                submissionId=submission.id if submission else None,
                submissionBatchId=submission.submission_batch_id if submission else None,
                imageCount=len(submission.image_paths or []) if submission else 0,
                assignedImageCount=_assigned_image_count(submission.image_slots if submission else None),
                preprocessStatus=submission.preprocess_status if submission else None,
                preprocessError=submission.preprocess_error if submission else None,
                schoolStatus=school_status,
                originalStatusText=school_item.get("originalStatusText") or "",
                score=school_item.get("score") or "",
                schoolStatusSyncedAt=synced_at.isoformat() if hasattr(synced_at, "isoformat") else synced_at,
            )
        )

    return (
        rows,
        AdminStudentSummary(
            totalExperimentCount=len(rows),
            finalSubmittedCount=final_count,
            draftSubmittedCount=draft_count,
            platformCompletedCount=platform_completed_count,
            pendingSyncCount=pending_sync_count,
        ),
        overview.last_synced_at.isoformat() if overview.last_synced_at else None,
    )


def _student_item(
    session: Session,
    student: User,
    experiments: List[Experiment],
    *,
    include_experiments: bool = False,
) -> AdminStudentItem:
    rows, summary, last_synced_at = _student_experiments(session, student, experiments)
    return AdminStudentItem(
        id=student.id,
        username=student.username,
        studentNo=student.student_no,
        realName=student.real_name,
        lastSyncedAt=last_synced_at,
        summary=summary,
        experiments=rows if include_experiments else [],
    )


def _latest_overview_snapshots_by_student(
    session: Session,
    student_ids: List[int],
) -> Dict[int, SchoolSyncSnapshot]:
    if not student_ids:
        return {}
    snapshots = session.exec(
        select(SchoolSyncSnapshot)
        .where(SchoolSyncSnapshot.user_id.in_(student_ids))
        .where(SchoolSyncSnapshot.submission_id == None)  # noqa: E711
        .where(SchoolSyncSnapshot.experiment_id == None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.user_id.asc(), SchoolSyncSnapshot.synced_at.desc())
    ).all()
    latest: Dict[int, SchoolSyncSnapshot] = {}
    for snapshot in snapshots:
        if snapshot.user_id not in latest:
            latest[snapshot.user_id] = snapshot
    return latest


def _latest_confirmed_submit_snapshots_by_student(
    session: Session,
    student_ids: List[int],
) -> Dict[int, List[LightweightSubmitSnapshot]]:
    if not student_ids:
        return {}
    rows = session.exec(
        select(
            SchoolSyncSnapshot.user_id,
            SchoolSyncSnapshot.experiment_id,
            SchoolSyncSnapshot.synced_at,
            SchoolSyncSnapshot.summary_json,
        )
        .where(SchoolSyncSnapshot.user_id.in_(student_ids))
        .where(SchoolSyncSnapshot.submission_id != None)  # noqa: E711
        .where(SchoolSyncSnapshot.experiment_id != None)  # noqa: E711
        .order_by(SchoolSyncSnapshot.user_id.asc(), SchoolSyncSnapshot.synced_at.desc())
    ).all()
    latest_keys: set[tuple[int, str]] = set()
    grouped: Dict[int, List[LightweightSubmitSnapshot]] = {}
    for user_id, experiment_id, synced_at, summary_json in rows:
        summary = summary_json or {}
        if summary.get("source") != "school_submit_confirmed":
            continue
        if summary.get("statusConfirmation") != "list_confirmed":
            continue
        if not _submit_confirmed_status_matches(summary):
            continue
        key = str(experiment_id or summary.get("experimentName") or "")
        if not key:
            continue
        marker = (user_id, key)
        if marker in latest_keys:
            continue
        latest_keys.add(marker)
        grouped.setdefault(user_id, []).append(
            LightweightSubmitSnapshot(
                user_id=user_id,
                experiment_id=experiment_id,
                synced_at=synced_at,
                summary_json=summary,
            )
        )
    return grouped


def _student_list_item_from_snapshot(
    student: User,
    *,
    total_experiment_count: int,
    latest_snapshot: Optional[SchoolSyncSnapshot],
    confirmed_snapshots: Optional[List[SchoolSyncSnapshot]] = None,
) -> AdminStudentItem:
    confirmed_items = confirmed_snapshots or []
    base_experiments = []
    if latest_snapshot:
        base_experiments = (latest_snapshot.snapshot_json or {}).get("experiments") or []
    merged_experiments = _merge_confirmed_submit_statuses(
        list(base_experiments),
        confirmed_items,
        newer_than=latest_snapshot.synced_at if latest_snapshot else None,
    )
    summary_json = _recalculate_school_status_summary(latest_snapshot.summary_json if latest_snapshot else {}, merged_experiments)
    final_count = int(summary_json.get("finalSubmitted") or 0)
    draft_count = int(summary_json.get("draftSubmitted") or 0)
    pending_sync_count = max(total_experiment_count - final_count - draft_count, 0)
    confirmed_synced_at = max(
        (snapshot.synced_at for snapshot in confirmed_items if snapshot.synced_at),
        default=None,
    )
    last_synced_at = latest_snapshot.synced_at if latest_snapshot and latest_snapshot.synced_at else confirmed_synced_at
    return AdminStudentItem(
        id=student.id,
        username=student.username,
        studentNo=student.student_no,
        realName=student.real_name,
        lastSyncedAt=last_synced_at.isoformat() if last_synced_at else None,
        summary=AdminStudentSummary(
            totalExperimentCount=total_experiment_count,
            finalSubmittedCount=final_count,
            draftSubmittedCount=draft_count,
            platformCompletedCount=0,
            pendingSyncCount=pending_sync_count,
        ),
        experiments=[],
    )


def _upsert_student(session: Session, student_no: str, password: str) -> User:
    login_name = student_no.strip()
    if not STUDENT_REGEX.match(login_name):
        raise HTTPException(status_code=422, detail="学号格式不正确。")
    if not password:
        raise HTTPException(status_code=422, detail="学校系统密码不能为空。")

    student = session.exec(select(User).where(User.student_no == login_name)).first()
    if not student:
        student = User(
            username=login_name,
            student_no=login_name,
            hashed_password=get_password_hash(password),
            encrypted_school_password=encrypt_school_password(password),
            role="student",
            capabilities={"max_computes": 100, "ai_model": "gpt-4"},
        )
        session.add(student)
        session.commit()
        session.refresh(student)
        return student

    if student.role != "student":
        raise HTTPException(status_code=409, detail="该账号不是学生账号。")
    student.hashed_password = get_password_hash(password)
    student.encrypted_school_password = encrypt_school_password(password)
    session.add(student)
    session.commit()
    session.refresh(student)
    return student


@router.get("", response_model=AdminStudentListResponse)
def list_admin_students(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
    page: int = Query(1, ge=1),
    page_size: int = Query(5, alias="pageSize", ge=1, le=100),
    query: Optional[str] = None,
    final_count_filter: Optional[str] = Query(default=None, alias="finalCountFilter"),
) -> AdminStudentListResponse:
    filters = [User.role == "student"]
    keyword = str(query or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        filters.append(or_(
            User.username.ilike(pattern),
            User.student_no.ilike(pattern),
            User.real_name.ilike(pattern),
        ))
    total_experiment_count = len(_enabled_experiments(session))
    if final_count_filter in {"lt8", "gte8"}:
        all_students = session.exec(
            select(User)
            .where(*filters)
            .order_by(User.created_at.desc())
        ).all()
        all_student_ids = [student.id for student in all_students]
        latest_snapshots = _latest_overview_snapshots_by_student(session, all_student_ids)
        confirmed_snapshots = _latest_confirmed_submit_snapshots_by_student(session, all_student_ids)
        all_items = [
            _student_list_item_from_snapshot(
                student,
                total_experiment_count=total_experiment_count,
                latest_snapshot=latest_snapshots.get(student.id),
                confirmed_snapshots=confirmed_snapshots.get(student.id) or [],
            )
            for student in all_students
        ]
        if final_count_filter == "lt8":
            all_items = [item for item in all_items if item.summary.final_submitted_count < 8]
        else:
            all_items = [item for item in all_items if item.summary.final_submitted_count >= 8]
        total = len(all_items)
        items = all_items[(page - 1) * page_size: page * page_size]
        return AdminStudentListResponse(
            items=items,
            total=total,
            page=page,
            pageSize=page_size,
            summary=AdminStudentListSummary(
                totalStudents=total,
                finalSubmittedCount=sum(item.summary.final_submitted_count for item in items),
                draftSubmittedCount=sum(item.summary.draft_submitted_count for item in items),
                pendingSyncCount=sum(item.summary.pending_sync_count for item in items),
            ),
        )

    total = session.exec(select(func.count()).select_from(User).where(*filters)).one()
    students = session.exec(
        select(User)
        .where(*filters)
        .order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    student_ids = [student.id for student in students]
    latest_snapshots = _latest_overview_snapshots_by_student(session, student_ids)
    confirmed_snapshots = _latest_confirmed_submit_snapshots_by_student(session, student_ids)
    items = [
        _student_list_item_from_snapshot(
            student,
            total_experiment_count=total_experiment_count,
            latest_snapshot=latest_snapshots.get(student.id),
            confirmed_snapshots=confirmed_snapshots.get(student.id) or [],
        )
        for student in students
    ]
    return AdminStudentListResponse(
        items=items,
        total=total,
        page=page,
        pageSize=page_size,
        summary=AdminStudentListSummary(
            totalStudents=total,
            finalSubmittedCount=sum(item.summary.final_submitted_count for item in items),
            draftSubmittedCount=sum(item.summary.draft_submitted_count for item in items),
            pendingSyncCount=sum(item.summary.pending_sync_count for item in items),
        ),
    )


@router.get("/{student_id}/experiments", response_model=List[AdminStudentExperiment])
def list_admin_student_experiments(
    student_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> List[AdminStudentExperiment]:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")
    rows, _summary, _last_synced_at = _student_experiments(session, student, _enabled_experiments(session))
    return rows


@router.post("", response_model=AdminStudentItem)
def create_admin_student(
    request: AdminStudentCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AdminStudentItem:
    student = _upsert_student(session, request.student_no, request.password)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_upsert",
        status="success",
        target_id=str(student.id),
        details=f"管理员添加或更新学生账号 {student.student_no}。",
    )
    session.commit()
    return _student_item(session, student, _enabled_experiments(session))


@router.post("/{student_id}/sync-overview", response_model=AutomationJobPublic)
def sync_admin_student_overview(
    student_id: int,
    background_tasks: BackgroundTasks,
    request: Optional[AdminStudentOverviewSyncRequest] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationJobPublic:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")

    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_overview_sync",
            idempotency_key=make_idempotency_key("school_overview_sync", student.id, force_token=force_token),
            public_message_code="school.overview.syncing",
            request_payload={
                "force": True,
                "source": "admin_students_page",
                "requestedBy": current_user.id,
                "closeSessionAfterFinish": bool(request.close_session_after_finish) if request else False,
            },
        )
    except AutomationJobConflict as exc:
        if exc.job:
            return to_public_job(exc.job)
        raise HTTPException(status_code=409, detail={"code": exc.code})

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_overview_sync, job.id, student.id)

    session.add(job)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_overview_sync_started",
        status="success",
        target_id=str(student.id),
        details=f"管理员为学生 {student.student_no} 触发学校状态刷新，job_id={job.id}。",
    )
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/{student_id}/experiments/{experiment_id}/edit-submission", response_model=Submission)
def ensure_admin_student_edit_submission(
    student_id: int,
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> Submission:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")

    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found.")

    existing_submission = session.exec(
        select(Submission)
        .where(Submission.student_id == student.id)
        .where(Submission.experiment_id == experiment_id)
        .where(Submission.is_one_click_handoff == False)  # noqa: E712
        .order_by(Submission.created_at.desc())
    ).first()
    if existing_submission:
        return existing_submission

    now = get_utc_now()
    submission = Submission(
        id=f"SUB-{uuid.uuid4().hex[:8].upper()}",
        student_id=student.id,
        experiment_id=experiment_id,
        order_id=None,
        submitted_by=current_user.id,
        status="incomplete",
        payment_status="not_required",
        is_one_click_handoff=False,
        image_paths=[],
        image_slots={},
        created_at=now,
        updated_at=now,
    )
    session.add(submission)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_edit_submission_created",
        status="success",
        target_id=submission.id,
        details=f"管理员为学生 {student.student_no} 创建实验 {experiment_id} 的编辑提交。",
    )
    session.commit()
    session.refresh(submission)
    return submission


@router.post("/{student_id}/completion-check", response_model=AutomationJobPublic)
def start_admin_student_completion_check(
    student_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationJobPublic:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")

    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_completion_check",
            idempotency_key=make_idempotency_key("school_completion_check", student.id, force_token=force_token),
            public_message_code="school.completion.syncing",
            request_payload={
                "force": True,
                "source": "admin_students_page",
                "requestedBy": current_user.id,
            },
        )
    except AutomationJobConflict as exc:
        if exc.job:
            return to_public_job(exc.job)
        raise HTTPException(status_code=409, detail={"code": exc.code})

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_completion_check, job.id, student.id)

    session.add(job)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_school_completion_check_started",
        status="success",
        target_id=str(student.id),
        details=f"管理员为学生 {student.student_no} 触发学校系统填空完整性检查，job_id={job.id}。",
    )
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.get("/{student_id}/completion-check/{job_id}", response_model=CompletionCheckResponse)
def get_admin_student_completion_check_result(
    student_id: int,
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> CompletionCheckResponse:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != student.id or job.action != "school_completion_check":
        raise HTTPException(status_code=404, detail="Completion check job not found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Completion check job has not succeeded.")
    payload = job.result_payload or {}
    result = payload.get("completionCheck")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="Completion check result not found.")
    return CompletionCheckResponse(**result)


@router.post("/{student_id}/submission-screenshots", response_model=AutomationJobPublic)
def start_admin_student_submission_screenshots(
    student_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationJobPublic:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")

    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_submission_screenshots",
            idempotency_key=make_idempotency_key("school_submission_screenshots", student.id, force_token=force_token),
            public_message_code="school.submissionScreenshots.syncing",
            request_payload={
                "force": True,
                "source": "admin_students_page",
                "requestedBy": current_user.id,
            },
        )
    except AutomationJobConflict as exc:
        if exc.job:
            return to_public_job(exc.job)
        raise HTTPException(status_code=409, detail={"code": exc.code})

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_school_submission_screenshots, job.id, student.id)

    session.add(job)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_submission_screenshots_started",
        status="success",
        target_id=str(student.id),
        details=f"管理员为学生 {student.student_no} 触发所有已提交实验截图，job_id={job.id}。",
    )
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.post("/{student_id}/final-submit-drafts", response_model=AutomationJobPublic)
def start_admin_student_final_submit_drafts(
    student_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationJobPublic:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")

    force_token = uuid.uuid4().hex
    try:
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="admin_final_submit_drafts",
            idempotency_key=make_idempotency_key("admin_final_submit_drafts", student.id, force_token=force_token),
            public_message_code="school.finalSubmitDrafts.syncing",
            request_payload={
                "force": True,
                "source": "admin_students_page",
                "requestedBy": current_user.id,
                "requiredSubmittedCount": 8,
            },
        )
    except AutomationJobConflict as exc:
        if exc.job:
            return to_public_job(exc.job)
        raise HTTPException(status_code=409, detail={"code": exc.code})

    if created:
        now = get_utc_now()
        job.status = "running"
        job.public_status = "running"
        job.started_at = now
        job.updated_at = now
        background_tasks.add_task(run_admin_final_submit_drafts, job.id, student.id)

    session.add(job)
    _add_audit_log(
        session,
        user_id=current_user.id,
        action="admin_student_final_submit_drafts_started",
        status="success",
        target_id=str(student.id),
        details=f"管理员为学生 {student.student_no} 触发临时提交转正式提交，job_id={job.id}。",
    )
    session.commit()
    session.refresh(job)
    return to_public_job(job)


@router.get("/{student_id}/submission-screenshots/{job_id}", response_model=SubmissionScreenshotsResponse)
def get_admin_student_submission_screenshots_result(
    student_id: int,
    job_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> SubmissionScreenshotsResponse:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != student.id or job.action != "school_submission_screenshots":
        raise HTTPException(status_code=404, detail="Submission screenshots job not found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Submission screenshots job has not succeeded.")
    payload = job.result_payload or {}
    result = payload.get("submissionScreenshots")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="Submission screenshots result not found.")
    return SubmissionScreenshotsResponse(**result)


@router.get("/{student_id}/submission-screenshots/{job_id}/files/{experiment_id}")
def get_admin_student_submission_screenshot_file(
    student_id: int,
    job_id: str,
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> FileResponse:
    student = session.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found.")
    job = session.get(AutomationJob, job_id)
    if not job or job.actor_user_id != student.id or job.action != "school_submission_screenshots":
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
            if str(item.get("experimentId") or "") == experiment_id
        ),
        None,
    )
    if not experiment_result or experiment_result.get("captureStatus") != "captured":
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
        filename=f"{student.student_no or student.id}-{experiment_id}.png",
    )
