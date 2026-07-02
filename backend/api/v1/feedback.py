from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from typing import Any, List, Optional
from pydantic import BaseModel
from datetime import datetime

from core.db import get_session
from models.core import Feedback, User
from api.deps import get_current_user, get_current_admin

router = APIRouter()


class FeedbackCreate(BaseModel):
    contact_info: Optional[str] = None
    description: str


class FeedbackAdminItem(BaseModel):
    id: int
    user_id: Optional[int]
    username: Optional[str]
    contact_info: Optional[str]
    description: str
    created_at: datetime


class FeedbackStats(BaseModel):
    total: int


@router.post("/", status_code=201)
def submit_feedback(
    req: FeedbackCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Any logged-in user can submit feedback."""
    if not req.description or not req.description.strip():
        raise HTTPException(status_code=400, detail="问题描述不能为空")
    feedback = Feedback(
        user_id=current_user.id,
        contact_info=req.contact_info or None,
        description=req.description.strip(),
    )
    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    return {"id": feedback.id, "message": "反馈提交成功，感谢您的反馈！"}


@router.get("/stats", response_model=FeedbackStats)
def get_feedback_stats(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_admin),
) -> Any:
    """Admin only: get stats."""
    total = session.exec(select(func.count(Feedback.id))).one()
    return {"total": total}


@router.get("/", response_model=List[FeedbackAdminItem])
def list_feedbacks(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_admin),
) -> Any:
    """Admin only: list all feedback."""
    results = session.exec(
        select(Feedback, User)
        .join(User, Feedback.user_id == User.id, isouter=True)
        .order_by(Feedback.created_at.desc())
    ).all()

    out = []
    for fb, user in results:
        out.append(FeedbackAdminItem(
            id=fb.id,
            user_id=fb.user_id,
            username=user.username if user else None,
            contact_info=fb.contact_info,
            description=fb.description,
            created_at=fb.created_at,
        ))
    return out
