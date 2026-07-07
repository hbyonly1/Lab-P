import os
import json
import base64
import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from sqlmodel import Session, select
from models.core import AiPromptTemplate
from core.ai_prompts import build_recognition_prompt, build_generation_answers_prompt
from services.ai_provider import (
    AI_TASK_ANSWER_GENERATION,
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

async def recognize_images(
    experiment_id: str,
    image_paths: list[str],
    session: Session,
    recognition_attempt: int = 1,
) -> dict:
    from services.experimentConfigStore import get_experiment_config, collect_ai_recognition_node_ids
    
    exp_config = get_experiment_config(experiment_id)
    if not exp_config:
        raise ValueError(f"Experiment {experiment_id} not found")
        
    db_template = session.get(AiPromptTemplate, experiment_id)
    
    recognition_node_ids = collect_ai_recognition_node_ids(exp_config)
    
    if not recognition_node_ids:
        return {} # Nothing to extract
        
    prompt = build_recognition_prompt(exp_config, recognition_node_ids, db_template)
    
    provider = get_ai_provider(session)
    
    messages = [
        {"role": "user", "content": [{"type": "text", "text": prompt}]}
    ]
    
    for path in image_paths:
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": {"url": image_path_to_model_url(path)}
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
