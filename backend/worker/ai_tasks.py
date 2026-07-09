import asyncio
import json
from pathlib import Path
from typing import List, Optional
from celery.signals import task_failure
from worker.celery_app import celery_app
from sqlmodel import Session, select
from core.db import engine
from models.core import AuditLog, AutomationEngineConfig, Submission, get_utc_now
from services import ai_service, captcha_ai
from services.ai_provider import AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH, AI_TASK_IMAGE_RECOGNITION, get_ai_provider
from services.ai_task_audit import complete_ai_task_run, fail_ai_task_run, audit_target_id, next_image_recognition_attempt
from services.formula_compute import FormulaComputeError, compute_formula_values

IMAGE_AUTO_MATCH_BATCH_SIZE = 5
BACKEND_ROOT = Path(__file__).resolve().parents[1]
IMAGE_AUTO_MATCH_ARTIFACT_ROOT = BACKEND_ROOT / "tmp" / "ai_image_auto_match"


def _image_paths_from_slot_items(items: list) -> list[str]:
    image_paths = []
    for item in items or []:
        if isinstance(item, str) and item.strip():
            image_paths.append(item.strip())
        elif isinstance(item, dict):
            value = str(item.get("url") or item.get("path") or "").strip()
            if value:
                image_paths.append(value)
    return image_paths


def _extract_group_image_paths(submission: Submission, image_ref: str) -> list[str]:
    image_slots = submission.image_slots or {}
    return _image_paths_from_slot_items(image_slots.get(image_ref) or [])


def _extract_assigned_image_paths(submission: Submission, exp_config: dict) -> list[str]:
    recognition_config = ((exp_config or {}).get("ai") or {}).get("recognition") or {}
    recognition_image_ref = recognition_config.get("imageRef")
    image_slots = submission.image_slots or {}

    if recognition_image_ref:
        return _extract_group_image_paths(submission, recognition_image_ref)
    if len(image_slots) == 1:
        return _image_paths_from_slot_items(next(iter(image_slots.values())) or [])
    return []


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


def _preprocess_auto_compute_enabled(session: Session) -> bool:
    record = session.exec(
        select(AutomationEngineConfig)
        .where(AutomationEngineConfig.is_active == True)  # noqa: E712
        .order_by(AutomationEngineConfig.updated_at.desc())
    ).first()
    config = record.config_json if record else {}
    return (((config or {}).get("oneClick") or {}).get("preprocessAutoComputeEnabled") is True)


def _chunks(items: list, size: int) -> list[list]:
    if size <= 0:
        return [items]
    return [items[index:index + size] for index in range(0, len(items), size)]


