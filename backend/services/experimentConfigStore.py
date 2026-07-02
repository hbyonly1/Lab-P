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
