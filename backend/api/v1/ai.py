from fastapi import APIRouter, Depends, HTTPException, Body
from sqlmodel import Session, select
from typing import Any, List, Optional
from pydantic import BaseModel
from core.db import get_session
from models.core import User, AiConfig, AiPromptTemplate, Submission
from api.deps import get_current_user, get_current_reviewer_or_admin, get_current_admin
from worker.ai_tasks import recognize_images_task, generate_answer_task, fixed_fill_task, recognize_submission_task
from worker.celery_app import celery_app
from cryptography.fernet import Fernet
from core.config import settings
from datetime import datetime

router = APIRouter()

class RecognizeDirectRequest(BaseModel):
    experiment_id: str
    image_paths: List[str]

class GenerateAnswerRequest(BaseModel):
    experiment_id: str
    questions: List[dict]
    current_form_values: dict

class AiConfigUpdate(BaseModel):
    base_url: str
    model: str
    fallback_model: Optional[str] = None
    api_key: Optional[str] = None
    timeout_seconds: int = 60
    temperature: float = 0.85
    max_images_per_task: int = 8
    max_concurrent_tasks: int = 4
    auto_recognize: bool = False

class AiPromptUpdate(BaseModel):
    recognition_system_prompt: Optional[str] = None
    recognition_extra_prompt: Optional[str] = None
    generation_system_prompt: Optional[str] = None
    generation_extra_prompt: Optional[str] = None
    generation_data_nodes: Optional[str] = None


class PreviewPromptResponse(BaseModel):
    recognition_prompt: str
    generation_prompt: str


