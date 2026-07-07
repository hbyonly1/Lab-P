import asyncio
from celery.signals import task_failure
from worker.celery_app import celery_app
from sqlmodel import Session
from core.db import engine
from models.core import AuditLog, Submission, get_utc_now
from services import ai_service, captcha_ai
from services.ai_provider import AI_TASK_IMAGE_RECOGNITION, get_ai_provider
from services.ai_task_audit import complete_ai_task_run, fail_ai_task_run, audit_target_id, next_image_recognition_attempt


def _extract_assigned_image_paths(submission: Submission, exp_config: dict) -> list[str]:
    recognition_config = ((exp_config or {}).get("ai") or {}).get("recognition") or {}
    recognition_image_ref = recognition_config.get("imageRef")
    image_slots = submission.image_slots or {}

    candidates = []
    if recognition_image_ref:
        candidates = image_slots.get(recognition_image_ref) or []
    elif len(image_slots) == 1:
        candidates = next(iter(image_slots.values())) or []

    image_paths = []
    for item in candidates:
        if isinstance(item, str) and item.strip():
            image_paths.append(item.strip())
        elif isinstance(item, dict):
            value = str(item.get("url") or item.get("path") or "").strip()
            if value:
                image_paths.append(value)
    return image_paths


def _questions_for_generation(exp_config: dict) -> list[dict]:
    image_field_ids = {
        field.get("id")
        for field in (exp_config.get("inputs") or {}).get("fields", [])
        if field.get("type") == "image_upload" and field.get("id")
    }
    questions = []
    for idx, question in enumerate((exp_config.get("ui") or {}).get("questions", [])):
        node_id = question.get("nodeId")
        if not node_id or node_id in image_field_ids:
            continue
        questions.append({
            "index": idx + 1,
            "nodeId": node_id,
            "title": question.get("title"),
        })
    return questions


@task_failure.connect
def record_ai_task_failure(task_id=None, exception=None, **_kwargs):
    if not task_id:
        return
    with Session(engine) as session:
        run = fail_ai_task_run(
            session,
            task_id=task_id,
            details={
                "task_id": task_id,
                "error": str(exception),
                "error_type": type(exception).__name__ if exception else None,
                "source": "celery_task_failure_signal",
            },
        )
        if run:
            session.commit()

@celery_app.task(bind=True, max_retries=3)
def recognize_captcha_task(self, image_b64: str, config: dict):
    """学校登录验证码识别。所有验证码 AI 调用统一在 worker 内执行。"""
    return captcha_ai.recognize_captcha_image_b64(image_b64, config or {})

@celery_app.task(bind=True, max_retries=3)
def recognize_images_task(
    self,
    experiment_id: str,
    image_paths: list[str],
    user_id: int,
    submission_id: str = None,
    recognition_attempt: int = 1,
):
    """detail 页一键识别按鈕触发。结果存 Celery result backend。"""
    with Session(engine) as session:
        target_id = audit_target_id(experiment_id, submission_id)
        try:
            profile = get_ai_provider(session).get_profile(
                AI_TASK_IMAGE_RECOGNITION,
                recognition_attempt=recognition_attempt,
            )
            result = asyncio.run(ai_service.recognize_images(
                experiment_id,
                image_paths,
                session,
                recognition_attempt=recognition_attempt,
            ))
            complete_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "recognition_attempt": recognition_attempt,
                    "model": profile.model,
                    "recognized_count": len(result or {}),
                    "image_count": len(image_paths or []),
                },
            )
            session.commit()
            return result
        except Exception as e:
            fail_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "error": str(e),
                    "error_type": type(e).__name__,
                },
                fallback_user_id=user_id,
                fallback_task_kind="image_recognition",
                fallback_target_id=target_id,
            )
            session.commit()
            raise e

