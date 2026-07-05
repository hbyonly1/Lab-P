from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from datetime import timedelta
from typing import Any, Optional
import re

from core.db import get_session
from core.security import verify_password, create_access_token
from core.config import settings
from models.core import User
from pydantic import BaseModel
from api.deps import get_current_user

router = APIRouter()

class UserResponse(BaseModel):
    id: int
    username: str
    student_no: Optional[str] = None
    real_name: Optional[str] = None
    role: str
    capabilities: dict

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> Any:
    return current_user

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    student_no: Optional[str] = None
    real_name: Optional[str] = None
    role: str
    capabilities: dict

STUDENT_REGEX = re.compile(r"^26A25\d{8}$")

@router.post("/login", response_model=TokenResponse)
def login_access_token(
    session: Session = Depends(get_session), 
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests.
    """
    login_name = form_data.username.strip()
    
    # Check if student
    if STUDENT_REGEX.match(login_name):
        user = session.exec(select(User).where(User.student_no == login_name)).first()
        if not user:
            from core.security import get_password_hash
            user = User(
                username=login_name,
                student_no=login_name,
                hashed_password=get_password_hash(login_name),
                role="student",
                capabilities={"max_computes": 100, "ai_model": "gpt-4"}
            )
            session.add(user)
            session.commit()
            session.refresh(user)
    else:
        user = session.exec(select(User).where(User.username == login_name)).first()
        # Admin or invalid format
        if not user or not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect username or password")
            
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": create_access_token(
            user.id, expires_delta=access_token_expires
        ),
        "token_type": "bearer",
        "username": user.username,
        "student_no": user.student_no,
        "real_name": user.real_name,
        "role": user.role,
        "capabilities": user.capabilities
    }
