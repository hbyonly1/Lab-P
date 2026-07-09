from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import Any, Dict, List, Optional
from sqlalchemy import func, or_

from core.db import get_session
from models.core import Submission, User, Experiment, AuditLog, SubmissionDraft
from api.deps import get_current_user, get_current_reviewer_or_admin
from pydantic import BaseModel
import uuid
from worker.ai_tasks import prepare_submission_for_review_task
from models.core import get_utc_now
from services.submission_preprocess import (
    build_single_slot_default_image_slots,
)

router = APIRouter()

class CorrectionSaveRequest(BaseModel):
    corrected_json: dict
    image_paths: List[str] = []
    image_slots: Dict[str, Any] = {}
    save_mode: str = "draft"

class SubmissionDraftSaveRequest(BaseModel):
    draft_json: dict
    image_paths: List[str] = []
    image_slots: Dict[str, Any] = {}
    local_revision: int = 0

class SubmissionDraftResponse(BaseModel):
    submission_id: str
    draft_json: dict = {}
    image_paths: List[str] = []
    image_slots: Dict[str, Any] = {}
    local_revision: int = 0
    updated_at: Optional[str] = None
    updated_by: Optional[int] = None

class SelfManagedSubmissionRequest(BaseModel):
    experiment_id: str
    image_paths: List[str] = []

class ImageSlotsRequest(BaseModel):
    image_slots: Dict[str, Any] = {}

class BatchPrepareRequest(BaseModel):
    assignments: Dict[str, Dict[str, Any]] = {}

class SubmissionReviewResponse(BaseModel):
    id: str
    student_id: int
    student_username: str
    student_name: Optional[str] = None
    student_no: Optional[str] = None
    real_name: Optional[str] = None
    experiment_id: str
    status: str
    submitted_by: Optional[int] = None
    submission_batch_id: Optional[str] = None
    image_count: int = 0
    assigned_image_count: int = 0
    preprocess_status: Optional[str] = None
    preprocess_error: Optional[str] = None
    updated_at: str = None


class SubmissionReviewListResponse(BaseModel):
    items: List[SubmissionReviewResponse]
    total: int
    page: int
    pageSize: int
    summary: Dict[str, int] = {}


