from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Any, List, Optional

from core.db import get_session
from models.core import Submission, User, Order, Experiment, AuditLog, AiConfig
from api.deps import get_current_user, get_current_reviewer_or_admin
from pydantic import BaseModel
import uuid
from worker.tasks import process_submission_task
from worker.ai_tasks import recognize_submission_task
from core.pricing import PRICES
from models.core import get_utc_now

router = APIRouter()

class SubmitRequest(BaseModel):
    experiment_id: str
    target_student: str = None
    is_hungup: bool = False
    plan: str = "pay_per_use"
    image_paths: List[str] = []

class CorrectionSaveRequest(BaseModel):
    corrected_json: dict
    image_paths: List[str] = []
    save_mode: str = "draft"

class SubmissionReviewResponse(BaseModel):
    id: str
    student_id: int
    student_username: str
    student_name: str
    student_no: Optional[str] = None
    real_name: Optional[str] = None
    experiment_id: str
    status: str
    submitted_by: Optional[int] = None
    updated_at: str = None

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
            order_id = existing_order.id
            
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
        status="pending_recognition" if has_paid else "pending_payment",
        payment_status="paid" if has_paid else "unpaid",
        is_one_click_handoff=True,
        image_paths=req.image_paths
    )
    session.add(submission)
    session.commit()
    session.refresh(submission)
    
    if has_paid:
        ai_config = session.get(AiConfig, 1)
        if ai_config and ai_config.auto_recognize:
            submission.status = "recognizing"
            session.add(submission)
            session.commit()
            recognize_submission_task.delay(submission.id, current_user.id)
    
    return submission

@router.post("/{submission_id}/approve")
def approve_submission(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin)
):
    """
    Reviewer/Admin approves a submission, triggering the automation task.
    """
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
        
    submission.status = "submitting"
    
    session.add(submission)
    session.commit()
    session.refresh(submission)
    
    # Push to background worker
    process_submission_task.delay(submission.id, current_user.id)
    
    return {"status": "success", "message": "Submission approved and automation triggered."}

@router.post("/{submission_id}/submit-to-playwright")
def submit_to_playwright(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    User/Reviewer/Admin pushes the submission directly to playwright (submitting state).
    """
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")
        
    if current_user.role == "student" and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    submission.status = "submitting"
    
    session.add(submission)
    session.commit()
    session.refresh(submission)
    
    process_submission_task.delay(submission.id, current_user.id)
    
    return {"status": "success", "message": "Submission triggered to Playwright."}

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

    if current_user.role == "reviewer" and submission.submitted_by not in [None, current_user.id] and submission.status not in ["reviewing", "pending_recognition", "recognizing"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    corrected_json = dict(req.corrected_json or {})
    corrected_json["_meta"] = {
        **(corrected_json.get("_meta") or {}),
        "save_mode": req.save_mode,
        "saved_by": current_user.id,
        "saved_role": current_user.role,
        "saved_at": get_utc_now().isoformat(),
    }
    submission.corrected_json = corrected_json
    submission.image_paths = req.image_paths
    submission.updated_at = get_utc_now()

    if req.save_mode == "final" and submission.status in ["pending_recognition", "recognizing"]:
        submission.status = "reviewing"

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
    # For MVP, return pending_recognition, recognizing and reviewing tasks
    statement = select(Submission, User).join(User, Submission.student_id == User.id).where(Submission.status.in_(["pending_recognition", "recognizing", "reviewing"])).order_by(Submission.created_at.desc())
    results = session.exec(statement).all()
    
    out = []
    for sub, user in results:
        out.append(SubmissionReviewResponse(
            id=sub.id,
            student_id=sub.student_id,
            student_username=user.student_no or user.username,
            student_name=user.real_name or user.student_no or user.username,
            student_no=user.student_no,
            real_name=user.real_name,
            experiment_id=sub.experiment_id,
            status=sub.status,
            submitted_by=sub.submitted_by,
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
