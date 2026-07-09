from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple


class ScoreCheckConfigError(ValueError):
    pass


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _parse_number(value: Any) -> Optional[float]:
    if _is_blank(value):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return float(value)
        return None
    text = str(value).strip()
    text = text.replace("，", ",").replace("−", "-").replace("－", "-")
    text = text.replace("%", "")
    match = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    try:
        parsed = float(match.group(0))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _extract_number_text(value: Any) -> Optional[str]:
    if _is_blank(value):
        return None
    text = str(value).strip()
    text = text.replace("，", ",").replace("−", "-").replace("－", "-")
    text = text.replace(",", "").replace("%", "")
    match = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    return match.group(0) if match else None


def _count_significant_digits(value: Any) -> Optional[int]:
    number_text = _extract_number_text(value)
    if not number_text:
        return None
    mantissa = re.split(r"[eE]", number_text, maxsplit=1)[0]
    mantissa = mantissa.lstrip("+-")
    digits = re.sub(r"\D", "", mantissa)
    first_non_zero = next((idx for idx, char in enumerate(digits) if char != "0"), None)
    if first_non_zero is None:
        return 1 if digits else None
    return len(digits[first_non_zero:])


def _count_decimal_places(value: Any) -> Optional[int]:
    number_text = _extract_number_text(value)
    if not number_text:
        return None
    mantissa = re.split(r"[eE]", number_text, maxsplit=1)[0]
    if "." not in mantissa:
        return 0
    return len(mantissa.split(".", maxsplit=1)[1])


def _precision_requirement(rule: Dict[str, Any]) -> Tuple[Optional[List[int]], Optional[List[int]]]:
    significant_digits = rule.get("requiredSignificantDigits")
    decimal_places = rule.get("requiredDecimalPlaces")
    if isinstance(significant_digits, int):
        significant_digits = [significant_digits]
    if isinstance(decimal_places, int):
        decimal_places = [decimal_places]
    return significant_digits, decimal_places


def _precision_status(rule: Dict[str, Any], raw_value: Any) -> Tuple[bool, List[str], List[str]]:
    required_sig, required_decimals = _precision_requirement(rule)
    failed = []
    descriptions = []

    if required_sig:
        actual_sig = _count_significant_digits(raw_value)
        allowed = [int(item) for item in required_sig]
        descriptions.append(f"有效数字为 {' 或 '.join(str(item) for item in allowed)} 位")
        if actual_sig not in allowed:
            failed.append(f"有效数字为 {actual_sig if actual_sig is not None else '无法识别'} 位，要求 {' 或 '.join(str(item) for item in allowed)} 位")

    if required_decimals:
        actual_decimals = _count_decimal_places(raw_value)
        allowed = [int(item) for item in required_decimals]
        descriptions.append(f"小数点后为 {' 或 '.join(str(item) for item in allowed)} 位")
        if actual_decimals not in allowed:
            failed.append(f"小数点后为 {actual_decimals if actual_decimals is not None else '无法识别'} 位，要求 {' 或 '.join(str(item) for item in allowed)} 位")

    return not failed, failed, descriptions