@celery_app.task(bind=True, max_retries=3)
def generate_answer_task(self, experiment_id: str, questions: list[dict], form_values: dict, user_id: int, submission_id: str = None):
    """detail 页统一生成全部实验问题回答按钮触发。"""
    with Session(engine) as session:
        target_id = audit_target_id(experiment_id, submission_id)
        try:
            answers = asyncio.run(ai_service.generate_answers(
                experiment_id, questions, form_values, session
            ))
            complete_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "answer_count": len(answers or []),
                },
            )
            session.commit()
            return {"answers": answers}
        except Exception as e:
            fail_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "error": str(e),
                    "error_type": type(e).__name__,
                },
                fallback_user_id=user_id,
                fallback_task_kind="answer_generation",
                fallback_target_id=target_id,
            )
            session.commit()
            raise e

@celery_app.task(bind=True, max_retries=3)  
def fixed_fill_task(self, experiment_id: str, user_id: int, submission_id: str = None):
    """detail 页一键填空按鈕触发。"""
    target_id = audit_target_id(experiment_id, submission_id)
    try:
        result = asyncio.run(ai_service.get_fixed_fill(experiment_id))
        with Session(engine) as session:
            complete_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "field_count": len(result or {}),
                },
            )
            session.commit()
        return result
    except Exception as e:
        with Session(engine) as session:
            fail_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "experiment_id": experiment_id,
                    "submission_id": submission_id,
                    "error": str(e),
                    "error_type": type(e).__name__,
                },
                fallback_user_id=user_id,
                fallback_task_kind="fixed_fill",
                fallback_target_id=target_id,
            )
            session.commit()
        raise e

@celery_app.task(bind=True, max_retries=3)
def recognize_submission_task(self, submission_id: str, user_id: int):
    """任务列表 [🤖识别] 按鈕触发，结果写入 submission.recognition_json。"""
    with Session(engine) as session:
        submission = session.get(Submission, submission_id)
        if not submission:
            raise ValueError("Submission not found")
            
        try:
            recognition_attempt = next_image_recognition_attempt(session, submission_id)
            result = asyncio.run(ai_service.recognize_images(
                submission.experiment_id, 
                submission.image_paths, 
                session,
                recognition_attempt=recognition_attempt,
            ))
            
            # 同时生成答案
            answers = {}
            # 从配置中读需要回答的问题
            from services.experimentConfigStore import get_experiment_config
            exp_config = get_experiment_config(submission.experiment_id)
            if exp_config:
                questions = [
                    {"index": idx + 1, "nodeId": q.get("nodeId"), "title": q.get("title")}
                    for idx, q in enumerate(exp_config.get("ui", {}).get("questions", []))
                    if q.get("nodeId")
                ]
                generated_answers = asyncio.run(ai_service.generate_answers(
                    submission.experiment_id,
                    questions,
                    result,
                    session
                ))
                answers = {
                    item["nodeId"]: item["answer"]
                    for item in generated_answers
                    if item.get("nodeId")
                }
                    
            final_result = {**result, **answers}
            submission.recognition_json = final_result
            submission.status = "reviewing"
            
            log = AuditLog(
                user_id=user_id,
                action="ai_submission",
                status="success",
                target_id=submission_id,
                details=f"识别完成：第 {recognition_attempt} 次识别。",
            )
            session.add(submission)
            session.add(log)
            session.commit()
            return {"status": "success"}
        except Exception as e:
            submission.status = "error"
            log = AuditLog(user_id=user_id, action="ai_submission", status="failed",
                           target_id=submission_id, details=str(e))
            session.add(submission)
            session.add(log)
            session.commit()
            raise e