def _normalize_image_slots(image_slots: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    normalized: Dict[str, List[Dict[str, Any]]] = {}
    for slot_id, raw_items in (image_slots or {}).items():
        if not slot_id:
            continue
        items = raw_items if isinstance(raw_items, list) else [raw_items]
        slot_files = []
        for item in items:
            if isinstance(item, str):
                url = item.strip()
                if url:
                    slot_files.append({"url": url})
            elif isinstance(item, dict):
                url = str(item.get("url") or "").strip()
                if url:
                    slot_files.append({**item, "url": url})
        if slot_files:
            normalized[str(slot_id)] = slot_files
    return normalized


def _image_slot_count(image_slots: Dict[str, Any]) -> int:
    return sum(len(items) for items in _normalize_image_slots(image_slots).values())


def _single_slot_default_image_slots(submission: Submission) -> Dict[str, List[Dict[str, Any]]]:
    return build_single_slot_default_image_slots(submission)


AI_PREPROCESS_SUBMISSION_STATUSES = {
    "preparing_review",
    "recognizing",
    "reviewing",
    "submitting",
    "draft_submitted",
    "completed",
}

AI_PREPROCESS_STATUSES = {"queued", "running", "done"}


def _submission_has_entered_ai_preprocess(submission: Submission) -> bool:
    return (
        submission.status in AI_PREPROCESS_SUBMISSION_STATUSES
        or submission.preprocess_status in AI_PREPROCESS_STATUSES
    )


def _image_slot_target_values(experiment_id: str, image_slots: Dict[str, Any]) -> Dict[str, str]:
    try:
        from services.experimentConfigStore import get_experiment_config
        exp_config = get_experiment_config(experiment_id) or {}
    except Exception:
        exp_config = {}

    target_values: Dict[str, str] = {}
    for slot in (exp_config.get("inputs") or {}).get("images", []):
        slot_id = slot.get("id")
        target_node_id = slot.get("targetNodeId")
        if not slot_id or not target_node_id:
            continue
        urls = [
            item.get("url")
            for item in _normalize_image_slots(image_slots).get(slot_id, [])
            if item.get("url")
        ]
        if urls:
            target_values[str(target_node_id)] = ",".join(urls)
    return target_values


def _assert_submission_editable(submission: Submission, current_user: User) -> None:
    if current_user.role == "student":
        if submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        if submission.is_one_click_handoff:
            raise HTTPException(status_code=403, detail="一键托管任务不能由学生直接修改。")

    if current_user.role == "reviewer" and submission.submitted_by not in [None, current_user.id] and submission.status not in [
        "reviewing",
        "pending_recognition",
        "recognizing",
        "pending_image_assignment",
        "preparing_review",
        "draft_submitted",
        "completed",
    ]:
        raise HTTPException(status_code=403, detail="Not enough permissions")


def _draft_response(submission_id: str, draft: Optional[SubmissionDraft]) -> SubmissionDraftResponse:
    if not draft:
        return SubmissionDraftResponse(submission_id=submission_id)
    return SubmissionDraftResponse(
        submission_id=submission_id,
        draft_json=draft.draft_json or {},
        image_paths=draft.image_paths or [],
        image_slots=draft.image_slots or {},
        local_revision=draft.local_revision or 0,
        updated_at=draft.updated_at.isoformat() if draft.updated_at else None,
        updated_by=draft.updated_by,
    )

@router.post("/self-managed", response_model=Submission)
def create_self_managed_submission(
    req: SelfManagedSubmissionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> Any:
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can create self-managed submissions.")

    existing_exp = session.get(Experiment, req.experiment_id)
    if not existing_exp:
        new_exp = Experiment(id=req.experiment_id, title=req.experiment_id)
        session.add(new_exp)
        session.commit()

    existing_submission = session.exec(
        select(Submission)
        .where(Submission.student_id == current_user.id)
        .where(Submission.experiment_id == req.experiment_id)
        .where(Submission.is_one_click_handoff == False)  # noqa: E712
        .order_by(Submission.created_at.desc())
    ).first()

    if existing_submission:
        if req.image_paths:
            existing_submission.image_paths = req.image_paths
        existing_submission.updated_at = get_utc_now()
        session.add(existing_submission)
        session.commit()
        session.refresh(existing_submission)
        return existing_submission

    submission = Submission(
        id=f"SUB-{uuid.uuid4().hex[:8].upper()}",
        student_id=current_user.id,
        experiment_id=req.experiment_id,
        order_id=None,
        submitted_by=None,
        status="incomplete",
        payment_status="not_required",
        is_one_click_handoff=False,
        image_paths=req.image_paths,
        image_slots={},
    )
    session.add(submission)
    session.add(AuditLog(
        user_id=current_user.id,
        action="self_managed_submission_created",
        status="success",
        target_id=submission.id,
        details=f"创建实验 {req.experiment_id} 的自助提交草稿。",
    ))
    session.commit()
    session.refresh(submission)
    return submission


@router.get("/{submission_id}/draft", response_model=SubmissionDraftResponse)
def get_submission_draft(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Any:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _assert_submission_editable(submission, current_user)

    draft = session.exec(
        select(SubmissionDraft).where(SubmissionDraft.submission_id == submission_id)
    ).first()
    return _draft_response(submission_id, draft)


@router.patch("/{submission_id}/draft", response_model=SubmissionDraftResponse)
def save_submission_draft(
    submission_id: str,
    req: SubmissionDraftSaveRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Any:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _assert_submission_editable(submission, current_user)

    image_slots = _normalize_image_slots(req.image_slots)
    draft_json = dict(req.draft_json or {})
    if isinstance(draft_json.get("values"), dict):
        draft_json["values"] = {
            **draft_json["values"],
            **_image_slot_target_values(submission.experiment_id, image_slots),
        }
    else:
        draft_json = {
            **draft_json,
            **_image_slot_target_values(submission.experiment_id, image_slots),
        }
    draft_json["_meta"] = {
        **(draft_json.get("_meta") or {}),
        "save_mode": "autosave",
        "saved_by": current_user.id,
        "saved_role": current_user.role,
        "saved_at": get_utc_now().isoformat(),
    }

    now = get_utc_now()
    draft = session.exec(
        select(SubmissionDraft).where(SubmissionDraft.submission_id == submission_id)
    ).first()
    if not draft:
        draft = SubmissionDraft(
            submission_id=submission_id,
            created_at=now,
        )

    draft.draft_json = draft_json
    draft.image_paths = req.image_paths
    draft.image_slots = image_slots
    draft.local_revision = req.local_revision or 0
    draft.updated_by = current_user.id
    draft.updated_at = now
    submission.updated_at = now

    session.add(draft)
    session.add(submission)
    session.commit()
    session.refresh(draft)
    return _draft_response(submission_id, draft)


@router.patch("/{submission_id}/correction", response_model=Submission)
def save_submission_correction(
    submission_id: str,
    req: CorrectionSaveRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> Any:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _assert_submission_editable(submission, current_user)

    image_slots = _normalize_image_slots(req.image_slots)
    corrected_json = dict(req.corrected_json or {})
    if isinstance(corrected_json.get("values"), dict):
        corrected_json["values"] = {
            **corrected_json["values"],
            **_image_slot_target_values(submission.experiment_id, image_slots),
        }
    else:
        corrected_json = {
            **corrected_json,
            **_image_slot_target_values(submission.experiment_id, image_slots),
        }
    corrected_json["_meta"] = {
        **(corrected_json.get("_meta") or {}),
        "save_mode": req.save_mode,
        "saved_by": current_user.id,
        "saved_role": current_user.role,
        "saved_at": get_utc_now().isoformat(),
    }
    submission.corrected_json = corrected_json
    submission.image_paths = req.image_paths
    submission.image_slots = image_slots
    submission.updated_at = get_utc_now()

    if req.save_mode == "final":
        if submission.is_one_click_handoff and submission.status in ["pending_recognition", "recognizing", "pending_image_assignment", "preparing_review"]:
            submission.status = "reviewing"
        elif not submission.is_one_click_handoff:
            submission.status = "submitting"

    session.add(submission)
    log = AuditLog(
        user_id=current_user.id,
        action="save_submission_correction",
        status="success",
        target_id=submission.id,
        details=f"保存实验 {submission.experiment_id} 的 {'正式' if req.save_mode == 'final' else '临时'}数据。",
    )
    session.add(log)
    session.commit()
    session.refresh(submission)
    return submission


@router.patch("/{submission_id}/image-slots", response_model=Submission)
def save_submission_image_slots(
    submission_id: str,
    req: ImageSlotsRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin),
) -> Any:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not submission.is_one_click_handoff:
        raise HTTPException(status_code=400, detail="Only one-click handoff submissions use image assignment.")

    if _submission_has_entered_ai_preprocess(submission):
        return submission

    image_slots = _normalize_image_slots(req.image_slots)
    submission.image_slots = image_slots
    submission.preprocess_status = "image_assigned" if image_slots else "waiting_for_image_assignment"
    submission.preprocess_error = None
    if submission.status in ["pending_recognition", "recognizing"]:
        submission.status = "pending_image_assignment"
    submission.updated_at = get_utc_now()
    session.add(submission)
    session.add(AuditLog(
        user_id=current_user.id,
        action="submission_image_slots_saved",
        status="success",
        target_id=submission.id,
        details=f"保存图片归位，共 {_image_slot_count(image_slots)} 张图片。",
    ))
    session.commit()
    session.refresh(submission)
    return submission


@router.post("/batches/{batch_id}/prepare-review")
def prepare_submission_batch_for_review(
    batch_id: str,
    req: BatchPrepareRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin),
) -> Any:
    submissions = session.exec(
        select(Submission).where(Submission.submission_batch_id == batch_id)
    ).all()
    if not submissions:
        raise HTTPException(status_code=404, detail="Submission batch not found")

    by_id = {submission.id: submission for submission in submissions}
    if req.assignments:
        unknown_ids = sorted(set(req.assignments.keys()) - set(by_id.keys()))
        if unknown_ids:
            raise HTTPException(status_code=400, detail=f"Submissions do not belong to batch: {', '.join(unknown_ids)}")
    target_submission_ids = set(req.assignments.keys()) if req.assignments else None
    target_submissions = [
        submission for submission in submissions
        if target_submission_ids is None or submission.id in target_submission_ids
    ]

    started = []
    queued_now = []
    skipped_already_processing = []
    skipped_missing_images = []
    now = get_utc_now()
    for submission in target_submissions:
        if _submission_has_entered_ai_preprocess(submission):
            skipped_already_processing.append(submission.id)
            continue

        assigned_slots = req.assignments.get(submission.id)
        if assigned_slots is not None:
            submission.image_slots = _normalize_image_slots(assigned_slots)
        if not _normalize_image_slots(submission.image_slots):
            submission.image_slots = _single_slot_default_image_slots(submission)
        if not _normalize_image_slots(submission.image_slots):
            skipped_missing_images.append(submission.id)
            continue
        submission.status = "preparing_review"
        submission.preprocess_status = "queued"
        submission.preprocess_error = None
        submission.updated_at = now
        session.add(submission)
        started.append(submission.id)
        queued_now.append(submission.id)

    if not started:
        if skipped_already_processing:
            return {
                "batch_id": batch_id,
                "status": "already_processing",
                "submission_ids": [],
                "skipped_already_processing": skipped_already_processing,
                "skipped_missing_images": skipped_missing_images,
            }
        raise HTTPException(status_code=400, detail="No submissions in this batch have assigned image slots.")

    session.add(AuditLog(
        user_id=current_user.id,
        action="submission_batch_prepare_started",
        status="success",
        target_id=batch_id,
        details=f"批量预处理已启动，共 {len(started)} 个实验。",
    ))
    session.commit()

    for submission_id in queued_now:
        task_result = prepare_submission_for_review_task.delay(submission_id, current_user.id)
        task_id = getattr(task_result, "id", None) or "unknown"
        session.add(AuditLog(
            user_id=current_user.id,
            action="submission_prepare_review_queued",
            status="success",
            target_id=submission_id,
            details=f"审核预处理任务已入队，Celery task_id={task_id}",
        ))
    session.commit()

    return {
        "batch_id": batch_id,
        "status": "queued",
        "submission_ids": started,
        "skipped_already_processing": skipped_already_processing,
        "skipped_missing_images": skipped_missing_images,
    }

@router.get("/my", response_model=List[Submission])
def get_my_submissions(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Student retrieves their own submissions.
    """
    statement = select(Submission).where(Submission.student_id == current_user.id).order_by(Submission.created_at.desc())
    return session.exec(statement).all()

@router.get("/review-pool", response_model=SubmissionReviewListResponse)
def get_review_pool(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    query: Optional[str] = None,
    status: Optional[str] = None,
    reviewStatus: Optional[str] = None,
) -> Any:
    """
    Reviewer/Admin retrieves all tasks waiting for review.
    Absolutely isolated from students.
    """
    allowed_statuses = [
            "pending_image_assignment",
            "preparing_review",
            "pending_recognition",
            "recognizing",
            "reviewing",
            "submitting",
            "draft_submitted",
            "completed",
            "error",
        ]
    filters = [Submission.status.in_(allowed_statuses)]
    if status:
        filters.append(Submission.status == status)
    if reviewStatus == "completed":
        filters.append(Submission.status.in_(["draft_submitted", "completed"]))
    elif reviewStatus == "incomplete":
        filters.append(~Submission.status.in_(["draft_submitted", "completed"]))
    keyword = str(query or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        filters.append(or_(
            Submission.id.ilike(pattern),
            Submission.experiment_id.ilike(pattern),
            Submission.submission_batch_id.ilike(pattern),
            User.username.ilike(pattern),
            User.student_no.ilike(pattern),
            User.real_name.ilike(pattern),
        ))

    base = select(Submission, User).join(User, Submission.student_id == User.id).where(*filters)
    total = session.exec(
        select(func.count()).select_from(Submission).join(User, Submission.student_id == User.id).where(*filters)
    ).one()
    statement = (
        base
        .order_by(Submission.created_at.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
    )
    results = session.exec(statement).all()

    out = []
    for sub, user in results:
        out.append(SubmissionReviewResponse(
            id=sub.id,
            student_id=sub.student_id,
            student_username=user.student_no or user.username,
            student_name=user.real_name,
            student_no=user.student_no,
            real_name=user.real_name,
            experiment_id=sub.experiment_id,
            status=sub.status,
            submitted_by=sub.submitted_by,
            submission_batch_id=sub.submission_batch_id,
            image_count=len(sub.image_paths or []),
            assigned_image_count=_image_slot_count(sub.image_slots or {}),
            preprocess_status=sub.preprocess_status,
            preprocess_error=sub.preprocess_error,
            updated_at=sub.updated_at.isoformat() if sub.updated_at else None
        ))
    summary_rows = session.exec(
        select(Submission.status, func.count())
        .where(Submission.status.in_(allowed_statuses))
        .group_by(Submission.status)
    ).all()
    summary = {str(status_key): int(count or 0) for status_key, count in summary_rows}
    return SubmissionReviewListResponse(items=out, total=total, page=page, pageSize=pageSize, summary=summary)

@router.get("/{submission_id}")
def get_submission(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Retrieve a specific submission.
    """
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
        
    if current_user.role not in ["admin", "reviewer"] and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    student = session.get(User, submission.student_id)
    payload = submission.model_dump()
    payload.update({
        "student_no": student.student_no if student else None,
        "studentNo": student.student_no if student else None,
        "student_username": student.student_no or student.username if student else None,
        "studentUsername": student.student_no or student.username if student else None,
        "student_name": student.real_name if student else None,
        "studentName": student.real_name if student else None,
    })
    return payload
