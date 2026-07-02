from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from core.db import get_session
from models.core import Experiment, User, AuditLog
from api.deps import get_current_user, get_current_admin
from services.experiment_seed import seed_experiment_configs
from services.experiment_seed import CONFIG_DIR
from services.experiment_seed import stable_json_hash
from services.experiment_seed import file_mtime_datetime
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime
import simpleeval
import json

router = APIRouter()

class ComputeRequest(BaseModel):
    current_form_values: Dict[str, Any]

class UpdateFormulasRequest(BaseModel):
    formulas: Dict[str, str]

class UpdateExperimentRawConfigRequest(BaseModel):
    config_json: Dict[str, Any]

class ExperimentListItem(BaseModel):
    id: str
    name: str
    version: str
    status: str = "not_started"
    sort_order: int = 9999
    enabled: bool = True
    inputs: Dict[str, Any] = {}
    updated_at: Optional[datetime] = None
    config_file_mtime: Optional[datetime] = None

class RefreshExperimentConfigsResponse(BaseModel):
    scanned: int
    created: int
    changed: int
    unchanged: int
    failed: List[Dict[str, str]]
    changed_ids: List[str]

class ExperimentConfigResponse(BaseModel):
    id: str
    title: str
    version: str
    config_json: Dict[str, Any]

class ExperimentRawConfigResponse(BaseModel):
    id: str
    title: str
    version: str
    file_path: str
    config_json: Dict[str, Any]

def experiment_config_file_path(experiment_id: str):
    if "/" in experiment_id or "\\" in experiment_id or ".." in experiment_id:
        raise HTTPException(status_code=400, detail="Invalid experiment id")
    config_path = (CONFIG_DIR / f"{experiment_id}.json").resolve()
    config_root = CONFIG_DIR.resolve()
    if config_path.parent != config_root:
        raise HTTPException(status_code=400, detail="Invalid experiment config path")
    return config_path

def read_experiment_config_from_file(experiment_id: str) -> Optional[Dict[str, Any]]:
    config_path = experiment_config_file_path(experiment_id)
    if not config_path.exists():
        return None
    try:
        with config_path.open("r", encoding="utf-8") as f:
            config_json = json.load(f)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Experiment config file is invalid JSON: {exc}")
    return config_json

def config_enabled(meta: Dict[str, Any]) -> bool:
    value = meta.get("enabled", True)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off", "disabled"}
    return value is not False

def config_sort_order(meta: Dict[str, Any]) -> int:
    value = meta.get("sortOrder", 9999)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 9999

def experiment_visible_to_user(experiment: Experiment, current_user: User) -> bool:
    if current_user.role != "student":
        return True
    config = experiment.config_json or {}
    meta = config.get("meta") or {}
    return config_enabled(meta)

def config_list_item(experiment: Experiment) -> ExperimentListItem:
    config = experiment.config_json or {}
    meta = config.get("meta") or {}
    return ExperimentListItem(
        id=experiment.id,
        name=meta.get("name") or experiment.title,
        version=meta.get("version") or experiment.version,
        status=meta.get("status") or "not_started",
        sort_order=config_sort_order(meta),
        enabled=config_enabled(meta),
        inputs=config.get("inputs") or {},
        updated_at=experiment.updated_at,
        config_file_mtime=experiment.config_file_mtime,
    )

def save_experiment_config_to_file_and_db(
    experiment: Experiment,
    config_json: Dict[str, Any],
    config_path,
) -> Dict[str, Any]:
    old_hash = experiment.config_hash or stable_json_hash(experiment.config_json or {})
    new_hash = stable_json_hash(config_json)
    meta = config_json.get("meta") or {}

    with config_path.open("w", encoding="utf-8") as f:
        json.dump(config_json, f, ensure_ascii=False, indent=2)
        f.write("\n")

    file_mtime = file_mtime_datetime(config_path)
    experiment.title = meta.get("name") or experiment.title
    experiment.version = meta.get("version") or experiment.version
    experiment.config_file_mtime = file_mtime
    experiment.config_hash = new_hash

    if old_hash != new_hash:
        experiment.config_json = config_json
        experiment.updated_at = datetime.now(file_mtime.tzinfo)

    return {
        "old_hash": old_hash,
        "new_hash": new_hash,
        "changed": old_hash != new_hash,
        "file_mtime": file_mtime,
    }

