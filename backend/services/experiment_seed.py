import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone

from models.core import Experiment
from models.core import get_utc_now


CONFIG_DIR = Path(__file__).resolve().parents[1] / "configs"


def stable_json_hash(payload) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def file_mtime_datetime(config_path: Path) -> datetime:
    return datetime.fromtimestamp(config_path.stat().st_mtime, tz=timezone.utc)


def seed_experiment_configs(session) -> dict:
    stats = {
        "scanned": 0,
        "created": 0,
        "changed": 0,
        "unchanged": 0,
        "failed": [],
        "changed_ids": [],
    }
    if not CONFIG_DIR.exists():
        return stats

    for config_path in sorted(CONFIG_DIR.glob("*.json")):
        stats["scanned"] += 1
        try:
            with config_path.open("r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as exc:
            stats["failed"].append({"file": config_path.name, "error": str(exc)})
            continue

        meta = config.get("meta") or {}
        experiment_id = meta.get("id") or config_path.stem
        title = meta.get("name") or experiment_id
        version = meta.get("version") or "1.0"
        new_hash = stable_json_hash(config)
        file_mtime = file_mtime_datetime(config_path)

        experiment = session.get(Experiment, experiment_id)
        if experiment:
            old_hash = experiment.config_hash or stable_json_hash(experiment.config_json or {})
            has_changed = old_hash != new_hash
            experiment.title = title
            experiment.version = version
            experiment.config_file_mtime = file_mtime
            experiment.config_hash = new_hash
            if has_changed:
                experiment.config_json = config
                experiment.updated_at = get_utc_now()
                stats["changed"] += 1
                stats["changed_ids"].append(experiment_id)
            else:
                stats["unchanged"] += 1
        else:
            experiment = Experiment(
                id=experiment_id,
                title=title,
                version=version,
                config_json=config,
                mapping_json={},
                config_file_mtime=file_mtime,
                config_hash=new_hash,
                updated_at=get_utc_now(),
            )
            session.add(experiment)
            stats["created"] += 1
            stats["changed_ids"].append(experiment_id)

    session.commit()
    return stats
