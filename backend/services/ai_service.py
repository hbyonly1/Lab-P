import os
import json
from sqlmodel import Session, select
from models.core import AiPromptTemplate
from core.ai_prompts import build_recognition_prompt, build_generation_answers_prompt
from services.ai_provider import (
    AI_TASK_ANSWER_GENERATION,
    AI_TASK_IMAGE_RECOGNITION,
    get_ai_provider,
)

async def recognize_images(experiment_id: str, image_paths: list[str], session: Session) -> dict:
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
    
    # 组装图片
    for path in image_paths:
        # TODO: 将本地路径转为 URL 或 Base64 (依赖图片存储方式，这里假设可以用URL，如果不能则需要 base64)
        # 这里简单将绝对路径/相对路径处理为可被大模型访问的形式
        # 暂时如果是本地路径无法直接访问，通常需先 base64 编码
        import base64
        if os.path.exists(path):
            with open(path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
                # 简单判断后缀
                ext = path.split('.')[-1].lower()
                mime = f"image/{ext}" if ext in ['png', 'jpeg', 'jpg', 'webp'] else "image/jpeg"
                url = f"data:{mime};base64,{encoded_string}"
        else:
            url = path # 可能是 http 开头的公网URL
            
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": {"url": url}
        })
        
    try:
        response = await provider.chat_completion(
            task=AI_TASK_IMAGE_RECOGNITION,
            messages=messages,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        result_dict = json.loads(content)
        
        # 过滤只保留我们想要的 keys
        filtered = {k: str(v) for k, v in result_dict.items() if k in recognition_node_ids}
        return filtered
        
    except Exception as e:
        print(f"AI Recognition Error: {e}")
        raise ValueError("AI 识别失败，请检查配置或稍后重试")

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
            payload = json.loads(content)
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
        print(f"AI Batch Generation Error: {e}")
        raise ValueError("AI 生成失败，请检查配置或稍后重试")

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
