from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from typing import Any, List, Optional
import uuid

from core.db import get_session
from core.pricing import PRICES
from models.core import Order, Submission, AuditLog, User
from api.deps import get_current_user, get_current_admin
from pydantic import BaseModel

router = APIRouter()

class OrderCreate(BaseModel):
    experiment_id: Optional[str] = None
    plan: str # free, pay_per_use, plus, pro

class OrderResponse(Order):
    student_username: str
    student_no: Optional[str] = None
    real_name: Optional[str] = None

class OrderVerifyRequest(BaseModel):
    action: str # "verify" or "reject"

@router.post("/", response_model=Order)
def create_order(
    *,
    session: Session = Depends(get_session),
    order_in: OrderCreate,
    current_user: User = Depends(get_current_user)
) -> Any:
    """Create a new order for an experiment."""
    # Centralized pricing logic
    amount = PRICES.get(order_in.plan, 0.0)
    
    is_upgrade = order_in.plan in ["plus", "pro"]
    actual_exp_id = None if is_upgrade else (order_in.experiment_id if order_in.experiment_id != "UPGRADE_PLAN" else None)
    
    order = Order(
        id=f"ORD-{str(uuid.uuid4())[:8].upper()}",
        student_id=current_user.id,
        experiment_id=actual_exp_id,
        plan=order_in.plan,
        amount=amount,
        status="paid" if amount == 0 else "pending_payment"
    )
    session.add(order)
    
    # Pre-create the submission linked to this order ONLY for real experiments
    if not is_upgrade and actual_exp_id:
        submission = Submission(
            id=f"SUB-{str(uuid.uuid4())[:8].upper()}",
            student_id=current_user.id,
            experiment_id=actual_exp_id,
            order_id=order.id,
            status="not_started" if amount == 0 else "pending_payment",
            payment_status="paid" if amount == 0 else "unpaid"
        )
        session.add(submission)
    
    # Audit Log
    log = AuditLog(
        user_id=current_user.id,
        action="order_created",
        status="success",
        target_id=order.id,
        details=f"Created {order_in.plan} order for exp {order_in.experiment_id}"
    )
    session.add(log)
    
    session.commit()
    session.refresh(order)
    return order

@router.get("/", response_model=List[OrderResponse])
def list_orders(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin), # Only admins list all orders for now
    skip: int = 0,
    limit: int = 100
) -> Any:
    """Admin retrieves all orders."""
    statement = select(Order, User).join(User, Order.student_id == User.id).order_by(Order.created_at.desc()).offset(skip).limit(limit)
    results = session.exec(statement).all()
    
    return [
        {
            **order.model_dump(),
            "student_username": user.student_no or user.username,
            "student_no": user.student_no,
            "real_name": user.real_name,
        }
        for order, user in results
    ]

@router.post("/{order_id}/verify")
def verify_payment(
    *,
    session: Session = Depends(get_session),
    order_id: str,
    action_req: OrderVerifyRequest,
    current_user: User = Depends(get_current_admin)
) -> Any:
    """Admin verifies or rejects a payment."""
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    if action_req.action == "verify":
        order.status = "paid"
        action_name = "payment_verified"
        if order.plan in ["plus", "pro"]:
            student_user = session.get(User, order.student_id)
            if student_user:
                caps = dict(student_user.capabilities) if student_user.capabilities else {}
                caps["plan"] = order.plan
                student_user.capabilities = caps
                session.add(student_user)
                session.add(student_user)
    else:
        order.status = "rejected"
        action_name = "payment_rejected"
        
    session.add(order)
    
    # Update linked submission state machine
    submission = session.exec(select(Submission).where(Submission.order_id == order.id)).first()
    if submission:
        if action_req.action == "verify":
            submission.status = "pending_image_assignment" if submission.is_one_click_handoff else "incomplete"
            submission.payment_status = "paid"
            submission.preprocess_status = "waiting_for_image_assignment" if submission.is_one_click_handoff else None
            submission.preprocess_error = None
        else:
            submission.status = "error"
        session.add(submission)
    
    student_user = session.get(User, order.student_id)
    if student_user:
        student_identity = student_user.real_name or "姓名未同步"
        if student_user.student_no:
            student_identity = f"{student_identity}，学号 {student_user.student_no}"
    else:
        student_identity = f"用户 {order.student_id}"
    action_cn = "确认了" if action_req.action == "verify" else "驳回了"
    
    # Audit log
    log = AuditLog(
        user_id=current_user.id,
        action=action_name,
        status="success",
        target_id=order.id,
        details=f"{action_cn}订单 {order.id} ({student_identity}) 的收款请求"
    )
    session.add(log)
    
    session.commit()
    return {"message": f"Order successfully {action_req.action}ed"}