@router.post("/recognize-direct")
def recognize_direct(
    req: RecognizeDirectRequest,
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan == "free":
            raise HTTPException(status_code=403, detail="此功能需要 Plus 或 Pro 套餐")
            
    task = recognize_images_task.delay(req.experiment_id, req.image_paths, current_user.id)
    return {"task_id": task.id}

@router.post("/generate-answer-direct")
def generate_answer_direct(
    req: GenerateAnswerRequest,
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan == "free":
            raise HTTPException(status_code=403, detail="此功能需要 Plus 或 Pro 套餐")
            
    task = generate_answer_task.delay(
        req.experiment_id, 
        req.questions, 
        req.current_form_values, 
        current_user.id
    )
    return {"task_id": task.id}

@router.post("/fixed-fill/{experiment_id}")
def get_fixed_fill_direct(
    experiment_id: str,
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan in ["free", "plus"]:
            raise HTTPException(status_code=403, detail="此功能需要 Pro 套餐")
            
    task = fixed_fill_task.delay(experiment_id, current_user.id)
    return {"task_id": task.id}

@router.get("/task/{task_id}")
def get_task_status(task_id: str, current_user: User = Depends(get_current_user)):
    task_result = celery_app.AsyncResult(task_id)
    
    if task_result.state == 'PENDING':
        return {"status": "pending"}
    elif task_result.state != 'FAILURE':
        return {"status": "done", "result": task_result.result}
    else:
        # 失败状态，普通用户返回简化信息，管理员返回完整 trace
        error_msg = str(task_result.info)
        if current_user.role != "admin":
            error_msg = "处理失败，请稍后重试"
        return {"status": "error", "message": error_msg}

@router.post("/recognize/{submission_id}")
def recognize_submission(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_reviewer_or_admin)
):
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
        
    if submission.status != "pending_recognition":
        raise HTTPException(status_code=409, detail=f"Cannot recognize in status {submission.status}")
        
    submission.status = "recognizing"
    session.add(submission)
    session.commit()
    
    recognize_submission_task.delay(submission.id, current_user.id)
    return {"status": "success", "message": "Recognition triggered"}

@router.get("/status/{submission_id}")
def get_submission_status(
    submission_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    submission = session.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Not found")
        
    if current_user.role == "student" and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    return {"status": submission.status, "recognition_json": submission.recognition_json}

# --- Admin Configuration ---

@router.get("/admin/config")
def get_ai_config(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    config = session.get(AiConfig, 1)
    if not config:
        return {}
    
    data = config.model_dump()
    if data.get("api_key_encrypted"):
        data["api_key"] = "configured"
    else:
        data["api_key"] = None
    del data["api_key_encrypted"]
    
    return data

@router.put("/admin/config")
def update_ai_config(
    req: AiConfigUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    config = session.get(AiConfig, 1)
    if not config:
        config = AiConfig(id=1)
        
    config.base_url = req.base_url
    config.model = req.model
    config.fallback_model = req.fallback_model
    config.timeout_seconds = req.timeout_seconds
    config.temperature = req.temperature
    config.max_images_per_task = req.max_images_per_task
    config.max_concurrent_tasks = req.max_concurrent_tasks
    config.auto_recognize = req.auto_recognize
    
    if req.api_key and req.api_key != "configured":
        if not settings.AI_ENCRYPTION_KEY:
            raise HTTPException(status_code=500, detail="Missing AI_ENCRYPTION_KEY in environment")
        f = Fernet(settings.AI_ENCRYPTION_KEY.encode())
        config.api_key_encrypted = f.encrypt(req.api_key.encode()).decode()
        
    session.add(config)
    session.commit()
    return {"status": "success"}

@router.get("/admin/prompts/{experiment_id}")
def get_prompt_template(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    template = session.get(AiPromptTemplate, experiment_id)
    if not template:
        return {}
    return template

@router.put("/admin/prompts/{experiment_id}")
def update_prompt_template(
    experiment_id: str,
    req: AiPromptUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    template = session.get(AiPromptTemplate, experiment_id)
    if not template:
        template = AiPromptTemplate(experiment_id=experiment_id)
        
    template.recognition_system_prompt = req.recognition_system_prompt
    template.recognition_extra_prompt = req.recognition_extra_prompt
    template.generation_system_prompt = req.generation_system_prompt
    template.generation_extra_prompt = req.generation_extra_prompt
    template.generation_data_nodes = req.generation_data_nodes
    template.updated_at = datetime.utcnow()
    
    session.add(template)
    session.commit()
    return {"status": "success"}

@router.post("/admin/prompts/{experiment_id}/preview", response_model=PreviewPromptResponse)
def preview_prompt_template(
    experiment_id: str,
    req: AiPromptUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    from services.experimentConfigStore import get_experiment_config, collect_ai_recognition_node_ids
    from core.ai_prompts import build_recognition_prompt, build_generation_answers_prompt
    
    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        raise HTTPException(status_code=404, detail="Experiment configuration not found")
        
    # Use the requested values as a temporary template for preview
    db_template = AiPromptTemplate(
        experiment_id=experiment_id,
        recognition_system_prompt=req.recognition_system_prompt,
        recognition_extra_prompt=req.recognition_extra_prompt,
        generation_system_prompt=req.generation_system_prompt,
        generation_extra_prompt=req.generation_extra_prompt,
        generation_data_nodes=req.generation_data_nodes
    )
    
    recognition_node_ids = collect_ai_recognition_node_ids(exp_config)
                        
    recognition_prompt = build_recognition_prompt(exp_config, recognition_node_ids, db_template)
    
    # Mock data for generation preview
    mock_form_values = {}
    for nid in recognition_node_ids:
        mock_form_values[nid] = "【填入的数据】"
        
    questions = [
        {
            "index": idx + 1,
            "nodeId": q.get("nodeId"),
            "title": q.get("title") or "",
        }
        for idx, q in enumerate(exp_config.get("ui", {}).get("questions", []))
        if q.get("nodeId")
    ]
    generation_prompt = build_generation_answers_prompt(questions, mock_form_values, exp_config, db_template)
    
    return PreviewPromptResponse(
        recognition_prompt=recognition_prompt,
        generation_prompt=generation_prompt
    )
