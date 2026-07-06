from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from typing import Any, List, Optional
from pydantic import BaseModel
from core.db import get_session
from models.core import AuditLog, AiConfig, User, AiPromptTemplate, Submission, get_utc_now
from api.deps import get_current_user, get_current_reviewer_or_admin, get_current_admin
from worker.ai_tasks import recognize_images_task, generate_answer_task, fixed_fill_task, recognize_submission_task
from worker.celery_app import celery_app
from core.config import settings
from datetime import datetime
import json
from services.ai_provider import AI_TASK_ANSWER_GENERATION, AI_TASK_IMAGE_RECOGNITION, AiProviderConfigError, ensure_ai_config, get_ai_provider
from services.ai_task_audit import audit_target_id, poll_timeout_seconds, start_ai_task_run
from core.ai_prompts import DEFAULT_GENERATION_SYSTEM, DEFAULT_RECOGNITION_SYSTEM

router = APIRouter()

class RecognizeDirectRequest(BaseModel):
    experiment_id: str
    image_paths: List[str]
    submission_id: Optional[str] = None

class GenerateAnswerRequest(BaseModel):
    experiment_id: str
    questions: List[dict]
    current_form_values: dict
    submission_id: Optional[str] = None


class FixedFillRequest(BaseModel):
    submission_id: Optional[str] = None


class AiConfigUpdate(BaseModel):
    provider: str = "openai_compatible"
    base_url: str
    default_model: str
    default_timeout_seconds: int = 60
    default_temperature: float = 0.7
    default_max_images_per_task: int = 8
    auto_recognize: bool = False
    image_recognition_model: str
    image_recognition_timeout_seconds: int = 60
    image_recognition_temperature: float = 0
    image_recognition_max_images_per_task: int = 8
    answer_generation_model: str
    answer_generation_timeout_seconds: int = 60
    answer_generation_temperature: float = 0.85
    captcha_model: str
    captcha_timeout_seconds: int = 30
    captcha_temperature: float = 0
    captcha_prompt: str


class AiPromptUpdate(BaseModel):
    recognition_system_prompt: Optional[str] = None
    recognition_extra_prompt: Optional[str] = None
    generation_system_prompt: Optional[str] = None
    generation_extra_prompt: Optional[str] = None


class PreviewPromptResponse(BaseModel):
    recognition_prompt: str
    generation_prompt: str


class AiPromptTemplateResponse(BaseModel):
    recognition_system_prompt: str
    recognition_extra_prompt: str = ""
    generation_system_prompt: str
    generation_extra_prompt: str = ""


class AiConnectionTestResponse(BaseModel):
    ok: bool
    output: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