@celery_app.task(bind=True, max_retries=3)
def prepare_submission_for_review_task(self, submission_id: str, user_id: int):
    """审核预处理：复用一键填空、图片识别、生成回答，并写回 submission。"""
    from services.experimentConfigStore import get_experiment_config

    with Session(engine) as session:
        submission = session.get(Submission, submission_id)
        if not submission:
            raise ValueError("Submission not found")

        exp_config = get_experiment_config(submission.experiment_id)
        if not exp_config:
            submission.status = "error"
            submission.preprocess_status = "failed"
            submission.preprocess_error = f"Experiment {submission.experiment_id} not found"
            submission.updated_at = get_utc_now()
            session.add(submission)
            session.commit()
            raise ValueError(submission.preprocess_error)

        try:
            image_paths = _extract_assigned_image_paths(submission, exp_config)
            if not image_paths:
                submission.status = "pending_image_assignment"
                submission.preprocess_status = "image_assignment_required"
                submission.preprocess_error = "请先把学生上传图片归位到实验配置的识别图片槽。"
                submission.updated_at = get_utc_now()
                session.add(submission)
                session.add(AuditLog(
                    user_id=user_id,
                    action="submission_prepare_review",
                    status="failed",
                    target_id=submission_id,
                    details=submission.preprocess_error,
                ))
                session.commit()
                return {"status": "image_assignment_required"}

            submission.status = "preparing_review"
            submission.preprocess_status = "running"
            submission.preprocess_error = None
            submission.updated_at = get_utc_now()
            session.add(submission)
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review_running",
                status="success",
                target_id=submission_id,
                details=f"审核预处理任务已开始执行，Celery task_id={self.request.id}",
            ))
            session.commit()

            current_step = "固定填空"
            fixed_values = asyncio.run(ai_service.get_fixed_fill(submission.experiment_id))
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review_fixed_fill",
                status="success",
                target_id=submission_id,
                details=f"固定填空完成：{len(fixed_values or {})} 项。",
            ))
            session.commit()

            current_step = "AI 图片识别"
            recognition_attempt = next_image_recognition_attempt(session, submission_id)
            profile = get_ai_provider(session).get_profile(
                AI_TASK_IMAGE_RECOGNITION,
                recognition_attempt=recognition_attempt,
            )
            recognized_values = asyncio.run(ai_service.recognize_images(
                submission.experiment_id,
                image_paths,
                session,
                recognition_attempt=recognition_attempt,
            ))
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review_ai_recognize",
                status="success",
                target_id=submission_id,
                details=f"AI 图片识别完成：第 {recognition_attempt} 次识别，模型 {profile.model}，识别 {len(recognized_values or {})} 项，图片 {len(image_paths)} 张。",
            ))
            session.commit()

            working_values = {
                **(fixed_values or {}),
                **(recognized_values or {}),
            }
            current_step = "AI 回答生成"
            generated_answers = asyncio.run(ai_service.generate_answers(
                submission.experiment_id,
                _questions_for_generation(exp_config),
                working_values,
                session,
            ))
            answers = {
                item["nodeId"]: item["answer"]
                for item in generated_answers
                if item.get("nodeId")
            }
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review_generate_answers",
                status="success",
                target_id=submission_id,
                details=f"AI 回答生成完成：生成 {len(answers)} 项。",
            ))
            session.commit()

            final_result = {**working_values, **answers}
            submission.recognition_json = final_result
            submission.corrected_json = submission.corrected_json or {}
            submission.status = "reviewing"
            submission.preprocess_status = "done"
            submission.preprocess_error = None
            submission.updated_at = get_utc_now()

            session.add(submission)
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review",
                status="success",
                target_id=submission_id,
                details=f"预处理完成：固定填空 {len(fixed_values or {})} 项，识别 {len(recognized_values or {})} 项，生成回答 {len(answers)} 项。",
            ))
            session.commit()
            return {"status": "success", "fields": len(final_result)}
        except Exception as e:
            submission.status = "error"
            submission.preprocess_status = "failed"
            submission.preprocess_error = str(e)
            submission.updated_at = get_utc_now()
            session.add(submission)
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review",
                status="failed",
                target_id=submission_id,
                details=f"{locals().get('current_step', '预处理')}失败：{str(e)}",
            ))
            session.commit()
            raise e