def _write_json_artifact(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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
    recognition_node_ids: Optional[List[str]] = None,
    recognition_extra_prompt: Optional[str] = None,
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
                recognition_node_ids=recognition_node_ids,
                recognition_extra_prompt=recognition_extra_prompt,
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
            session.rollback()
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
            session.rollback()
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


@celery_app.task(bind=True, max_retries=2)
def auto_match_experiment_images_task(
    self,
    image_items: list[dict],
    candidates: list[dict],
    candidate_map: dict,
    user_id: int,
):
    """一键提交融合上传图片预匹配。结果存 Celery result backend。"""
    with Session(engine) as session:
        target_id = "experiment_image_auto_match"
        artifact_path = IMAGE_AUTO_MATCH_ARTIFACT_ROOT / str(self.request.id) / "debug_payload.json"
        workspace_artifact_path = Path("backend") / "tmp" / "ai_image_auto_match" / str(self.request.id) / "debug_payload.json"
        debug_artifact = {
            "task_id": self.request.id,
            "user_id": user_id,
            "container_artifact_path": str(artifact_path),
            "workspace_artifact_path": str(workspace_artifact_path),
            "image_count": len(image_items or []),
            "candidate_experiment_count": len(candidates or []),
            "candidate_slot_count": sum(len(item.get("slots") or []) for item in candidates or []),
            "images": [
                {
                    "index": item.get("index"),
                    "name": item.get("name"),
                    "url": item.get("url"),
                }
                for item in (image_items or [])
            ],
            "candidates": candidates,
            "candidate_map": candidate_map,
            "batches": [],
        }
        try:
            profile = get_ai_provider(session).get_profile(
                AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
                recognition_attempt=1,
            )
            single_image_jobs = [[item] for item in (image_items or [])]
            total_jobs = max(1, len(single_image_jobs))
            concurrency = max(1, int(getattr(profile, "concurrency", 3) or 3))
            debug_artifact.update({
                "model": profile.model,
                "base_url": profile.base_url,
                "temperature": profile.temperature,
                "timeout_seconds": profile.timeout_seconds,
                "task": profile.task,
                "response_format": {"type": "json_object"},
                "batch_size": 1,
                "concurrency": concurrency,
                "request_count": total_jobs,
            })
            all_matches = []
            unmatched_by_index = {}
            self.update_state(
                state="PROGRESS",
                meta={
                    "current_batch": 0,
                    "total_batches": total_jobs,
                    "processed_images": 0,
                    "total_images": len(image_items or []),
                    "percent": 18,
                    "message": f"图片预匹配任务已开始，共 {len(image_items or [])} 张，并发 {concurrency}。",
                },
            )

            async def run_single_image_matches():
                semaphore = asyncio.Semaphore(concurrency)

                async def run_one(job_index: int, batch: list[dict]):
                    batch_debug = {
                        "batch_index": job_index,
                        "total_batches": total_jobs,
                        "images": [
                            {
                                "index": item.get("index"),
                                "name": item.get("name"),
                                "url": item.get("url"),
                            }
                            for item in batch
                        ],
                    }
                    async with semaphore:
                        try:
                            batch_result = await ai_service.auto_match_experiment_images(
                                batch,
                                candidates,
                                session,
                                include_debug=True,
                            )
                            service_debug = batch_result.pop("_debug", None)
                            if service_debug:
                                batch_debug["ai_payload"] = service_debug
                            batch_debug["normalized_matches"] = batch_result.get("matches") or []
                            batch_debug["normalized_unmatched"] = batch_result.get("unmatched") or []
                            return job_index, batch_result, batch_debug
                        except Exception as batch_error:
                            batch_debug["error"] = str(batch_error)
                            service_debug = getattr(batch_error, "debug_payload", None)
                            if service_debug:
                                batch_debug["ai_payload"] = service_debug
                            raise RuntimeError(json.dumps(batch_debug, ensure_ascii=False)) from batch_error

                tasks = [
                    asyncio.create_task(run_one(job_index, batch))
                    for job_index, batch in enumerate(single_image_jobs, start=1)
                ]
                completed = 0
                for task in asyncio.as_completed(tasks):
                    try:
                        job_index, batch_result, batch_debug = await task
                    except Exception as task_error:
                        for pending in tasks:
                            if not pending.done():
                                pending.cancel()
                        error_text = str(task_error)
                        try:
                            batch_debug = json.loads(error_text)
                        except Exception:
                            batch_debug = {"error": error_text}
                        debug_artifact["batches"].append(batch_debug)
                        debug_artifact["status"] = "failed"
                        debug_artifact["error"] = error_text
                        _write_json_artifact(artifact_path, debug_artifact)
                        raise
                    completed += 1
                    debug_artifact["batches"].append(batch_debug)
                    debug_artifact["batches"].sort(key=lambda item: item.get("batch_index") or 0)
                    _write_json_artifact(artifact_path, debug_artifact)
                    all_matches.extend(batch_result.get("matches") or [])
                    for item in batch_result.get("unmatched") or []:
                        try:
                            unmatched_by_index[int(item.get("imageIndex"))] = {"imageIndex": int(item.get("imageIndex"))}
                        except (TypeError, ValueError):
                            continue
                    matched_indexes = {
                        int(item.get("imageIndex"))
                        for item in all_matches
                        if item.get("imageIndex") is not None
                    }
                    for image_index in list(unmatched_by_index.keys()):
                        if image_index in matched_indexes:
                            unmatched_by_index.pop(image_index, None)
                    percent = min(92, 18 + int((completed / total_jobs) * 72))
                    self.update_state(
                        state="PROGRESS",
                        meta={
                            "current_batch": completed,
                            "total_batches": total_jobs,
                            "processed_images": completed,
                            "total_images": len(image_items or []),
                            "percent": percent,
                            "message": f"正在匹配图片，已处理 {completed}/{len(image_items or [])} 张。",
                        },
                    )

            asyncio.run(run_single_image_matches())
            result = {
                "matches": all_matches,
                "unmatched": [
                    unmatched_by_index[index]
                    for index in sorted(unmatched_by_index.keys())
                ],
            }
            debug_artifact["status"] = "success"
            debug_artifact["final_result"] = result
            _write_json_artifact(artifact_path, debug_artifact)
            payload = {
                **(result or {}),
                "candidates": candidates,
                "candidate_map": candidate_map,
            }
            complete_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "image_count": len(image_items or []),
                    "batch_size": 1,
                    "concurrency": concurrency,
                    "batch_count": total_jobs,
                    "candidate_experiment_count": len(candidates or []),
                    "match_count": len((result or {}).get("matches") or []),
                    "unmatched_count": len((result or {}).get("unmatched") or []),
                    "model": profile.model,
                    "debug_artifact": str(artifact_path),
                },
            )
            session.add(AuditLog(
                user_id=user_id,
                action="experiment_image_auto_match",
                status="success",
                target_id=target_id,
                details=json.dumps(debug_artifact, ensure_ascii=False, indent=2),
            ))
            session.commit()
            return payload
        except Exception as e:
            session.rollback()
            if not debug_artifact.get("status"):
                debug_artifact["status"] = "failed"
                debug_artifact["error"] = str(e)
                _write_json_artifact(artifact_path, debug_artifact)
            fail_ai_task_run(
                session,
                task_id=self.request.id,
                details={
                    "image_count": len(image_items or []),
                    "candidate_experiment_count": len(candidates or []),
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "debug_artifact": str(artifact_path),
                },
                fallback_user_id=user_id,
                fallback_task_kind="experiment_image_auto_match",
                fallback_target_id=target_id,
            )
            session.add(AuditLog(
                user_id=user_id,
                action="experiment_image_auto_match",
                status="failed",
                target_id=target_id,
                details=json.dumps(debug_artifact, ensure_ascii=False, indent=2),
            ))
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
            session.rollback()
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
    from services.experimentConfigStore import get_experiment_config, collect_ai_recognition_groups

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
            recognition_groups = collect_ai_recognition_groups(exp_config)
            missing_required_groups = []
            prepared_groups = []
            for group in recognition_groups:
                group_image_paths = _extract_group_image_paths(submission, group.get("imageRef"))
                if not group_image_paths and group.get("required", True):
                    missing_required_groups.append(group.get("imageRef"))
                    continue
                if group_image_paths:
                    prepared_groups.append({**group, "imagePaths": group_image_paths})

            if not prepared_groups or missing_required_groups:
                submission.status = "pending_image_assignment"
                submission.preprocess_status = "image_assignment_required"
                if missing_required_groups:
                    submission.preprocess_error = f"请先把学生上传图片归位到识别图片槽：{', '.join(missing_required_groups)}。"
                else:
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
            recognized_values = {}
            recognized_group_summaries = []
            for group in prepared_groups:
                group_values = asyncio.run(ai_service.recognize_images(
                    submission.experiment_id,
                    group.get("imagePaths") or [],
                    session,
                    recognition_attempt=recognition_attempt,
                    recognition_node_ids=group.get("nodeIds") or [],
                    recognition_extra_prompt=group.get("extraPrompt", ""),
                ))
                recognized_values.update(group_values or {})
                recognized_group_summaries.append(
                    f"{group.get('imageRef')}:{len(group_values or {})}/{len(group.get('imagePaths') or [])}"
                )
            session.add(AuditLog(
                user_id=user_id,
                action="submission_prepare_review_ai_recognize",
                status="success",
                target_id=submission_id,
                details=f"AI 图片识别完成：第 {recognition_attempt} 次识别，模型 {profile.model}，识别 {len(recognized_values or {})} 项，分组 {'; '.join(recognized_group_summaries)}。",
            ))
            session.commit()

            working_values = {
                **(fixed_values or {}),
                **(recognized_values or {}),
            }
            computed_values = {}
            if _preprocess_auto_compute_enabled(session):
                current_step = "一键计算"
                try:
                    computed_values = compute_formula_values(exp_config.get("formulas") or {}, working_values)
                    working_values = computed_values
                    session.add(AuditLog(
                        user_id=user_id,
                        action="submission_prepare_review_formula_compute",
                        status="success",
                        target_id=submission_id,
                        details=f"一键计算完成：当前字段 {len(computed_values or {})} 项。",
                    ))
                    session.commit()
                except FormulaComputeError as exc:
                    session.add(AuditLog(
                        user_id=user_id,
                        action="submission_prepare_review_formula_compute",
                        status="failed",
                        target_id=submission_id,
                        details=f"一键计算跳过：{type(exc).__name__}: {exc}",
                    ))
                    session.commit()
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
                details=f"预处理完成：固定填空 {len(fixed_values or {})} 项，识别 {len(recognized_values or {})} 项，计算 {'开启' if computed_values else '未产生结果'}，生成回答 {len(answers)} 项。",
            ))
            session.commit()
            return {"status": "success", "fields": len(final_result)}
        except Exception as e:
            session.rollback()
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
