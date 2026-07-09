from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import Any, Dict, List, Optional
from sqlalchemy import func, or_

from core.db import get_session
from models.core import Order, OrderItem, User, get_utc_now
from api.deps import get_current_admin
from pydantic import BaseModel
from services.checkout_service import apply_order_payment_action

router = APIRouter()

class OrderVerifyRequest(BaseModel):
    action: str # "verify" or "reject"


class OrderListResponse(BaseModel):
    items: List[Dict[str, Any]]
    total: int
    page: int
    pageSize: int
    summary: Dict[str, Any]


@router.get("/")
def list_orders(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin), # Only admins list all orders for now
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    plan: Optional[str] = None,
    query: Optional[str] = None,
) -> OrderListResponse:
    """Admin retrieves all orders."""
    filters = []
    if status:
        filters.append(Order.status == status)
    if plan:
        filters.append(Order.plan == plan)
    keyword = str(query or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        filters.append(or_(
            Order.id.ilike(pattern),
            Order.submission_batch_id.ilike(pattern),
            User.username.ilike(pattern),
            User.student_no.ilike(pattern),
            User.real_name.ilike(pattern),
        ))

    base = select(Order, User).join(User, Order.student_id == User.id)
    count_statement = select(func.count()).select_from(Order).join(User, Order.student_id == User.id)
    if filters:
        base = base.where(*filters)
        count_statement = count_statement.where(*filters)
    total = session.exec(count_statement).one()
    offset = (page - 1) * pageSize
    statement = base.order_by(Order.created_at.desc()).offset(offset).limit(pageSize)
    results = session.exec(statement).all()
    order_ids = [order.id for order, _user in results]
    items_by_order = {order_id: [] for order_id in order_ids}
    if order_ids:
        for item in session.exec(select(OrderItem).where(OrderItem.order_id.in_(order_ids)).order_by(OrderItem.id.asc())).all():
            items_by_order.setdefault(item.order_id, []).append(item.model_dump())

    today = get_utc_now().date()
    summary = {
        "pendingCount": session.exec(select(func.count()).where(Order.status == "pending_payment")).one(),
        "rejectedCount": session.exec(select(func.count()).where(Order.status == "rejected")).one(),
        "paidTotalAmount": float(session.exec(select(func.coalesce(func.sum(Order.amount), 0)).where(Order.status == "paid")).one() or 0),
        "paidTodayAmount": float(session.exec(
            select(func.coalesce(func.sum(Order.amount), 0))
            .where(Order.status == "paid")
            .where(func.date(Order.created_at) == today)
        ).one() or 0),
    }

    items = [
        {
            **order.model_dump(),
            "student_username": user.student_no or user.username,
            "student_no": user.student_no,
            "real_name": user.real_name,
            "items": items_by_order.get(order.id, []),
        }
        for order, user in results
    ]
    return OrderListResponse(items=items, total=total, page=page, pageSize=pageSize, summary=summary)

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
    result = apply_order_payment_action(session, order, action_req.action, current_user.id)
    return {"message": f"Order successfully {action_req.action}ed", **result}
