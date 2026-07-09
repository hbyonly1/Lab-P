import os
import json
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path(os.getenv("EXPERIMENT_CONFIG_DIR", Path(__file__).resolve().parents[1] / "configs"))

def get_experiment_config(experiment_id: str) -> Optional[dict]:
    """Reads the JSON configuration for a given experiment ID."""
    file_path = CONFIG_DIR / f"{experiment_id}.json"
    if not file_path.exists():
        return None
    
    try:
        with file_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading config for {experiment_id}: {e}")
        return None

def collect_ai_recognition_node_ids(exp_config: dict) -> list[str]:
    fields = exp_config.get("inputs", {}).get("fields", [])
    return [
        field.get("id")
        for field in fields
        if field.get("type") == "ai_recognize" and field.get("id")
    ]

def collect_ai_recognition_groups(exp_config: dict) -> list[dict]:
    recognition_config = ((exp_config or {}).get("ai") or {}).get("recognition") or {}
    all_node_ids = collect_ai_recognition_node_ids(exp_config)
    allowed_node_ids = set(all_node_ids)
    configured_groups = recognition_config.get("groups") or []
    groups = []

    for index, group in enumerate(configured_groups):
        if not isinstance(group, dict):
            continue
        image_ref = group.get("imageRef")
        node_ids = [
            node_id
            for node_id in (group.get("nodeIds") or [])
            if node_id in allowed_node_ids
        ]
        if not image_ref or not node_ids:
            continue
        groups.append({
            "id": group.get("id") or f"group_{index + 1}",
            "imageRef": image_ref,
            "nodeIds": node_ids,
            "extraPrompt": group.get("extraPrompt", ""),
            "required": group.get("required", True),
        })

    if groups:
        return groups

    image_ref = recognition_config.get("imageRef")
    if image_ref and all_node_ids:
        return [{
            "id": "default",
            "imageRef": image_ref,
            "nodeIds": all_node_ids,
            "extraPrompt": recognition_config.get("extraPrompt"),
            "required": True,
        }]

    return []

def find_ai_recognition_group(exp_config: dict, image_ref: Optional[str]) -> Optional[dict]:
    if not image_ref:
        return None
    for group in collect_ai_recognition_groups(exp_config):
        if group.get("imageRef") == image_ref:
            return group
    return None