def _range_match(metric: float, ranges: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for item in ranges or []:
        min_value = item.get("min")
        max_value = item.get("max")
        min_inclusive = item.get("minInclusive", True)
        max_inclusive = item.get("maxInclusive", True)

        if min_value is not None:
            min_number = float(min_value)
            if metric < min_number or (metric == min_number and not min_inclusive):
                continue
        if max_value is not None:
            max_number = float(max_value)
            if metric > max_number or (metric == max_number and not max_inclusive):
                continue
        return item
    return None


def _score_status(score: float, max_score: float) -> str:
    if score >= max_score and max_score > 0:
        return "full"
    if score > 0:
        return "partial"
    return "zero"


def _label_range(range_item: Dict[str, Any], metric_label: str) -> str:
    if not range_item:
        return "未命中任何得分区间"
    if range_item.get("label"):
        return str(range_item["label"])
    min_value = range_item.get("min")
    max_value = range_item.get("max")
    if min_value is not None and max_value is not None:
        return f"{metric_label}在 {min_value} 到 {max_value} 之间"
    if min_value is not None:
        return f"{metric_label}不小于 {min_value}"
    if max_value is not None:
        return f"{metric_label}不大于 {max_value}"
    return "未命中高分区间，按否则规则得分"


def _rule_descriptions(rule: Dict[str, Any], metric_label: str) -> List[str]:
    descriptions = []
    for item in rule.get("ranges") or []:
        score = item.get("score")
        level = item.get("level") or item.get("status")
        min_value = item.get("min")
        max_value = item.get("max")
        min_inclusive = item.get("minInclusive", True)
        max_inclusive = item.get("maxInclusive", True)
        if item.get("label"):
            condition = str(item["label"])
        elif min_value is None and max_value is None:
            condition = "其他情况"
        elif min_value is not None and max_value is not None:
            left = "≤" if min_inclusive else "<"
            right = "≤" if max_inclusive else "<"
            condition = f"{min_value} {left} {metric_label} {right} {max_value}"
        elif min_value is not None:
            op = "≥" if min_inclusive else ">"
            condition = f"{metric_label} {op} {min_value}"
        else:
            op = "≤" if max_inclusive else "<"
            condition = f"{metric_label} {op} {max_value}"
        if score is not None:
            descriptions.append(f"{condition}：{score} 分")
        elif level:
            descriptions.append(f"{condition}：{level}")
        else:
            descriptions.append(condition)
    return descriptions


def _rule_precision_descriptions(rule: Dict[str, Any]) -> List[str]:
    _, _, descriptions = _precision_status(rule, "1")
    if not descriptions:
        return []
    max_score = float(rule.get("maxScore") or 0)
    range_score = rule.get("rangeOnlyScore")
    if range_score is None:
        range_scores = [
            float(item.get("score"))
            for item in (rule.get("ranges") or [])
            if item.get("score") is not None
        ]
        range_score = max(range_scores) if range_scores else 0
    return [
        f"命中数值区间且{description}：{max_score:g} 分；仅命中数值区间：{float(range_score):g} 分"
        for description in descriptions
    ]


def _make_missing_result(rule: Dict[str, Any], missing_node_ids: List[str]) -> Dict[str, Any]:
    max_score = float(rule.get("maxScore") or 0)
    node_ids = rule.get("nodeIds") or ([rule.get("nodeId")] if rule.get("nodeId") else [])
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": "missing",
        "score": 0,
        "maxScore": max_score,
        "nodeIds": node_ids,
        "reason": f"缺少当前检查项需要的数据：{', '.join(missing_node_ids)}" if missing_node_ids else "缺少当前检查项需要的数据",
        "missingNodeIds": missing_node_ids,
    }


def _evaluate_numeric_range(rule: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    node_id = rule.get("nodeId")
    raw_value = values.get(node_id)
    value = _parse_number(raw_value)
    if value is None:
        return _make_missing_result(rule, [node_id] if node_id else [])

    max_score = float(rule.get("maxScore") or 0)
    matched = _range_match(value, rule.get("ranges") or [])
    range_score = float((matched or {}).get("score", 0))
    precision_ok, precision_failures, precision_descriptions = _precision_status(rule, raw_value)
    has_precision_rule = bool(precision_descriptions)
    score = max_score if matched and has_precision_rule and precision_ok else range_score
    metric_label = rule.get("metricLabel") or "数值"
    if matched and has_precision_rule and precision_ok:
        reason = f"{_label_range(matched or {}, metric_label)}，格式满足{'、'.join(precision_descriptions)}"
    elif matched and precision_failures:
        reason = f"{_label_range(matched or {}, metric_label)}；{'；'.join(precision_failures)}"
    else:
        reason = _label_range(matched or {}, metric_label) if matched else f"{metric_label}={value:g}，未命中得分区间"
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": _score_status(score, max_score),
        "score": score,
        "maxScore": max_score,
        "nodeIds": [node_id] if node_id else [],
        "value": value,
        "reason": reason,
        "ruleDescriptions": [*_rule_descriptions(rule, metric_label), *_rule_precision_descriptions(rule)],
    }


