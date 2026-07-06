from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from datetime import timedelta
from typing import Any, Optional
import re

from core.db import get_session
from core.security import verify_password, create_access_token, get_password_hash
from core.school_password import encrypt_school_password
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

class LoginPreviewRequest(BaseModel):
    username: str

class LoginPreviewResponse(BaseModel):
    username: str
    is_student_login: bool
    account_exists: bool
    requires_school_credential_confirmation: bool

STUDENT_REGEX = re.compile(r"^26A\d{10}$")

@router.post("/login-preview", response_model=LoginPreviewResponse)
def preview_login(
    payload: LoginPreviewRequest,
    session: Session = Depends(get_session),
) -> Any:
    login_name = payload.username.strip()
    is_student_login = bool(STUDENT_REGEX.match(login_name))
    account_exists = False

    if is_student_login:
        account_exists = session.exec(select(User.id).where(User.student_no == login_name)).first() is not None

    return {
        "username": login_name,
        "is_student_login": is_student_login,
        "account_exists": account_exists,
        "requires_school_credential_confirmation": is_student_login and not account_exists,
    }

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
            user = User(
                username=login_name,
                student_no=login_name,
                hashed_password=get_password_hash(form_data.password),
                encrypted_school_password=encrypt_school_password(form_data.password),
                role="student",
                capabilities={"max_computes": 100, "ai_model": "gpt-4"}
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        elif not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect username or password")
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
