from typing import Dict, List

from sqlmodel import Session

from core.image_assignment_prompts import image_slots_cover_required, user_upload_image_slots
from models.core import AuditLog, Submission, get_utc_now
from services.experimentConfigStore import get_experiment_config
from worker.ai_tasks import prepare_submission_for_review_task


def _computed_asset_image_slot_ids(exp_config: dict) -> set[str]:
    slot_ids = set()
    computed_assets = exp_config.get("computedAssets") or {}
    for asset in computed_assets.values():
        if isinstance(asset, dict) and asset.get("imageSlotId"):
            slot_ids.add(str(asset.get("imageSlotId")))
    return slot_ids


def _auto_assign_candidate_image_slots(exp_config: dict) -> List[dict]:
    return user_upload_image_slots(exp_config)


def build_single_slot_default_image_slots(submission: Submission) -> Dict[str, List[dict]]:
    exp_config = get_experiment_config(submission.experiment_id) or {}
    image_slots = _auto_assign_candidate_image_slots(exp_config)
    if len(image_slots) != 1:
        return {}

    slot_id = image_slots[0].get("id")
    if not slot_id:
        return {}

    files = []
    for index, url in enumerate(submission.image_paths or []):
        if not url:
            continue
        files.append({
            "uid": f"{submission.id}-{index}",
            "url": url,
            "name": f"图片 {index + 1}",
            "sourceIndex": index + 1,
        })
    if not files:
        return {}
    return {str(slot_id): files}


def auto_assign_single_image_slot(submission: Submission) -> bool:
    if submission.image_slots:
        return False
    image_slots = build_single_slot_default_image_slots(submission)
    if not image_slots:
        return False
    submission.image_slots = image_slots
    return True


def assigned_image_slots_are_complete(submission: Submission) -> bool:
    exp_config = get_experiment_config(submission.experiment_id) or {}
    return image_slots_cover_required(submission.image_slots or {}, exp_config)


def mark_prepare_review_queued(submission: Submission) -> None:
    submission.status = "preparing_review"
    submission.preprocess_status = "queued"
    submission.preprocess_error = None
    submission.updated_at = get_utc_now()


def enqueue_prepare_review_task(session: Session, submission: Submission, user_id: int) -> str:
    task_result = prepare_submission_for_review_task.delay(submission.id, user_id)
    task_id = getattr(task_result, "id", None) or "unknown"
    session.add(AuditLog(
        user_id=user_id,
        action="submission_prepare_review_queued",
        status="success",
        target_id=submission.id,
        details=f"审核预处理任务已入队，Celery task_id={task_id}",
    ))
    return task_id