@router.get("", response_model=List[ExperimentListItem])
def list_experiments(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    statement = select(Experiment).where(Experiment.id != "UPGRADE_PLAN")
    experiments = session.exec(statement).all()
    items = [
        config_list_item(experiment)
        for experiment in experiments
        if experiment.config_json and experiment_visible_to_user(experiment, current_user)
    ]
    return sorted(items, key=lambda item: (item.sort_order, item.name, item.id))

@router.post("/refresh-configs", response_model=RefreshExperimentConfigsResponse)
def refresh_experiment_configs(
    session: Session = Depends(get_session),
    current_admin: User = Depends(get_current_admin)
):
    stats = seed_experiment_configs(session)
    log = AuditLog(
        user_id=current_admin.id,
        action="refresh_experiment_configs",
        status="success",
        target_id="experiments",
        details=json.dumps(stats, ensure_ascii=False),
    )
    session.add(log)
    session.commit()
    return stats

@router.get("/{experiment_id}", response_model=ExperimentConfigResponse)
def get_experiment_config(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    experiment = session.get(Experiment, experiment_id)
    if not experiment or not experiment.config_json:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if not experiment_visible_to_user(experiment, current_user):
        raise HTTPException(status_code=404, detail="Experiment not found")
    return ExperimentConfigResponse(
        id=experiment.id,
        title=experiment.title,
        version=experiment.version,
        config_json=experiment.config_json,
    )

@router.get("/{experiment_id}/raw-config", response_model=ExperimentRawConfigResponse)
def get_experiment_raw_config(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_admin: User = Depends(get_current_admin)
):
    experiment = session.get(Experiment, experiment_id)
    if not experiment or not experiment.config_json:
        raise HTTPException(status_code=404, detail="Experiment not found")

    config_path = experiment_config_file_path(experiment_id)
    source_config_json = read_experiment_config_from_file(experiment_id) or experiment.config_json
    return ExperimentRawConfigResponse(
        id=experiment.id,
        title=experiment.title,
        version=experiment.version,
        file_path=str(config_path.relative_to(CONFIG_DIR.resolve())),
        config_json=source_config_json,
    )

@router.patch("/{experiment_id}/raw-config", response_model=ExperimentRawConfigResponse)
def update_experiment_raw_config(
    experiment_id: str,
    req: UpdateExperimentRawConfigRequest,
    session: Session = Depends(get_session),
    current_admin: User = Depends(get_current_admin)
):
    config_json = req.config_json
    if not config_json or not isinstance(config_json, dict):
        raise HTTPException(status_code=422, detail="config_json must be a non-empty JSON object")

    meta = config_json.get("meta") or {}
    meta_id = meta.get("id")
    if meta_id and meta_id != experiment_id:
        raise HTTPException(status_code=422, detail="config_json.meta.id must match experiment_id")

    config_path = experiment_config_file_path(experiment_id)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    experiment = session.get(Experiment, experiment_id)

    title = meta.get("name") or (experiment.title if experiment else experiment_id)
    version = meta.get("version") or (experiment.version if experiment else "1.0")

    if experiment:
        save_result = save_experiment_config_to_file_and_db(experiment, config_json, config_path)
    else:
        new_hash = stable_json_hash(config_json)
        with config_path.open("w", encoding="utf-8") as f:
            json.dump(config_json, f, ensure_ascii=False, indent=2)
            f.write("\n")
        file_mtime = file_mtime_datetime(config_path)
        experiment = Experiment(
            id=experiment_id,
            title=title,
            version=version,
            config_json=config_json,
            mapping_json={},
            config_file_mtime=file_mtime,
            config_hash=new_hash,
        )
        session.add(experiment)
        save_result = {
            "old_hash": None,
            "new_hash": new_hash,
            "changed": True,
            "file_mtime": file_mtime,
        }

    log = AuditLog(
        user_id=current_admin.id,
        action="update_experiment_raw_config",
        status="success",
        target_id=experiment_id,
        details=json.dumps({
            "experiment_id": experiment_id,
            "title": title,
            "file_path": str(config_path.relative_to(CONFIG_DIR.resolve())),
            "old_hash": save_result["old_hash"],
            "new_hash": save_result["new_hash"],
            "changed": save_result["changed"],
        }, ensure_ascii=False),
    )
    session.add(log)
    session.commit()

    return ExperimentRawConfigResponse(
        id=experiment.id,
        title=experiment.title,
        version=experiment.version,
        file_path=str(config_path.relative_to(CONFIG_DIR.resolve())),
        config_json=config_json,
    )

@router.post("/{experiment_id}/compute")
def compute_experiment_data(
    experiment_id: str,
    req: ComputeRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if not experiment_visible_to_user(experiment, current_user):
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    formulas = experiment.config_json.get("formulas", {})
    if not formulas:
        formulas = {}
        
    form_values = dict(req.current_form_values)
    
    max_iterations = 10
    changed = True
    
    evaluator = simpleeval.SimpleEval()
    
    for _ in range(max_iterations):
        if not changed:
            break
        changed = False
        
        # update evaluator namespace
        names = {}
        for k, v in form_values.items():
            try:
                if isinstance(v, str) and v.strip() != "":
                    names[k] = float(v)
                else:
                    names[k] = v
            except ValueError:
                names[k] = v
        evaluator.names = names
        
        # Allow accessing via vals['key'] for complex node ids like "N10-0"
        evaluator.names['vals'] = names
        
        for target_node, formula_str in formulas.items():
            if not formula_str:
                continue
            try:
                result = evaluator.eval(formula_str)
                # Keep up to 4 decimal places for floats
                if isinstance(result, float):
                    result_str = f"{result:.4g}"
                else:
                    result_str = str(result)
                    
                if form_values.get(target_node) != result_str:
                    form_values[target_node] = result_str
                    changed = True
            except Exception as e:
                # print(f"Formula evaluation failed for {target_node}: {e}")
                pass
                
    # Record audit log
    original_values = dict(req.current_form_values)
    computed_changes = {k: v for k, v in form_values.items() if original_values.get(k) != v}
    
    details_str = (
        f"执行了实验【{experiment.title}】的公式计算。\n"
        f"调用参数：{json.dumps(original_values, ensure_ascii=False)}\n"
        f"计算结果（变动项）：{json.dumps(computed_changes, ensure_ascii=False)}"
    )

    log = AuditLog(
        user_id=current_user.id,
        action="compute_experiment",
        status="success",
        target_id=experiment_id,
        details=details_str
    )
    session.add(log)
    session.commit()
    
    return {"computed_values": form_values}

@router.put("/{experiment_id}/formulas")
def update_experiment_formulas(
    experiment_id: str,
    req: UpdateFormulasRequest,
    session: Session = Depends(get_session),
    current_admin: User = Depends(get_current_admin)
):
    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    config = dict(experiment.config_json) if experiment.config_json else {}
    config["formulas"] = req.formulas
    config_path = experiment_config_file_path(experiment_id)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    save_result = save_experiment_config_to_file_and_db(experiment, config, config_path)
    
    log = AuditLog(
        user_id=current_admin.id,
        action="update_experiment_formulas",
        status="success",
        target_id=experiment_id,
        details=json.dumps({
            "experiment_id": experiment_id,
            "file_path": str(config_path.relative_to(CONFIG_DIR.resolve())),
            "formula_count": len(req.formulas),
            "old_hash": save_result["old_hash"],
            "new_hash": save_result["new_hash"],
            "changed": save_result["changed"],
        }, ensure_ascii=False),
    )
    session.add(log)
    session.add(experiment)
    session.commit()
    
    return {"message": "Formulas updated successfully", "formulas": req.formulas}

@router.get("/{experiment_id}/formulas")
def get_experiment_formulas(
    experiment_id: str,
    session: Session = Depends(get_session),
    current_admin: User = Depends(get_current_admin)
):
    experiment = session.get(Experiment, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    formulas = experiment.config_json.get("formulas", {}) if experiment.config_json else {}
    return {"formulas": formulas}
