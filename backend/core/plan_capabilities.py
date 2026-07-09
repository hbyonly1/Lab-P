from typing import Any

from models.core import User


INTERNAL_ROLES = {"admin", "reviewer"}
PLUS_OR_PRO_PLANS = {"plus", "pro"}


def user_plan(user: User) -> str:
    capabilities: Any = user.capabilities or {}
    return str(capabilities.get("plan") or "free").strip().lower()


def is_internal_user(user: User) -> bool:
    return user.role in INTERNAL_ROLES


def can_use_image_recognition(user: User) -> bool:
    return is_internal_user(user) or user_plan(user) in PLUS_OR_PRO_PLANS


def can_use_formula_compute(user: User) -> bool:
    return is_internal_user(user) or user_plan(user) in PLUS_OR_PRO_PLANS


def can_use_fixed_fill(user: User) -> bool:
    return is_internal_user(user) or user_plan(user) == "pro"
