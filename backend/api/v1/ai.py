from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Any, List, Optional
from pydantic import BaseModel
from core.db import get_session
from models.core import AuditLog, AiConfig, AiTaskRun, Experiment, User, AiPromptTemplate, Submission, get_utc_now
from api.deps import get_current_user, get_current_reviewer_or_admin, get_current_admin
from worker.ai_tasks import (
    recognize_images_task,
    generate_answer_task,
    fixed_fill_task,
    recognize_submission_task,
    auto_match_experiment_images_task,
)
from worker.celery_app import celery_app
from core.config import settings
from datetime import datetime
from services.ai_provider import (
    AI_TASK_ANSWER_GENERATION,
    AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
    AI_TASK_IMAGE_RECOGNITION,
    AI_TASK_IMAGE_RECOGNITION_RETRY,
    AI_TASK_CAPTCHA,
    AiProviderConfigError,
    DEFAULT_CAPTCHA_OVERRIDE,
    DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE,
    DEFAULT_IMAGE_RECOGNITION_RETRY_OVERRIDE,
    ensure_ai_config,
    get_ai_provider,
)
from services.ai_task_audit import audit_target_id, next_image_recognition_attempt, poll_timeout_seconds, start_ai_task_run
from core.ai_prompts import DEFAULT_GENERATION_SYSTEM, DEFAULT_RECOGNITION_SYSTEM
from core.plan_capabilities import can_use_fixed_fill, can_use_image_recognition, user_plan

router = APIRouter()

class RecognizeDirectRequest(BaseModel):
    experiment_id: str
    image_paths: List[str]
    submission_id: Optional[str] = None
    image_ref: Optional[str] = None

class GenerateAnswerRequest(BaseModel):
    experiment_id: str
    questions: List[dict]
    current_form_values: dict
    submission_id: Optional[str] = None


class FixedFillRequest(BaseModel):
    submission_id: Optional[str] = None


class ImageAssignmentImage(BaseModel):
    index: int
    url: str
    name: Optional[str] = None


class ImageAssignmentRequest(BaseModel):
    images: List[ImageAssignmentImage]
    experiment_ids: List[str] = []


class AiConfigUpdate(BaseModel):
    provider: str = "openai_compatible"
    base_url: str
    default_model: str
    default_timeout_seconds: int = 60
    default_temperature: float = 0.7
    default_max_images_per_task: int = 8
    auto_recognize: bool = False
    image_recognition_model: str
    image_recognition_retry_enabled: bool = False
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
    task_overrides_json: Optional[dict] = None


class AiTaskOverridesUpdate(BaseModel):
    task_overrides_json: dict


class AiPromptUpdate(BaseModel):
    recognition_system_prompt: Optional[str] = None
    recognition_extra_prompt: Optional[str] = None
    generation_system_prompt: Optional[str] = None
    generation_extra_prompt: Optional[str] = None


class PreviewPromptResponse(BaseModel):
    recognition_prompt: str
    generation_prompt: str


class ImageAssignmentPreviewResponse(BaseModel):
    prompt: str
    candidates: List[dict]
    candidate_map: dict


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


def _default_task_overrides_json() -> dict:
    return {
        AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH: dict(DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE),
        AI_TASK_IMAGE_RECOGNITION_RETRY: dict(DEFAULT_IMAGE_RECOGNITION_RETRY_OVERRIDE),
        AI_TASK_CAPTCHA: dict(DEFAULT_CAPTCHA_OVERRIDE),
    }


def _merged_task_overrides_json(config: AiConfig) -> dict:
    current = config.task_overrides_json if isinstance(config.task_overrides_json, dict) else {}
    merged = _default_task_overrides_json()
    for key, value in current.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **value}
        else:
            merged[key] = value
    return merged


def _validate_task_overrides_json(payload: dict) -> dict:
    if not isinstance(payload, dict) or isinstance(payload, list):
        raise HTTPException(status_code=422, detail="task_overrides_json must be a JSON object.")

    def validate_override(task_key: str, label: str):
        config = payload.get(task_key)
        if config is None:
            return
        if not isinstance(config, dict):
            raise HTTPException(status_code=422, detail=f"{task_key} must be a JSON object.")
        if config.get("enabled") is not True:
            return
        required_fields = ["base_url", "api_key", "model"]
        missing = [field for field in required_fields if not str(config.get(field) or "").strip()]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"{label} AI 配置无效，缺少字段：{', '.join(missing)}",
            )
        provider = str(config.get("provider") or "openai_compatible").strip()
        if provider != "openai_compatible":
            raise HTTPException(status_code=422, detail=f"{label}专用配置仅支持 openai_compatible。")
        try:
            concurrency = int(config.get("concurrency") or 3)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"{label} concurrency 必须是正整数。")
        if concurrency < 1 or concurrency > 10:
            raise HTTPException(status_code=422, detail=f"{label} concurrency 必须在 1 到 10 之间。")

    validate_override(AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH, "融合图片匹配")
    validate_override(AI_TASK_IMAGE_RECOGNITION_RETRY, "重复识别备用模型")
    validate_override(AI_TASK_CAPTCHA, "验证码识别")
    return payload