def _evaluate_error_range(rule: Dict[str, Any], values: Dict[str, Any], *, relative: bool) -> Dict[str, Any]:
    node_id = rule.get("nodeId")
    value = _parse_number(values.get(node_id))
    reference = _parse_number(rule.get("referenceValue"))
    missing = []
    if value is None:
        missing.append(node_id)
    if reference is None:
        missing.append("referenceValue")
    if missing:
        return _make_missing_result(rule, [item for item in missing if item])
    if relative and reference == 0:
        raise ScoreCheckConfigError(f"{rule.get('id')} referenceValue cannot be 0")

    metric = abs(value - reference)
    metric_label = "绝对偏差"
    if relative:
        metric = metric / abs(reference) * 100
        metric_label = "相对偏差(%)"

    max_score = float(rule.get("maxScore") or 0)
    matched = _range_match(metric, rule.get("ranges") or [])
    score = float((matched or {}).get("score", 0))
    reason = (
        f"{metric_label}={metric:.4g}，{_label_range(matched, metric_label)}"
        if matched
        else f"{metric_label}={metric:.4g}，未命中得分区间"
    )
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": _score_status(score, max_score),
        "score": score,
        "maxScore": max_score,
        "nodeIds": [node_id] if node_id else [],
        "value": value,
        "referenceValue": reference,
        "metric": metric,
        "metricLabel": metric_label,
        "reason": reason,
        "ruleDescriptions": _rule_descriptions(rule, metric_label),
    }


def _evaluate_presence(rule: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    node_ids = rule.get("nodeIds") or ([rule.get("nodeId")] if rule.get("nodeId") else [])
    missing = [node_id for node_id in node_ids if _is_blank(values.get(node_id))]
    max_score = float(rule.get("maxScore") or 0)
    score = float(rule.get("scoreWhenComplete", max_score)) if not missing else float(rule.get("scoreWhenMissing", 0))
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": _score_status(score, max_score) if not missing else "missing",
        "score": score,
        "maxScore": max_score,
        "nodeIds": node_ids,
        "reason": "已填写" if not missing else "存在未填写节点",
        "missingNodeIds": missing,
    }


def _evaluate_beat_period_consistency(rule: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    period_node_id = rule.get("periodNodeId")
    frequency_node_ids = rule.get("frequencyNodeIds") or []
    period = _parse_number(values.get(period_node_id))
    frequencies = [_parse_number(values.get(node_id)) for node_id in frequency_node_ids]
    missing = []
    if period is None:
        missing.append(period_node_id)
    missing.extend(node_id for node_id, value in zip(frequency_node_ids, frequencies) if value is None)
    if missing:
        return _make_missing_result(rule, [item for item in missing if item])
    diff = abs(frequencies[0] - frequencies[1])
    if diff == 0:
        return {
            "id": rule.get("id"),
            "title": rule.get("title") or rule.get("id"),
            "status": "zero",
            "score": 0,
            "maxScore": float(rule.get("maxScore") or 0),
            "nodeIds": [period_node_id, *frequency_node_ids],
            "reason": "两个频率相同，无法检查拍周期关系",
        }

    period_scale = float(rule.get("periodScale") or 1)
    normalized_period = period * period_scale
    lower = float(rule.get("lowerFactor", 0.8)) / diff
    upper = float(rule.get("upperFactor", 1.2)) / diff
    inclusive = bool(rule.get("inclusive", False))
    matched = lower <= normalized_period <= upper if inclusive else lower < normalized_period < upper
    max_score = float(rule.get("maxScore") or 0)
    score = max_score if matched else 0
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": _score_status(score, max_score),
        "score": score,
        "maxScore": max_score,
        "nodeIds": [period_node_id, *frequency_node_ids],
        "value": period,
        "metric": normalized_period,
        "ruleDescriptions": [
            f"{rule.get('lowerFactor', 0.8)}/|f1-f2| < T < {rule.get('upperFactor', 1.2)}/|f1-f2|：{max_score:g} 分"
        ],
        "reason": (
            "拍周期满足 0.8/|f1-f2| 到 1.2/|f1-f2| 的范围"
            if matched
            else "拍周期不满足 0.8/|f1-f2| 到 1.2/|f1-f2| 的范围"
        ),
    }


def _level_for_metric(metric: float, ranges: List[Dict[str, Any]]) -> Tuple[str, Optional[Dict[str, Any]]]:
    matched = _range_match(metric, ranges or [])
    if not matched:
        return "unknown", None
    return str(matched.get("level") or matched.get("status") or "unknown"), matched


