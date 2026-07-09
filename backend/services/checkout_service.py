from typing import Any, Dict, List, Optional, Tuple
import uuid

from fastapi import HTTPException
from sqlmodel import Session, select

from core.pricing import experiment_one_click_price, plan_price, pricing_snapshot
from core.security import get_password_hash
from models.core import AuditLog, Experiment, Order, OrderItem, Submission, User, get_utc_now
from services.submission_preprocess import (
    assigned_image_slots_are_complete,
    auto_assign_single_image_slot,
    enqueue_prepare_review_task,
    mark_prepare_review_queued,
)


def new_batch_id() -> str:
    return f"BATCH-{uuid.uuid4().hex[:10].upper()}"


def new_order_id() -> str:
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def new_submission_id() -> str:
    return f"SUB-{uuid.uuid4().hex[:8].upper()}"


def normalize_plan(plan: str) -> str:
    return str(plan or "").strip().lower()


def normalize_experiments(raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result = []
    for raw in raw_items or []:
        experiment_id = str(raw.get("experiment_id") or raw.get("experimentId") or "").strip()
        image_paths = [str(path).strip() for path in (raw.get("image_paths") or raw.get("imagePaths") or []) if str(path).strip()]
        raw_image_slots = raw.get("image_slots") or raw.get("imageSlots") or {}
        image_slots: Dict[str, List[Dict[str, Any]]] = {}
        if isinstance(raw_image_slots, dict):
            for slot_id, files in raw_image_slots.items():
                normalized_files = []
                for index, file_item in enumerate(files or []):
                    if not isinstance(file_item, dict):
                        continue
                    url = str(file_item.get("url") or "").strip()
                    if not url:
                        continue
                    normalized_files.append({
                        "uid": str(file_item.get("uid") or f"{slot_id}-{index + 1}"),
                        "url": url,
                        "name": str(file_item.get("name") or f"图片 {index + 1}"),
                        "sourceIndex": file_item.get("sourceIndex"),
                    })
                if normalized_files:
                    image_slots[str(slot_id)] = normalized_files
        if not image_paths and image_slots:
            image_paths = [
                file_item["url"]
                for files in image_slots.values()
                for file_item in files
                if file_item.get("url")
            ]
        if experiment_id:
            result.append({
                "experiment_id": experiment_id,
                "image_paths": image_paths,
                "image_slots": image_slots,
                "image_assignment_confirmed": raw.get("image_assignment_confirmed", raw.get("imageAssignmentConfirmed", True)) is not False,
            })
    return result


def require_images(experiments: List[Dict[str, Any]]) -> None:
    if not experiments or any(not item.get("image_paths") for item in experiments):
        raise HTTPException(status_code=400, detail="一键提交的每个实验都至少需要上传一个实验图片。")


def get_or_create_target_student(session: Session, current_user: User, target_student: Optional[str]) -> Tuple[int, Optional[int]]:
    if current_user.role not in ["admin", "reviewer"]:
        return current_user.id, None

    target_student_no = str(target_student or "").strip()
    if not target_student_no:
        return current_user.id, None

    student = session.exec(select(User).where(User.student_no == target_student_no)).first()
    if not student:
        student = User(
            username=target_student_no,
            student_no=target_student_no,
            hashed_password=get_password_hash(target_student_no),
            encrypted_school_password=None,
            role="student",
            capabilities={"max_computes": 100, "ai_model": "gpt-4"},
        )
        session.add(student)
        session.flush()
    return int(student.id), int(current_user.id)


def experiment_config(session: Session, experiment_id: str) -> Dict[str, Any]:
    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment not found: {experiment_id}")
    return experiment.config_json or {}


def build_checkout_quote(session: Session, plan: str, experiments: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_plan = normalize_plan(plan)
    normalized_experiments = normalize_experiments(experiments)

    if normalized_experiments:
        if normalized_plan == "pay_per_use":
            items = []
            total = 0.0
            for item in normalized_experiments:
                exp_config = experiment_config(session, item["experiment_id"])
                amount = experiment_one_click_price(exp_config)
                total += amount
                items.append({
                    "item_type": "experiment_one_click",
                    "experiment_id": item["experiment_id"],
                    "unit_amount": amount,
                    "quantity": 1,
                    "total_amount": amount,
                    "pricing_snapshot": pricing_snapshot("unified.experiment_one_click", amount, {
                        "experiment_id": item["experiment_id"],
                    }),
                })
            return {
                "order_type": "one_click_batch",
                "plan": "pay_per_use",
                "items": items,
                "total_amount": total,
                "pricing_snapshot": {"strategy": "sum_unified_experiment_one_click_prices"},
            }

        if normalized_plan == "pro":
            amount = plan_price("pro")
            items = [{
                "item_type": "plan_upgrade",
                "experiment_id": None,
                "unit_amount": amount,
                "quantity": 1,
                "total_amount": amount,
                "pricing_snapshot": pricing_snapshot("plan.pro", amount),
            }]
            for item in normalized_experiments:
                experiment_config(session, item["experiment_id"])
                items.append({
                    "item_type": "batch_submission",
                    "experiment_id": item["experiment_id"],
                    "unit_amount": 0.0,
                    "quantity": 1,
                    "total_amount": 0.0,
                    "pricing_snapshot": {"covered_by": "pro_upgrade_order"},
                })
            return {
                "order_type": "plan_upgrade",
                "plan": "pro",
                "items": items,
                "total_amount": amount,
                "pricing_snapshot": {"strategy": "plan_upgrade_with_batch_release"},
            }

        raise HTTPException(status_code=400, detail="批量一键提交只支持 pay_per_use 或 pro。")

    if normalized_plan not in ["plus", "pro"]:
        raise HTTPException(status_code=400, detail="套餐升级只支持 plus 或 pro。")
    amount = plan_price(normalized_plan)
    return {
        "order_type": "plan_upgrade",
        "plan": normalized_plan,
        "items": [{
            "item_type": "plan_upgrade",
            "experiment_id": None,
            "unit_amount": amount,
            "quantity": 1,
            "total_amount": amount,
            "pricing_snapshot": pricing_snapshot(f"plan.{normalized_plan}", amount),
        }],
        "total_amount": amount,
        "pricing_snapshot": {"strategy": "plan_upgrade"},
    }


def _current_plan(user: User) -> str:
    return str((user.capabilities or {}).get("plan") or "free").strip().lower()


def _find_existing_checkout(session: Session, user_id: int, client_request_id: Optional[str]) -> Optional[Order]:
    if not client_request_id:
        return None
    return session.exec(
        select(Order)
        .where(Order.student_id == user_id)
        .where(Order.client_request_id == client_request_id)
        .order_by(Order.created_at.desc())
    ).first()


def _submissions_for_order(session: Session, order_id: str) -> List[Submission]:
    return session.exec(
        select(Submission)
        .where(Submission.order_id == order_id)
        .order_by(Submission.created_at.asc())
    ).all()


def _order_items(session: Session, order_id: str) -> List[OrderItem]:
    return session.exec(
        select(OrderItem)
        .where(OrderItem.order_id == order_id)
        .order_by(OrderItem.id.asc())
    ).all()


def serialize_order(order: Optional[Order], items: Optional[List[OrderItem]] = None) -> Optional[Dict[str, Any]]:
    if not order:
        return None
    return {
        **order.model_dump(),
        "items": [item.model_dump() for item in (items or [])],
    }


def create_checkout(
    session: Session,
    *,
    current_user: User,
    plan: str,
    experiments: List[Dict[str, Any]],
    target_student: Optional[str] = None,
    is_hungup: bool = False,
    submission_batch_id: Optional[str] = None,
    client_request_id: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_plan = normalize_plan(plan)
    normalized_experiments = normalize_experiments(experiments)

    if normalized_experiments:
        require_images(normalized_experiments)

    actual_student_id, submitted_by = get_or_create_target_student(session, current_user, target_student)
    user_is_internal = current_user.role in ["admin", "reviewer"]
    user_is_pro = _current_plan(current_user) == "pro"

    if client_request_id and not user_is_internal:
        existing_order = _find_existing_checkout(session, current_user.id, client_request_id)
        if existing_order:
            return {
                "order": serialize_order(existing_order, _order_items(session, existing_order.id)),
                "submissions": [sub.model_dump() for sub in _submissions_for_order(session, existing_order.id)],
                "submission_batch_id": existing_order.submission_batch_id,
                "quote": build_checkout_quote(session, existing_order.plan, [
                    {"experiment_id": sub.experiment_id, "image_paths": sub.image_paths, "image_slots": sub.image_slots}
                    for sub in _submissions_for_order(session, existing_order.id)
                ]),
            }

    quote = build_checkout_quote(session, normalized_plan, normalized_experiments)
    batch_id = str(submission_batch_id or "").strip() or (new_batch_id() if normalized_experiments else None)

    if not normalized_experiments:
        if user_is_internal:
            raise HTTPException(status_code=400, detail="管理员或审核员不能通过学生端 checkout 升级套餐。")
        if not is_hungup:
            raise HTTPException(status_code=400, detail="创建套餐升级订单前需要确认已支付。")
        order = Order(
            id=new_order_id(),
            student_id=current_user.id,
            experiment_id=None,
            order_type="plan_upgrade",
            plan=quote["plan"],
            amount=quote["total_amount"],
            status="pending_payment",
            submission_batch_id=None,
            client_request_id=client_request_id,
            pricing_snapshot=quote["pricing_snapshot"],
        )
        session.add(order)
        session.flush()
        for item in quote["items"]:
            session.add(OrderItem(order_id=order.id, **item))
        session.add(AuditLog(
            user_id=current_user.id,
            action="order_created",
            status="success",
            target_id=order.id,
            details=f"创建套餐升级订单 {order.plan}",
        ))
        session.commit()
        session.refresh(order)
        return {
            "order": serialize_order(order, _order_items(session, order.id)),
            "submissions": [],
            "submission_batch_id": None,
            "quote": quote,
        }

    has_paid = user_is_internal or user_is_pro
    order: Optional[Order] = None
    if not has_paid:
        if not is_hungup:
            raise HTTPException(status_code=403, detail="当前套餐不支持一键自动化填报，请升级至 Pro 或购买本次提交。")
        order = Order(
            id=new_order_id(),
            student_id=current_user.id,
            experiment_id=None,
            order_type=quote["order_type"],
            plan=quote["plan"],
            amount=quote["total_amount"],
            status="pending_payment",
            submission_batch_id=batch_id,
            client_request_id=client_request_id,
            pricing_snapshot=quote["pricing_snapshot"],
        )
        session.add(order)
        session.flush()

    submissions: List[Submission] = []
    queued_submissions: List[Submission] = []
    for item in normalized_experiments:
        experiment_config(session, item["experiment_id"])
        submission = Submission(
            id=new_submission_id(),
            student_id=actual_student_id,
            experiment_id=item["experiment_id"],
            order_id=order.id if order else None,
            submitted_by=submitted_by,
            status="pending_image_assignment" if has_paid else "pending_payment",
            payment_status="paid" if has_paid else "unpaid",
            is_one_click_handoff=True,
            image_paths=item["image_paths"],
            image_slots=item.get("image_slots") or {},
            submission_batch_id=batch_id,
            preprocess_status="waiting_for_image_assignment" if has_paid else None,
        )
        if has_paid:
            image_assignment_confirmed = item.get("image_assignment_confirmed") is not False
            if image_assignment_confirmed and assigned_image_slots_are_complete(submission):
                mark_prepare_review_queued(submission)
                queued_submissions.append(submission)
            elif image_assignment_confirmed and not submission.image_slots and auto_assign_single_image_slot(submission):
                mark_prepare_review_queued(submission)
                queued_submissions.append(submission)
        session.add(submission)
        submissions.append(submission)
    session.flush()

    if order:
        submission_by_experiment = {sub.experiment_id: sub for sub in submissions}
        for item in quote["items"]:
            submission = submission_by_experiment.get(item.get("experiment_id") or "")
            session.add(OrderItem(
                order_id=order.id,
                submission_id=submission.id if submission else None,
                **item,
            ))
        session.add(AuditLog(
            user_id=current_user.id,
            action="order_created",
            status="success",
            target_id=order.id,
            details=f"创建 {order.plan} 订单，关联提交组 {batch_id}",
        ))

    session.commit()
    for submission in queued_submissions:
        enqueue_prepare_review_task(session, submission, current_user.id)
    if queued_submissions:
        session.commit()

    for submission in submissions:
        session.refresh(submission)
    if order:
        session.refresh(order)

    return {
        "order": serialize_order(order, _order_items(session, order.id) if order else []),
        "submissions": [sub.model_dump() for sub in submissions],
        "submission_batch_id": batch_id,
        "quote": quote,
    }


def apply_order_payment_action(session: Session, order: Order, action: str, actor_user_id: int) -> Dict[str, Any]:
    normalized_action = str(action or "").strip().lower()
    if normalized_action not in ["verify", "reject"]:
        raise HTTPException(status_code=400, detail="Unsupported payment action")

    submissions = _submissions_for_order(session, order.id)
    queued_submissions: List[Submission] = []

    if normalized_action == "verify":
        order.status = "paid"
        action_name = "payment_verified"
        if order.order_type == "plan_upgrade" and order.plan in ["plus", "pro"]:
            student_user = session.get(User, order.student_id)
            if student_user:
                caps = dict(student_user.capabilities or {})
                caps["plan"] = order.plan
                student_user.capabilities = caps
                session.add(student_user)

        for submission in submissions:
            submission.payment_status = "paid"
            submission.status = "pending_image_assignment" if submission.is_one_click_handoff else "incomplete"
            submission.preprocess_status = "waiting_for_image_assignment" if submission.is_one_click_handoff else None
            submission.preprocess_error = None
            submission.updated_at = get_utc_now()
            if submission.is_one_click_handoff:
                if assigned_image_slots_are_complete(submission):
                    mark_prepare_review_queued(submission)
                    queued_submissions.append(submission)
                elif not submission.image_slots and auto_assign_single_image_slot(submission):
                    mark_prepare_review_queued(submission)
                    queued_submissions.append(submission)
            session.add(submission)
    else:
        order.status = "rejected"
        action_name = "payment_rejected"
        for submission in submissions:
            submission.status = "error"
            submission.payment_status = "unpaid"
            submission.updated_at = get_utc_now()
            session.add(submission)

    order.updated_at = get_utc_now()
    session.add(order)

    student_user = session.get(User, order.student_id)
    if student_user:
        student_identity = student_user.real_name or "姓名未同步"
        if student_user.student_no:
            student_identity = f"{student_identity}，学号 {student_user.student_no}"
    else:
        student_identity = f"用户 {order.student_id}"
    action_cn = "确认了" if normalized_action == "verify" else "驳回了"

    session.add(AuditLog(
        user_id=actor_user_id,
        action=action_name,
        status="success",
        target_id=order.id,
        details=f"{action_cn}订单 {order.id} ({student_identity}) 的收款请求，影响 {len(submissions)} 个提交。",
    ))

    session.commit()
    for submission in queued_submissions:
        enqueue_prepare_review_task(session, submission, actor_user_id)
    if queued_submissions:
        session.commit()

    return {
        "order_id": order.id,
        "action": normalized_action,
        "affected_submissions": len(submissions),
        "queued_preprocess": len(queued_submissions),
    }
