import os
import json
import base64
import mimetypes
from pathlib import Path
from typing import Any, List, Optional
from urllib.parse import urlparse
from sqlmodel import Session, select
from models.core import AiPromptTemplate
from core.ai_prompts import build_recognition_prompt, build_generation_answers_prompt
from core.image_assignment_prompts import build_image_assignment_prompt, image_assignment_reference_images
from services.ai_provider import (
    AI_TASK_ANSWER_GENERATION,
    AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
    AI_TASK_IMAGE_RECOGNITION,
    get_ai_provider,
)

def ai_error_detail(prefix: str, error: Exception) -> str:
    return f"{prefix}: {type(error).__name__}: {error}"


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _extract_balanced_json_object(text: str) -> str:
    start = text.find("{")
    if start < 0:
        raise ValueError("AI response does not contain a JSON object")

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]

    raise ValueError("AI response contains an incomplete JSON object")


def parse_json_object_from_ai_response(content: Any) -> dict:
    if isinstance(content, dict):
        return content
    if content is None:
        raise ValueError("AI response is empty")

    text = str(content).strip()
    if not text:
        raise ValueError("AI response is empty")

    text = text.replace("<|begin_of_box|>", "").replace("<|end_of_box|>", "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except Exception:
        parsed = json.loads(_extract_balanced_json_object(text))

    if not isinstance(parsed, dict):
        raise ValueError("AI response JSON is not an object")
    return parsed


def _resolve_image_file_path(value: Any) -> Path:
    image_value = str(value or "").strip()
    if not image_value:
        raise ValueError("image path is empty")

    parsed = urlparse(image_value)
    path_part = parsed.path if parsed.scheme else image_value
    path_part = path_part.split("?", 1)[0]
    raw_path = Path(path_part)
    candidates = []

    if raw_path.is_absolute():
        candidates.append(raw_path)
        if path_part.startswith("/uploads/"):
            rel = path_part.lstrip("/")
            candidates.extend([
                Path.cwd() / rel,
                BACKEND_ROOT / rel,
                BACKEND_ROOT.parent / rel,
            ])
    else:
        candidates.extend([
            Path.cwd() / path_part,
            BACKEND_ROOT / path_part,
            BACKEND_ROOT.parent / path_part,
        ])

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate

    raise FileNotFoundError(f"image file not found: {image_value}")


def image_path_to_model_url(value: Any) -> str:
    image_value = str(value or "").strip()
    if not image_value:
        raise ValueError("image path is empty")

    parsed = urlparse(image_value)
    if parsed.scheme in ["http", "https", "data"]:
        return image_value

    image_path = _resolve_image_file_path(image_value)
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


def _image_url_payload(value: Any, *, detail: Optional[str] = None) -> dict:
    payload = {"url": image_path_to_model_url(value)}
    if detail:
        payload["detail"] = detail
    return payload

async def recognize_images(
    experiment_id: str,
    image_paths: list[str],
    session: Session,
    recognition_attempt: int = 1,
    recognition_node_ids: Optional[List[str]] = None,
    recognition_extra_prompt: Optional[str] = None,
) -> dict:
    from services.experimentConfigStore import get_experiment_config, collect_ai_recognition_node_ids
    
    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        raise ValueError(f"Experiment {experiment_id} not found")
        
    db_template = session.get(AiPromptTemplate, experiment_id)
    
    if recognition_node_ids is None:
        recognition_node_ids = collect_ai_recognition_node_ids(exp_config)
    else:
        allowed_node_ids = set(collect_ai_recognition_node_ids(exp_config))
        recognition_node_ids = [
            node_id
            for node_id in recognition_node_ids
            if node_id in allowed_node_ids
        ]
    
    if not recognition_node_ids:
        return {} # Nothing to extract

    prompt_config = exp_config
    if recognition_extra_prompt is not None:
        prompt_config = dict(exp_config)
        ai_config = dict((exp_config.get("ai") or {}))
        prompt_recognition_config = dict(ai_config.get("recognition") or {})
        prompt_recognition_config["extraPrompt"] = recognition_extra_prompt
        ai_config["recognition"] = prompt_recognition_config
        prompt_config["ai"] = ai_config

    prompt = build_recognition_prompt(prompt_config, recognition_node_ids, db_template)
    
    provider = get_ai_provider(session)
    
    messages = [
        {"role": "user", "content": [{"type": "text", "text": prompt}]}
    ]
    
    for path in image_paths:
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": _image_url_payload(path)
        })
        
    try:
        response = await provider.chat_completion(
            task=AI_TASK_IMAGE_RECOGNITION,
            messages=messages,
            response_format={"type": "json_object"},
            recognition_attempt=recognition_attempt,
        )
        content = response.choices[0].message.content
        result_dict = parse_json_object_from_ai_response(content)
        
        # 过滤只保留我们想要的 keys
        filtered = {
            k: "" if v is None else str(v).strip()
            for k, v in result_dict.items()
            if k in recognition_node_ids
        }
        return filtered
        
    except Exception as e:
        detail = ai_error_detail("AI 识别失败", e)
        print(f"AI Recognition Error: {detail}")
        raise ValueError(detail)