def _evaluate_reference_relative_error(
    rule: Dict[str, Any],
    values: Dict[str, Any],
    *,
    include_reference_value: bool,
) -> Dict[str, Any]:
    node_id = rule.get("nodeId")
    value = _parse_number(values.get(node_id))
    reference = _parse_number(rule.get("referenceValue"))
    missing = []
    if value is None:
        missing.append(node_id)
    if reference is None:
        missing.append("referenceValue")
    if missing:
        result = {
            "id": rule.get("id"),
            "title": rule.get("title") or rule.get("id"),
            "status": "missing",
            "level": "missing",
            "nodeIds": [node_id] if node_id else [],
            "reason": f"缺少当前检查项需要的数据：{', '.join(item for item in missing if item)}",
            "missingNodeIds": [item for item in missing if item],
        }
    elif reference == 0:
        raise ScoreCheckConfigError(f"{rule.get('id')} referenceValue cannot be 0")
    else:
        metric = abs(value - reference) / abs(reference) * 100
        level, matched = _level_for_metric(metric, rule.get("ranges") or [])
        precision_ok, precision_failures, precision_descriptions = _precision_status(rule, values.get(node_id))
        if precision_failures and level == "good":
            level = "warning"
        reason_parts = [
            matched.get("label") if matched and matched.get("label") else f"相对偏差约 {metric:.3g}%"
        ]
        if precision_failures:
            reason_parts.extend(precision_failures)
        elif precision_descriptions:
            reason_parts.append(f"格式满足{'、'.join(precision_descriptions)}")
        result = {
            "id": rule.get("id"),
            "title": rule.get("title") or rule.get("id"),
            "status": level,
            "level": level,
            "nodeIds": [node_id] if node_id else [],
            "value": value,
            "metric": metric,
            "metricLabel": "相对偏差(%)",
            "reason": "；".join(reason_parts),
        }

    if include_reference_value:
        result["referenceValue"] = reference
        result["referenceUnit"] = rule.get("referenceUnit")
        result["referenceSource"] = rule.get("referenceSource")
    return result


def _evaluate_reference_precision(rule: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    node_id = rule.get("nodeId")
    if _parse_number(values.get(node_id)) is None:
        return {
            "id": rule.get("id"),
            "title": rule.get("title") or rule.get("id"),
            "status": "missing",
            "level": "missing",
            "nodeIds": [node_id] if node_id else [],
            "reason": f"缺少当前检查项需要的数据：{node_id}" if node_id else "缺少当前检查项需要的数据",
            "missingNodeIds": [node_id] if node_id else [],
        }
    precision_ok, precision_failures, precision_descriptions = _precision_status(rule, values.get(node_id))
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": "good" if precision_ok else "warning",
        "level": "good" if precision_ok else "warning",
        "nodeIds": [node_id] if node_id else [],
        "value": _parse_number(values.get(node_id)),
        "reason": (
            f"格式满足{'、'.join(precision_descriptions)}"
            if precision_ok
            else "；".join(precision_failures)
        ),
    }


