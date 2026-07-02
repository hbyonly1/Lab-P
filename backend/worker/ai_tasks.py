import asyncio
from worker.celery_app import celery_app
from sqlmodel import Session
from core.db import engine
from models.core import AuditLog, Submission
from services import ai_service

@celery_app.task(bind=True, max_retries=3)
def recognize_images_task(self, experiment_id: str, image_paths: list[str], user_id: int):
    """detail 页一键识别按鈕触发。结果存 Celery result backend。"""
    with Session(engine) as session:
        try:
            result = asyncio.run(ai_service.recognize_images(experiment_id, image_paths, session))
            log = AuditLog(user_id=user_id, action="ai_recognize", status="success", 
                           target_id=experiment_id, details=f"recognized {len(result)} fields")
            session.add(log)
            session.commit()
            return result
        except Exception as e:
            log = AuditLog(user_id=user_id, action="ai_recognize", status="failed", 
                           target_id=experiment_id, details=str(e))
            session.add(log)
            session.commit()
            raise e

@celery_app.task(bind=True, max_retries=3)
def generate_answer_task(self, experiment_id: str, questions: list[dict], form_values: dict, user_id: int):
    """detail 页统一生成全部实验问题回答按钮触发。"""
    with Session(engine) as session:
        try:
            answers = asyncio.run(ai_service.generate_answers(
                experiment_id, questions, form_values, session
            ))
            log = AuditLog(user_id=user_id, action="ai_generate", status="success",
                           target_id=experiment_id, details=f"generated {len(answers)} answers")
            session.add(log)
            session.commit()
            return {"answers": answers}
        except Exception as e:
            log = AuditLog(user_id=user_id, action="ai_generate", status="failed",
                           target_id=experiment_id, details=str(e))
            session.add(log)
            session.commit()
            raise e

@celery_app.task(bind=True, max_retries=3)  
def fixed_fill_task(self, experiment_id: str, user_id: int):
    """detail 页一键填空按鈕触发。"""
    try:
        result = asyncio.run(ai_service.get_fixed_fill(experiment_id))
        with Session(engine) as session:
            log = AuditLog(user_id=user_id, action="ai_fixed_fill", status="success",
                           target_id=experiment_id, details="成功获取固定填空配置。")
            session.add(log)
            session.commit()
        return result
    except Exception as e:
        with Session(engine) as session:
            log = AuditLog(user_id=user_id, action="ai_fixed_fill", status="failed",
                           target_id=experiment_id, details=f"获取失败: {str(e)}")
            session.add(log)
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
            result = asyncio.run(ai_service.recognize_images(
                submission.experiment_id, 
                submission.image_paths, 
                session
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
            
            log = AuditLog(user_id=user_id, action="ai_submission", status="success",
                           target_id=submission_id)
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
