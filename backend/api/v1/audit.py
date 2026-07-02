from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from core.db import get_session
from models.core import AuditLog, User
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from api.deps import get_current_reviewer_or_admin, get_current_user

router = APIRouter()

STUDENT_VISIBLE_AUDIT_ACTIONS = {
    "order_created",
    "payment_reported",
    "payment_verified",
    "payment_rejected",
    "files_uploaded",
    "ai_recognition_started",
    "ai_recognition_completed",
    "ai_recognition_failed",
    "auto_submit_started",
    "auto_submit_completed",
    "auto_submit_failed",
}

class AuditLogResponse(BaseModel):
    id: int
    action: str
    status: str
    target_id: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime
    initiator_id: int
    initiator_name: str

@router.get("/logs", response_model=List[AuditLogResponse])
def get_audit_logs(session: Session = Depends(get_session), current_user: User = Depends(get_current_reviewer_or_admin)):
    """
    Get all audit logs, ordered by newest first.
    """
    logs_with_users = session.exec(
        select(AuditLog, User)
        .join(User, AuditLog.user_id == User.id, isouter=True)
        .order_by(AuditLog.created_at.desc())
    ).all()
    
    result = []
    for log, user in logs_with_users:
        result.append({
            "id": log.id,
            "action": log.action,
            "status": log.status,
            "target_id": log.target_id,
            "details": log.details,
            "created_at": log.created_at,
            "initiator_id": log.user_id,
            "initiator_name": user.username if user else "Unknown User"
        })
    return result

class StudentAuditLogResponse(BaseModel):
    action: str
    status: str
    details: Optional[str] = None
    created_at: datetime

@router.get("/my_logs", response_model=List[StudentAuditLogResponse])
def get_my_audit_logs(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """
    Get audit logs strictly related to the current student, returning minimal info.
    """
    logs = session.exec(
        select(AuditLog)
        .where(AuditLog.user_id == current_user.id)
        .where(AuditLog.action.in_(STUDENT_VISIBLE_AUDIT_ACTIONS))
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    ).all()
    
    result = []
    for log in logs:
        result.append({
            "action": log.action,
            "status": log.status,
            "details": log.details,
            "created_at": log.created_at
        })
    return result

class LogActionRequest(BaseModel):
    action: str
    status: str = "success"
    target_id: Optional[str] = None
    details: Optional[str] = None

@router.post("/log_action")
def log_user_action(req: LogActionRequest, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """
    Log an arbitrary action from the frontend (e.g. mock compute).
    """
    log = AuditLog(
        user_id=current_user.id,
        action=req.action,
        status=req.status,
        target_id=req.target_id,
        details=req.details
    )
    session.add(log)
    session.commit()
    return {"status": "success"}