def _evaluate_reference_trend(rule: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    node_groups = rule.get("nodeGroups") or []
    selected_group = None
    if node_groups:
        complete_groups = []
        partial_groups = []
        for group in node_groups:
            group_node_ids = group.get("nodeIds") or []
            parsed_group = [(node_id, _parse_number(values.get(node_id))) for node_id in group_node_ids]
            missing_group = [node_id for node_id, value in parsed_group if value is None]
            if not missing_group and group_node_ids:
                complete_groups.append((group, parsed_group))
            elif any(value is not None for _, value in parsed_group):
                partial_groups.append((group, missing_group))
        if complete_groups:
            selected_group, parsed = complete_groups[0]
            node_ids = selected_group.get("nodeIds") or []
        else:
            missing = partial_groups[0][1] if partial_groups else [
                node_id
                for group in node_groups
                for node_id in (group.get("nodeIds") or [])
            ]
            return {
                "id": rule.get("id"),
                "title": rule.get("title") or rule.get("id"),
                "status": "missing",
                "level": "missing",
                "nodeIds": [node_id for group in node_groups for node_id in (group.get("nodeIds") or [])],
                "reason": f"请完整填写一个测量温区后再检查；缺失节点：{', '.join(missing)}",
                "missingNodeIds": missing,
            }
    else:
        node_ids = rule.get("nodeIds") or []
        parsed = [(node_id, _parse_number(values.get(node_id))) for node_id in node_ids]
    missing = [node_id for node_id, value in parsed if value is None]
    if missing:
        return {
            "id": rule.get("id"),
            "title": rule.get("title") or rule.get("id"),
            "status": "missing",
            "level": "missing",
            "nodeIds": node_ids,
            "reason": f"缺少当前趋势检查需要的数据：{', '.join(missing)}",
            "missingNodeIds": missing,
        }

    numbers = [value for _, value in parsed]
    direction = rule.get("direction") or "decreasing"
    tolerance = float(rule.get("tolerance") or 0)
    if direction == "increasing":
        ok = all(numbers[idx + 1] >= numbers[idx] - tolerance for idx in range(len(numbers) - 1))
    else:
        ok = all(numbers[idx + 1] <= numbers[idx] + tolerance for idx in range(len(numbers) - 1))
    return {
        "id": rule.get("id"),
        "title": rule.get("title") or rule.get("id"),
        "status": "good" if ok else "danger",
        "level": "good" if ok else "danger",
        "nodeIds": node_ids,
        "reason": (
            f"{selected_group.get('label')}：{rule.get('passReason')}"
            if ok and selected_group
            else rule.get("passReason") if ok
            else f"{selected_group.get('label')}：{rule.get('failReason') or '趋势与典型规律不一致'}"
            if selected_group
            else rule.get("failReason") or "趋势与典型规律不一致"
        ),
    }


def evaluate_reference_value_check(
    reference_config: Dict[str, Any],
    current_form_values: Dict[str, Any],
    *,
    include_reference_values: bool,
) -> Dict[str, Any]:
    reference_config = reference_config or {}
    results = []
    for rule in reference_config.get("items") or []:
        rule_type = rule.get("type")
        if rule_type == "relative_error_percent":
            result = _evaluate_reference_relative_error(
                rule,
                current_form_values,
                include_reference_value=include_reference_values,
            )
        elif rule_type == "numeric_precision":
            result = _evaluate_reference_precision(rule, current_form_values)
        elif rule_type == "trend":
            result = _evaluate_reference_trend(rule, current_form_values)
        else:
            result = {
                "id": rule.get("id"),
                "title": rule.get("title") or rule.get("id"),
                "status": "unsupported",
                "level": "unsupported",
                "reason": "当前参考值检查类型暂不支持",
            }
        results.append(result)
    return {
        "enabled": bool(reference_config.get("enabled", False)),
        "label": reference_config.get("label") or "按典型参考值检查",
        "itemCount": len(results),
        "items": results,
        "notes": reference_config.get("notes") or [],
    }


def evaluate_score_check(
    experiment_id: str,
    experiment_title: str,
    score_config: Dict[str, Any],
    current_form_values: Dict[str, Any],
    reference_config: Optional[Dict[str, Any]] = None,
    include_reference_values: bool = False,
) -> Dict[str, Any]:
    score_config = score_config or {}
    items = score_config.get("items") or []
    results = []
    for rule in items:
        rule_type = rule.get("type")
        if rule_type == "numeric_range":
            result = _evaluate_numeric_range(rule, current_form_values)
        elif rule_type == "relative_error_percent":
            result = _evaluate_error_range(rule, current_form_values, relative=True)
        elif rule_type == "absolute_error":
            result = _evaluate_error_range(rule, current_form_values, relative=False)
        elif rule_type == "presence":
            result = _evaluate_presence(rule, current_form_values)
        elif rule_type == "beat_period_consistency":
            result = _evaluate_beat_period_consistency(rule, current_form_values)
        else:
            result = {
                "id": rule.get("id"),
                "title": rule.get("title") or rule.get("id"),
                "status": "unsupported",
                "score": 0,
                "maxScore": float(rule.get("maxScore") or 0),
                "reason": "当前规则类型暂不支持自动检查",
            }
        results.append(result)

    total_score = sum(float(item.get("score") or 0) for item in results if item.get("status") != "unsupported")
    computable_score = float(score_config.get("computableScore") or sum(float(item.get("maxScore") or 0) for item in items))
    if not include_reference_values:
        for result in results:
            result.pop("ruleDescriptions", None)

    return {
        "experimentId": experiment_id,
        "experimentTitle": experiment_title,
        "enabled": bool(score_config.get("enabled", False)),
        "totalScore": float(score_config.get("totalScore") or 0),
        "computableScore": computable_score,
        "score": total_score,
        "itemCount": len(results),
        "items": results,
        "notes": score_config.get("notes") or [],
        "referenceChecks": evaluate_reference_value_check(
            reference_config or {},
            current_form_values,
            include_reference_values=include_reference_values,
        ),
    }
