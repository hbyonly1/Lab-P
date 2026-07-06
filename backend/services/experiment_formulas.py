import math
from typing import Any, Dict, List, Tuple


class FormulaInputError(ValueError):
    def __init__(self, missing_node_ids: List[str]):
        self.missing_node_ids = list(dict.fromkeys(missing_node_ids))
        super().__init__("Formula input is incomplete")


class FormulaValueMap(dict):
    def __getitem__(self, key: str) -> Any:
        value = super().get(key)
        if value in (None, ""):
            raise FormulaInputError([key])
        return value


def make_value_getter(values: Dict[str, Any]):
    value_map = FormulaValueMap(values)

    def v(*items: Any) -> Any:
        resolved = []
        missing_node_ids = []
        for item in items:
            if isinstance(item, str):
                value = value_map.get(item)
                if value in (None, ""):
                    missing_node_ids.append(item)
                    continue
                resolved.append(value)
            else:
                resolved.append(item)
        if missing_node_ids:
            raise FormulaInputError(missing_node_ids)
        if len(resolved) == 1:
            return resolved[0]
        return resolved

    return v


def _numeric_pairs(x_values: List[Any], y_values: List[Any]) -> List[Tuple[float, float]]:
    pairs = []
    for x_value, y_value in zip(x_values, y_values):
        if x_value in (None, "") or y_value in (None, ""):
            continue
        x = float(x_value)
        y = float(y_value)
        pairs.append((x, y))
    if len(pairs) < 2:
        raise ValueError("At least two valid points are required")
    return pairs


def reciprocal_values(values: List[Any]) -> List[float]:
    result = []
    for value in values:
        number = float(value)
        if number == 0:
            raise ValueError("Cannot divide by zero")
        result.append(1 / number)
    return result


def linear_slope(x_values: List[Any], y_values: List[Any]) -> float:
    pairs = _numeric_pairs(x_values, y_values)
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        raise ValueError("X values must not be identical")
    return sum((x - x_mean) * (y - y_mean) for x, y in pairs) / denominator


def linear_intercept(x_values: List[Any], y_values: List[Any]) -> float:
    pairs = _numeric_pairs(x_values, y_values)
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    return (sum(ys) / len(ys)) - linear_slope(xs, ys) * (sum(xs) / len(xs))


def linear_r2(x_values: List[Any], y_values: List[Any]) -> float:
    pairs = _numeric_pairs(x_values, y_values)
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    y_mean = sum(ys) / len(ys)
    total = sum((y - y_mean) ** 2 for y in ys)
    if total == 0:
        raise ValueError("Y values must not be identical")
    intercept = linear_intercept(xs, ys)
    slope = linear_slope(xs, ys)
    residual = sum((y - (slope * x + intercept)) ** 2 for x, y in pairs)
    return 1 - residual / total


def format_sig(value: Any, digits: int = 3) -> str:
    digits = int(digits)
    number = float(value)
    if digits <= 0:
        raise ValueError("digits must be positive")
    if number == 0:
        return f"{0:.{digits - 1}f}"
    rounded = float(f"{number:.{digits}g}")
    decimals = max(digits - 1 - math.floor(math.log10(abs(rounded))), 0)
    return f"{rounded:.{decimals}f}"


def format_fixed(value: Any, digits: int = 0) -> str:
    digits = int(digits)
    if digits < 0:
        raise ValueError("digits must not be negative")
    return f"{float(value):.{digits}f}"


def build_formula_functions(values: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "v": make_value_getter(values),
        "reciprocal": reciprocal_values,
        "reciprocal_values": reciprocal_values,
        "linear_slope": linear_slope,
        "linear_intercept": linear_intercept,
        "linear_r2": linear_r2,
        "format_sig": format_sig,
        "format_fixed": format_fixed,
    }
