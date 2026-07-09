from typing import Any, Dict, Optional


PLAN_PRICES: Dict[str, float] = {
    "plus": 16.0,
    "pro": 35.0,
}

DEFAULT_EXPERIMENT_PRICES: Dict[str, float] = {
    "one_click": 5.0,
    "self_managed": 0.0,
}


def plan_price(plan: str) -> float:
    key = str(plan or "").strip().lower()
    if key not in PLAN_PRICES:
        raise ValueError(f"Unsupported plan: {plan}")
    return PLAN_PRICES[key]


def experiment_one_click_price(exp_config: Optional[Dict[str, Any]] = None) -> float:
    return DEFAULT_EXPERIMENT_PRICES["one_click"]


def pricing_snapshot(source: str, amount: float, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "source": source,
        "amount": float(amount),
        **(extra or {}),
    }