@router.post("/recognize-direct")
def recognize_direct(
    req: RecognizeDirectRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student" and not can_use_image_recognition(current_user):
        raise HTTPException(status_code=403, detail="此功能需要 Plus 或 Pro 套餐")

    if req.submission_id:
        submission = session.get(Submission, req.submission_id)
        if not submission or submission.experiment_id != req.experiment_id:
            raise HTTPException(status_code=404, detail="Submission not found")
        if current_user.role == "student" and submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden")

    target_id = audit_target_id(req.experiment_id, req.submission_id)
    recognition_attempt = next_image_recognition_attempt(session, req.submission_id)
    profile = get_ai_provider(session).get_profile(
        AI_TASK_IMAGE_RECOGNITION,
        recognition_attempt=recognition_attempt,
    )
    recognition_node_ids = None
    recognition_extra_prompt = None
    if req.image_ref:
        from services.experimentConfigStore import get_experiment_config, find_ai_recognition_group
        exp_config = get_experiment_config(req.experiment_id)
        group = find_ai_recognition_group(exp_config or {}, req.image_ref)
        if not group:
            raise HTTPException(status_code=400, detail=f"Unknown recognition image_ref: {req.image_ref}")
        recognition_node_ids = group.get("nodeIds") or []
        recognition_extra_prompt = group.get("extraPrompt", "")

    task_args = [
        req.experiment_id,
        req.image_paths,
        current_user.id,
        req.submission_id,
        recognition_attempt,
    ]
    if recognition_node_ids is not None or recognition_extra_prompt is not None:
        task_args.extend([recognition_node_ids, recognition_extra_prompt])
    task = recognize_images_task.delay(*task_args)
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
            "recognition_attempt": recognition_attempt,
            "image_ref": req.image_ref,
            "recognition_node_ids": recognition_node_ids,
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
        "recognition_attempt": recognition_attempt,
        "model": profile.model,
    }

@router.post("/generate-answer-direct")
def generate_answer_direct(
    req: GenerateAnswerRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        plan = user_plan(current_user)
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
    if current_user.role == "student" and not can_use_fixed_fill(current_user):
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
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    task_run = session.get(AiTaskRun, task_id)
    if not task_run:
        if current_user.role not in ["admin", "reviewer"]:
            raise HTTPException(status_code=404, detail="Task not found")
    elif current_user.role == "student" and task_run.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

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
    if task_result.state == 'PROGRESS':
        meta = task_result.info if isinstance(task_result.info, dict) else {}
        return {
            "status": "progress",
            "state": task_result.state,
            **meta,
        }
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


def _image_assignment_experiments(
    session: Session,
    current_user: User,
    experiment_ids: Optional[List[str]] = None,
) -> List[Experiment]:
    from api.v1.experiments import experiment_visible_to_user

    statement = select(Experiment).where(Experiment.id != "UPGRADE_PLAN")
    target_ids = [
        str(item).strip()
        for item in (experiment_ids or [])
        if str(item or "").strip()
    ]
    if target_ids:
        statement = statement.where(Experiment.id.in_(target_ids))
    experiments = session.exec(statement).all()
    return [
        experiment
        for experiment in experiments
        if experiment.config_json and experiment_visible_to_user(experiment, current_user)
    ]


@router.post("/experiment-image-auto-match-task")
def auto_match_experiment_images_task_endpoint(
    req: ImageAssignmentRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    from core.image_assignment_prompts import build_image_assignment_candidates

    images = [item.model_dump() for item in req.images]
    if not images:
        raise HTTPException(status_code=400, detail="请先上传需要匹配的图片。")
    experiments = _image_assignment_experiments(session, current_user, req.experiment_ids)
    candidates, candidate_map = build_image_assignment_candidates(experiments)
    if not candidates:
        raise HTTPException(status_code=400, detail="当前没有可匹配的实验图片槽。")

    profile = get_ai_provider(session).get_profile(
        AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
        recognition_attempt=1,
    )
    task = auto_match_experiment_images_task.delay(
        images,
        candidates,
        candidate_map,
        current_user.id,
    )
    start_ai_task_run(
        session,
        task_id=task.id,
        user_id=current_user.id,
        task_kind="experiment_image_auto_match",
        target_id="experiment_image_auto_match",
        details={
            "image_count": len(images),
            "experiment_ids": req.experiment_ids,
            "candidate_experiment_count": len(candidates),
            "candidate_slot_count": sum(len(item.get("slots") or []) for item in candidates),
            "model": profile.model,
            "model_timeout_seconds": profile.timeout_seconds,
        },
    )
    session.commit()
    return {
        "task_id": task.id,
        "poll_timeout_seconds": poll_timeout_seconds(profile.timeout_seconds),
        "poll_interval_ms": 2000,
        "audit_target_id": "experiment_image_auto_match",
        "model": profile.model,
    }

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
        "image_recognition_retry_enabled": config.image_recognition_retry_enabled,
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
        "task_overrides_json": _merged_task_overrides_json(config),
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
    payload = req.model_dump()
    payload.pop("task_overrides_json", None)
    for field, value in payload.items():
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


@router.put("/admin/task-overrides")
def update_ai_task_overrides(
    req: AiTaskOverridesUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
):
    config = ensure_ai_config(session)
    payload = _validate_task_overrides_json(req.task_overrides_json)
    config.task_overrides_json = payload
    config.updated_at = get_utc_now()
    config.updated_by = current_user.id
    session.add(config)
    session.add(AuditLog(
        user_id=current_user.id,
        action="ai_task_overrides_updated",
        status="success",
        target_id=str(config.id),
        details="Updated admin-only AI task override JSON.",
    ))
    session.commit()
    session.refresh(config)
    return {
        "task_overrides_json": _merged_task_overrides_json(config),
    }


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


@router.get("/admin/experiment-image-auto-match/preview", response_model=ImageAssignmentPreviewResponse)
def preview_experiment_image_auto_match_prompt(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
):
    from core.image_assignment_prompts import build_image_assignment_candidates, build_image_assignment_prompt

    experiments = _image_assignment_experiments(session, current_user)
    candidates, candidate_map = build_image_assignment_candidates(experiments)
    prompt = build_image_assignment_prompt(candidates, image_count=3)
    return ImageAssignmentPreviewResponse(
        prompt=prompt,
        candidates=candidates,
        candidate_map=candidate_map,
    )