@router.post("/recognize-direct")
def recognize_direct(
    req: RecognizeDirectRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan == "free":
            raise HTTPException(status_code=403, detail="此功能需要 Plus 或 Pro 套餐")

    if req.submission_id:
        submission = session.get(Submission, req.submission_id)
        if not submission or submission.experiment_id != req.experiment_id:
            raise HTTPException(status_code=404, detail="Submission not found")
        if current_user.role == "student" and submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden")

    target_id = audit_target_id(req.experiment_id, req.submission_id)
    task = recognize_images_task.delay(req.experiment_id, req.image_paths, current_user.id, req.submission_id)
    profile = get_ai_provider(session).get_profile(AI_TASK_IMAGE_RECOGNITION)
    start_ai_task_run(
        session,
        task_id=task.id,
        user_id=current_user.id,
        task_kind="image_recognition",
        target_id=target_id,
        experiment_id=req.experiment_id,
        submission_id=req.submission_id,
        details={
            "experiment_id": req.experiment_id,
            "submission_id": req.submission_id,
            "image_count": len(req.image_paths or []),
            "model": profile.model,
            "model_timeout_seconds": profile.timeout_seconds,
        },
    )
    session.commit()
    return {
        "task_id": task.id,
        "poll_timeout_seconds": poll_timeout_seconds(profile.timeout_seconds),
        "poll_interval_ms": 2000,
        "audit_target_id": target_id,
    }

@router.post("/generate-answer-direct")
def generate_answer_direct(
    req: GenerateAnswerRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan == "free":
            raise HTTPException(status_code=403, detail="此功能需要 Plus 或 Pro 套餐")

    if req.submission_id:
        submission = session.get(Submission, req.submission_id)
        if not submission or submission.experiment_id != req.experiment_id:
            raise HTTPException(status_code=404, detail="Submission not found")
        if current_user.role == "student" and submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden")

    target_id = audit_target_id(req.experiment_id, req.submission_id)
    task = generate_answer_task.delay(
        req.experiment_id, 
        req.questions, 
        req.current_form_values, 
        current_user.id,
        req.submission_id,
    )
    profile = get_ai_provider(session).get_profile(AI_TASK_ANSWER_GENERATION)
    start_ai_task_run(
        session,
        task_id=task.id,
        user_id=current_user.id,
        task_kind="answer_generation",
        target_id=target_id,
        experiment_id=req.experiment_id,
        submission_id=req.submission_id,
        details={
            "experiment_id": req.experiment_id,
            "submission_id": req.submission_id,
            "question_count": len(req.questions or []),
            "model": profile.model,
            "model_timeout_seconds": profile.timeout_seconds,
        },
    )
    session.commit()
    return {
        "task_id": task.id,
        "poll_timeout_seconds": poll_timeout_seconds(profile.timeout_seconds),
        "poll_interval_ms": 2000,
        "audit_target_id": target_id,
    }

@router.post("/fixed-fill/{experiment_id}")
def get_fixed_fill_direct(
    experiment_id: str,
    req: Optional[FixedFillRequest] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = current_user.capabilities.get("plan", "free")
        if plan in ["free", "plus"]:
            raise HTTPException(status_code=403, detail="此功能需要 Pro 套餐")

    submission_id = req.submission_id if req else None
    if submission_id:
        submission = session.get(Submission, submission_id)
        if not submission or submission.experiment_id != experiment_id:
            raise HTTPException(status_code=404, detail="Submission not found")
        if current_user.role == "student" and submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden")

    target_id = audit_target_id(experiment_id, submission_id)
    task = fixed_fill_task.delay(experiment_id, current_user.id, submission_id)
    start_ai_task_run(
        session,
        task_id=task.id,
        user_id=current_user.id,
        task_kind="fixed_fill",
        target_id=target_id,
        experiment_id=experiment_id,
        submission_id=submission_id,
        details={
            "experiment_id": experiment_id,
            "submission_id": submission_id,
        },
    )
    session.commit()
    return {
        "task_id": task.id,
        "poll_timeout_seconds": 60,
        "poll_interval_ms": 1000,
        "audit_target_id": target_id,
    }

@router.get("/task/{task_id}")
def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    task_result = celery_app.AsyncResult(task_id)
    
    if task_result.state == 'SUCCESS':
        return {"status": "done", "result": task_result.result}
    if task_result.state == 'FAILURE':
        # 失败状态，普通用户返回简化信息，管理员返回完整 trace
        raw_error_msg = str(task_result.info)
        error_msg = raw_error_msg
        if current_user.role not in ["admin", "reviewer"]:
            error_msg = "处理失败，请稍后重试"
        return {"status": "error", "message": error_msg}
    return {"status": "pending", "state": task_result.state}

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
    config = ensure_ai_config(session)
    session.commit()
    session.refresh(config)
    return {
        "source": "database",
        "provider": config.provider,
        "api_key_configured": bool(settings.AI_API_KEY),
        "base_url": config.base_url,
        "default_model": config.default_model,
        "default_timeout_seconds": config.default_timeout_seconds,
        "default_temperature": config.default_temperature,
        "default_max_images_per_task": config.default_max_images_per_task,
        "auto_recognize": config.auto_recognize,
        "image_recognition_model": config.image_recognition_model,
        "image_recognition_timeout_seconds": config.image_recognition_timeout_seconds,
        "image_recognition_temperature": config.image_recognition_temperature,
        "image_recognition_max_images_per_task": config.image_recognition_max_images_per_task,
        "answer_generation_model": config.answer_generation_model,
        "answer_generation_timeout_seconds": config.answer_generation_timeout_seconds,
        "answer_generation_temperature": config.answer_generation_temperature,
        "captcha_model": config.captcha_model,
        "captcha_timeout_seconds": config.captcha_timeout_seconds,
        "captcha_temperature": config.captcha_temperature,
        "captcha_prompt": config.captcha_prompt,
    }


@router.put("/admin/config")
def update_ai_config(
    req: AiConfigUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
):
    if req.provider != "openai_compatible":
        raise HTTPException(status_code=422, detail="Only openai_compatible provider is supported.")

    config = session.get(AiConfig, 1) or AiConfig(id=1)
    for field, value in req.model_dump().items():
        setattr(config, field, value)
    config.updated_at = get_utc_now()
    config.updated_by = current_user.id
    session.add(config)
    session.flush()
    session.add(
        AuditLog(
            user_id=current_user.id,
            action="ai_config_updated",
            status="success",
            target_id=str(config.id),
            details="Updated non-secret AI runtime configuration.",
        )
    )
    session.commit()
    return get_ai_config(session=session, current_user=current_user)


@router.post("/admin/test-connection", response_model=AiConnectionTestResponse)
async def test_ai_connection(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
):
    profile = None
    try:
        provider = get_ai_provider(session)
        profile = provider.get_profile(AI_TASK_ANSWER_GENERATION)
        response = await provider.chat_completion(
            task=AI_TASK_ANSWER_GENERATION,
            messages=[{"role": "user", "content": "hello"}],
        )
        output = response.choices[0].message.content or ""
        return AiConnectionTestResponse(
            ok=True,
            output=output,
            model=profile.model,
            base_url=profile.base_url,
        )
    except Exception as exc:
        if isinstance(exc, AiProviderConfigError) and "AI API key" in str(exc):
            error_code = "missing_api_key"
            error = "缺少 AI_API_KEY：请在 .env 中填写 AI_API_KEY，然后重启后端进程。"
        elif isinstance(exc, AiProviderConfigError):
            error_code = "invalid_ai_config"
            error = str(exc)
        else:
            status_code = getattr(exc, "status_code", None)
            error_code = "provider_request_failed"
            error = f"AI 服务请求失败{f'（HTTP {status_code}）' if status_code else ''}：{str(exc)}"
        return AiConnectionTestResponse(
            ok=False,
            error=error,
            error_code=error_code,
            model=profile.model if profile else None,
            base_url=profile.base_url if profile else None,
        )

@router.get("/admin/prompts/{experiment_id}", response_model=AiPromptTemplateResponse)
def get_prompt_template(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    from services.experimentConfigStore import get_experiment_config

    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        raise HTTPException(status_code=404, detail="Experiment configuration not found")

    template = session.get(AiPromptTemplate, experiment_id)
    return AiPromptTemplateResponse(
        recognition_system_prompt=(
            template.recognition_system_prompt
            if template and template.recognition_system_prompt
            else DEFAULT_RECOGNITION_SYSTEM
        ),
        recognition_extra_prompt=((exp_config.get("ai") or {}).get("recognition") or {}).get("extraPrompt") or "",
        generation_system_prompt=(
            template.generation_system_prompt
            if template and template.generation_system_prompt
            else DEFAULT_GENERATION_SYSTEM
        ),
        generation_extra_prompt=((exp_config.get("ai") or {}).get("generation") or {}).get("extraPrompt") or "",
    )

@router.put("/admin/prompts/{experiment_id}")
def update_prompt_template(
    experiment_id: str,
    req: AiPromptUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin)
):
    from api.v1.experiments import (
        CONFIG_DIR,
        experiment_config_file_path,
        read_experiment_config_from_file,
        save_experiment_config_to_file_and_db,
    )
    from models.core import Experiment
    import json

    experiment = session.get(Experiment, experiment_id)
    if not experiment or not experiment.config_json:
        raise HTTPException(status_code=404, detail="Experiment not found")

    template = session.get(AiPromptTemplate, experiment_id)
    if not template:
        template = AiPromptTemplate(experiment_id=experiment_id)
        
    template.recognition_system_prompt = req.recognition_system_prompt
    template.generation_system_prompt = req.generation_system_prompt
    template.updated_at = datetime.utcnow()

    config_path = experiment_config_file_path(experiment_id)
    config_json = read_experiment_config_from_file(experiment_id) or experiment.config_json
    ai_config = config_json.setdefault("ai", {})
    recognition_config = ai_config.setdefault("recognition", {})
    generation_config = ai_config.setdefault("generation", {})
    if req.recognition_extra_prompt is not None:
        recognition_config["extraPrompt"] = req.recognition_extra_prompt
    if req.generation_extra_prompt is not None:
        generation_config["extraPrompt"] = req.generation_extra_prompt

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    save_result = save_experiment_config_to_file_and_db(experiment, config_json, config_path)

    log = AuditLog(
        user_id=current_user.id,
        action="update_experiment_prompt",
        status="success",
        target_id=experiment_id,
        details=json.dumps({
            "experiment_id": experiment_id,
            "updated": [
                "recognition_system_prompt",
                "generation_system_prompt",
                "ai.recognition.extraPrompt",
                "ai.generation.extraPrompt",
            ],
            "old_hash": save_result["old_hash"],
            "new_hash": save_result["new_hash"],
            "changed": save_result["changed"],
        }, ensure_ascii=False),
    )

    session.add(template)
    session.add(log)
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

    preview_config = dict(exp_config)
    preview_config["ai"] = dict(exp_config.get("ai") or {})
    preview_config["ai"]["recognition"] = dict(preview_config["ai"].get("recognition") or {})
    preview_config["ai"]["generation"] = dict(preview_config["ai"].get("generation") or {})
    if req.recognition_extra_prompt is not None:
        preview_config["ai"]["recognition"]["extraPrompt"] = req.recognition_extra_prompt
    if req.generation_extra_prompt is not None:
        preview_config["ai"]["generation"]["extraPrompt"] = req.generation_extra_prompt
        
    # Use the requested values as a temporary template for preview
    db_template = AiPromptTemplate(
        experiment_id=experiment_id,
        recognition_system_prompt=req.recognition_system_prompt,
        generation_system_prompt=req.generation_system_prompt,
    )
    
    recognition_node_ids = collect_ai_recognition_node_ids(preview_config)
                        
    recognition_prompt = build_recognition_prompt(preview_config, recognition_node_ids, db_template)
    
    # Mock data for generation preview
    mock_form_values = {}
    for nid in recognition_node_ids:
        mock_form_values[nid] = "【填入的数据】"
    for nid in preview_config.get("ai", {}).get("generation", {}).get("dataNodes") or []:
        if isinstance(nid, str) and nid.strip():
            mock_form_values[nid.strip()] = "【配置节点数据】"
        
    questions = [
        {
            "index": idx + 1,
            "nodeId": q.get("nodeId"),
            "title": q.get("title") or "",
        }
        for idx, q in enumerate(preview_config.get("ui", {}).get("questions", []))
        if q.get("nodeId")
    ]
    generation_prompt = build_generation_answers_prompt(questions, mock_form_values, preview_config, db_template)
    
    return PreviewPromptResponse(
        recognition_prompt=recognition_prompt,
        generation_prompt=generation_prompt
    )
