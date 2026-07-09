from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session

from api.deps import get_current_user
from core.db import get_session
from models.core import User
from services.checkout_service import build_checkout_quote, create_checkout, normalize_experiments


router = APIRouter()


class CheckoutExperiment(BaseModel):
    experiment_id: str
    image_paths: List[str] = Field(default_factory=list)
    image_slots: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)
    image_assignment_confirmed: bool = True


class CheckoutQuoteRequest(BaseModel):
    plan: str
    experiments: List[CheckoutExperiment] = Field(default_factory=list)


class CheckoutSubmitRequest(BaseModel):
    plan: str
    experiments: List[CheckoutExperiment] = Field(default_factory=list)
    target_student: Optional[str] = None
    is_hungup: bool = False
    submission_batch_id: Optional[str] = None
    client_request_id: Optional[str] = None


@router.post("/quote")
def quote_checkout(
    req: CheckoutQuoteRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return build_checkout_quote(
        session,
        req.plan,
        normalize_experiments([item.model_dump() for item in req.experiments]),
    )


@router.post("/submit")
def submit_checkout(
    req: CheckoutSubmitRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return create_checkout(
        session,
        current_user=current_user,
        plan=req.plan,
        experiments=normalize_experiments([item.model_dump() for item in req.experiments]),
        target_student=req.target_student,
        is_hungup=req.is_hungup,
        submission_batch_id=req.submission_batch_id,
        client_request_id=req.client_request_id,
    )