async def auto_match_experiment_images(
    image_items: list[dict],
    candidates: list[dict],
    session: Session,
    include_debug: bool = False,
) -> dict:
    image_items = [
        item for item in (image_items or [])
        if item.get("index") is not None and str(item.get("url") or "").strip()
    ]
    if not image_items:
        raise ValueError("No images provided")
    if not candidates:
        raise ValueError("No experiment image slot candidates")

    prompt = build_image_assignment_prompt(
        candidates,
        image_count=len(image_items),
        image_indexes=[item.get("index") for item in image_items],
    )
    references = image_assignment_reference_images(candidates)
    debug_payload = {
        "request": {
            "task": AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
            "response_format": {"type": "json_object"},
            "prompt": prompt,
            "images": [
                {
                    "index": item.get("index"),
                    "name": item.get("name"),
                    "url": item.get("url"),
                }
                for item in image_items
            ],
            "references": references,
            "candidates": candidates,
            "candidate_count": len(candidates or []),
            "slot_count": sum(len(item.get("slots") or []) for item in candidates or []),
        }
    }
    provider = get_ai_provider(session)
    messages = [
        {"role": "user", "content": [{"type": "text", "text": prompt}]}
    ]
    for item in image_items:
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": _image_url_payload(item.get("url"))
        })
    for ref in references:
        messages[0]["content"].append({
            "type": "text",
            "text": f"候选参考图 {ref.get('candidateId')}：{ref.get('label')}",
        })
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": _image_url_payload(ref.get("path")),
        })

    raw_content = None
    try:
        response = await provider.chat_completion(
            task=AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH,
            messages=messages,
            response_format={"type": "json_object"},
            recognition_attempt=1,
        )
        raw_content = response.choices[0].message.content
        payload = parse_json_object_from_ai_response(raw_content)
        debug_payload["raw_response"] = raw_content
        debug_payload["parsed_response"] = payload
    except Exception as e:
        detail = ai_error_detail("AI 图片匹配失败", e)
        debug_payload["raw_response"] = raw_content
        debug_payload["error"] = {
            "message": detail,
            "type": type(e).__name__,
        }
        print(f"AI Image Assignment Error: {detail}")
        error = ValueError(detail)
        error.debug_payload = debug_payload
        raise error

    allowed_image_indexes = {int(item.get("index")) for item in image_items}
    current_image_index = next(iter(allowed_image_indexes))
    slot_candidate_ids = {
        slot.get("candidateId")
        for item in candidates
        for slot in (item.get("slots") or [])
    }
    normalized_matches = []
    slot_candidate_id = str(payload.get("slotCandidateId") or "").strip()
    if slot_candidate_id and slot_candidate_id in slot_candidate_ids:
        normalized_matches.append({
            "imageIndex": current_image_index,
            "slotCandidateId": slot_candidate_id,
        })
    normalized_unmatched = [] if normalized_matches else [{"imageIndex": current_image_index}]

    result = {"matches": normalized_matches, "unmatched": normalized_unmatched}
    if include_debug:
        debug_payload["normalized_result"] = result
        result["_debug"] = debug_payload
    return result

def parse_numbered_answers(text: str, questions: list[dict]) -> list[dict]:
    import re

    indexed = {int(q.get("index")): q for q in questions if q.get("index") is not None}
    if not text:
        return []

    pattern = re.compile(r"(?m)^\s*(\d+)[\.、\)]\s*")
    matches = list(pattern.finditer(text))
    if not matches:
        return []

    parsed = []
    for idx, match in enumerate(matches):
        question_index = int(match.group(1))
        question = indexed.get(question_index)
        if not question:
            continue
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        answer = text[start:end].strip()
        if answer:
            parsed.append({
                "index": question_index,
                "nodeId": question.get("nodeId"),
                "answer": answer,
            })
    return parsed

async def generate_answers(experiment_id: str, questions: list[dict], form_values: dict, session: Session) -> list[dict]:
    from services.experimentConfigStore import get_experiment_config

    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        raise ValueError(f"Experiment {experiment_id} not found")

    if not questions:
        return []

    db_template = session.get(AiPromptTemplate, experiment_id)
    prompt = build_generation_answers_prompt(questions, form_values, exp_config, db_template)

    provider = get_ai_provider(session)

    try:
        response = await provider.chat_completion(
            task=AI_TASK_ANSWER_GENERATION,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content.strip()
        try:
            payload = parse_json_object_from_ai_response(content)
            raw_answers = [
                {"index": key, "answer": value}
                for key, value in payload.items()
            ]
        except Exception:
            raw_answers = parse_numbered_answers(content, questions)

        by_index = {int(q.get("index")): q for q in questions if q.get("index") is not None}
        answers = []
        for raw in raw_answers:
            try:
                index = int(raw.get("index"))
            except (TypeError, ValueError):
                continue
            question = by_index.get(index)
            if not question:
                continue
            answer = str(raw.get("answer") or raw.get("text") or "").strip()
            if answer:
                answers.append({
                    "index": index,
                    "nodeId": question.get("nodeId"),
                    "answer": answer,
                })
        return answers
    except Exception as e:
        detail = ai_error_detail("AI 生成失败", e)
        print(f"AI Batch Generation Error: {detail}")
        raise ValueError(detail)

async def get_fixed_fill(experiment_id: str) -> dict:
    from services.experimentConfigStore import get_experiment_config
    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        return {}
    
    fixed_values = {}
    for field in exp_config.get("inputs", {}).get("fields", []):
        if field.get("type") == "fixed" and "value" in field:
            fixed_values[field["id"]] = field["value"]
            
    return fixed_values
