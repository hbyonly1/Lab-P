from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Any, Dict, List, Optional

from core.db import get_session
from models.core import Submission, User, Order, Experiment, AuditLog
from api.deps import get_current_user, get_current_reviewer_or_admin
from pydantic import BaseModel
import uuid
from worker.ai_tasks import prepare_submission_for_review_task
from core.pricing import PRICES
from models.core import get_utc_now

router = APIRouter()

class SubmitRequest(BaseModel):
    experiment_id: str
    target_student: str = None
    is_hungup: bool = False
    plan: str = "pay_per_use"
    image_paths: List[str] = []
    submission_batch_id: Optional[str] = None

class CorrectionSaveRequest(BaseModel):
    corrected_json: dict
    image_paths: List[str] = []
    image_slots: Dict[str, Any] = {}
    save_mode: str = "draft"

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


def _new_batch_id() -> str:
    return f"BATCH-{uuid.uuid4().hex[:10].upper()}"


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


def _one_click_ready_status(has_paid: bool) -> str:
    return "pending_image_assignment" if has_paid else "pending_payment"

@router.post("/submit", response_model=Submission)
def create_submission(
    req: SubmitRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> Any:
    has_paid = True
    order_id = None
    user_plan = current_user.capabilities.get("plan", "free") if current_user.capabilities else "free"
    is_pro = user_plan == "pro"
    image_paths = [path for path in (req.image_paths or []) if path]
    submission_batch_id = (req.submission_batch_id or "").strip() or _new_batch_id()

    def ensure_uploaded_images() -> None:
        if not image_paths:
            raise HTTPException(
                status_code=400,
                detail="一键提交至少需要上传一个实验图片。",
            )

    # Auto-seed the experiment if it doesn't exist to prevent foreign key violation
    existing_exp = session.get(Experiment, req.experiment_id)
    if not existing_exp:
        new_exp = Experiment(id=req.experiment_id, title=req.experiment_id)
        session.add(new_exp)
        session.commit()
    
    if current_user.role not in ["admin", "reviewer"] and not is_pro:
        statement = select(Order).where(
            Order.student_id == current_user.id,
            Order.experiment_id == req.experiment_id,
            Order.status == "paid"
        )
        existing_order = session.exec(statement).first()
        if not existing_order:
            has_paid = False
            # Plus 用户的特殊校验：如果他们试图进行一键提交，但没有pay_per_use订单，拦截
            if user_plan in ["plus", "free"]:
                if not req.is_hungup:
                    raise HTTPException(
                        status_code=403, 
                        detail=f"当前套餐 ({user_plan}) 不支持一键自动化填报，请升级至 Pro 或购买单次提交。"
                    )
            
            # 如果没有支付，且没有声明挂起状态，则强硬拒绝 (对其他未知状态保底)
            if not req.is_hungup:
                raise HTTPException(
                    status_code=403, 
                    detail="A paid order is required to submit this experiment."
                )
            else:
                # 声明了挂起，自动生成一个挂起订单
                ensure_uploaded_images()
                new_order = Order(
                    id=f"ORD-{str(uuid.uuid4())[:8].upper()}",
                    student_id=current_user.id,
                    experiment_id=req.experiment_id,
                    plan=req.plan,
                    amount=PRICES.get(req.plan, 8.0),
                    status="pending_payment"
                )
                session.add(new_order)
                session.commit()
                session.refresh(new_order)
                order_id = new_order.id
        else:
            ensure_uploaded_images()
            order_id = existing_order.id

    if current_user.role in ["admin", "reviewer"] or is_pro:
        ensure_uploaded_images()
            
    # Handle Admin proxy submission
    actual_student_id = current_user.id
    if current_user.role in ["admin", "reviewer"] and req.target_student:
        target_student_no = req.target_student.strip()
        student = session.exec(select(User).where(User.student_no == target_student_no)).first()
        if not student:
            # Create the student account directly from the explicit student number.
            from core.security import get_password_hash
            student = User(
                username=target_student_no,
                student_no=target_student_no,
                hashed_password=get_password_hash(target_student_no),
                encrypted_school_password=None,
                role="student",
                capabilities={"max_computes": 100, "ai_model": "gpt-4"}
            )
            session.add(student)
            session.commit()
            session.refresh(student)
        actual_student_id = student.id

    sub_id = f"SUB-{uuid.uuid4().hex[:8].upper()}"
    submission = Submission(
        id=sub_id,
        student_id=actual_student_id,
        experiment_id=req.experiment_id,
        order_id=order_id,
        submitted_by=current_user.id if actual_student_id != current_user.id else None,
        status=_one_click_ready_status(has_paid),
        payment_status="paid" if has_paid else "unpaid",
        is_one_click_handoff=True,
        image_paths=image_paths,
        image_slots={},
        submission_batch_id=submission_batch_id,
        preprocess_status="waiting_for_image_assignment" if has_paid else None,
    )
    session.add(submission)
    session.commit()
    session.refresh(submission)
    return submission


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


@router.post("/{submission_id}/approve")
def approve_submission(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin)
):
    """
    Legacy endpoint kept blocked while school automation uses automation_jobs.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy Playwright trigger is disabled. Use /api/v1/school-sync/experiments/{experiment_id}/submit.",
    )

@router.post("/{submission_id}/submit-to-playwright")
def submit_to_playwright(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Legacy endpoint kept blocked while school automation uses automation_jobs.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy Playwright trigger is disabled. Use /api/v1/school-sync/experiments/{experiment_id}/submit.",
    )

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

    if current_user.role == "student" and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if current_user.role == "reviewer" and submission.submitted_by not in [None, current_user.id] and submission.status not in ["reviewing", "pending_recognition", "recognizing", "pending_image_assignment", "preparing_review"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

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

    started = []
    now = get_utc_now()
    for submission in submissions:
        assigned_slots = req.assignments.get(submission.id)
        if assigned_slots is not None:
            submission.image_slots = _normalize_image_slots(assigned_slots)
        if not _normalize_image_slots(submission.image_slots):
            continue
        submission.status = "preparing_review"
        submission.preprocess_status = "queued"
        submission.preprocess_error = None
        submission.updated_at = now
        session.add(submission)
        started.append(submission.id)

    if not started:
        raise HTTPException(status_code=400, detail="No submissions in this batch have assigned image slots.")

    session.add(AuditLog(
        user_id=current_user.id,
        action="submission_batch_prepare_started",
        status="success",
        target_id=batch_id,
        details=f"批量预处理已启动，共 {len(started)} 个实验。",
    ))
    session.commit()

    for submission_id in started:
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

@router.get("/review-pool", response_model=List[SubmissionReviewResponse])
def get_review_pool(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin)
) -> Any:
    """
    Reviewer/Admin retrieves all tasks waiting for review.
    Absolutely isolated from students.
    """
    statement = (
        select(Submission, User)
        .join(User, Submission.student_id == User.id)
        .where(Submission.status.in_([
            "pending_image_assignment",
            "preparing_review",
            "pending_recognition",
            "recognizing",
            "reviewing",
            "submitting",
            "draft_submitted",
            "completed",
            "error",
        ]))
        .order_by(Submission.created_at.desc())
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
    return out

@router.get("/{submission_id}", response_model=Submission)
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
        
    return submission
