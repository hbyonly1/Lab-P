from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.deps import get_current_admin
from core.db import get_session
from models.core import AuditLog, AutomationEngineConfig, User, get_utc_now

router = APIRouter()

CONFIG_SCHEMA_VERSION = "1.5"
REQUIRED_TOP_LEVEL_KEYS = {
    "schoolSystem",
    "identity",
    "selectors",
    "safety",
    "captcha",
    "syncPolicy",
    "retryPolicy",
    "runtime",
    "waitPolicy",
}


class AutomationConfigResponse(BaseModel):
    id: int
    name: str
    config_json: Dict[str, Any]
    schema_version: str
    is_active: bool
    created_by: Optional[int] = None
    updated_by: Optional[int] = None


class AutomationConfigUpdate(BaseModel):
    name: str = Field(default="default")
    config_json: Dict[str, Any]
    schema_version: str = Field(default=CONFIG_SCHEMA_VERSION)
    is_active: bool = Field(default=True)


def default_automation_config() -> Dict[str, Any]:
    return {
        "_comment": "学校系统自动化配置。只保存入口、选择器、运行参数和策略，不保存 Playwright 脚本代码。",
        "schoolSystem": {
            "_comment": "学校实验报告系统入口。",
            "baseUrl": "http://10.25.77.60:8001",
            "loginUrl": "http://10.25.77.60:8001/Login",
        },
        "identity": {
            "_comment": "学校系统账号使用 users.student_no，密码使用 users.encrypted_school_password 解密结果；登录后姓名写入 users.real_name。",
            "studentNoField": "users.student_no",
            "realNameField": "users.real_name",
            "passwordPolicy": "encrypted_user_password",
        },
        "selectors": {
            "_comment": "学校系统 DOM 选择器。重复节点后续使用 selector + index 或所在行定位。",
            "login": {
                "username": "#userName",
                "password": "#userPass",
                "captchaInput": "#checkCode",
                "captchaImage": "#imgCheckCode",
                "submit": ".loginBut",
            },
            "dashboard": {
                "realNameText": "#LoginUserName",
                "reportNav": "#reportA",
                "reportTableRows": "tbody[data-bind='foreach: CompleteReportList'] tr",
            },
            "reportList": {
                "_comment": "列表同步只保存实验名和提交状态；其它列暂不入库。",
                "columns": {
                    "experimentName": 0,
                    "status": 6,
                },
                "openReportButtonText": "完成报告",
            },
            "modal": {
                "_comment": "实验详情按需加载时使用；具体字段选择器后续按真实 modal 补齐。",
                "root": "#ReportModal",
                "content": "#ReportModal #content",
                "saveDraft": "#ReportModal button:has-text('临时提交')",
                "submitFinal": "#ReportModal button:has-text('正式提交')",
                "close": "#ReportModal button:has-text('关闭')",
            },
        },
        "safety": {
            "_comment": "高风险动作保护。按需读取和同步 modal 时必须跳过这些按钮；正式提交只允许由 final_submit job 在用户二次确认后触发。",
            "forbiddenActions": {
                "finalSubmit": {
                    "policy": "never_click",
                    "texts": ["正式提交"],
                    "selectors": [
                        "#ReportModal button:has-text('正式提交')",
                        "button:has-text('正式提交')",
                        "input[value='正式提交']",
                    ],
                }
            },
        },
        "captcha": {
            "_comment": "验证码识别运行时使用统一 AI Provider；具体模型、prompt 和超时在 Admin AI 设置页维护。",
            "task": "captcha",
            "expectedLength": 4,
        },
        "syncPolicy": {
            "_comment": "首次登录只同步姓名和实验列表；实验详情在用户点进实验时按需打开 modal 读取。",
            "initialSync": "identity_and_report_list",
            "detailSync": "on_demand",
            "listCacheTtlSeconds": 600,
            "syncCooldownSeconds": 1800,
        },
        "retryPolicy": {
            "captchaMaxRetries": 3,
            "credentialMaxRetries": 1,
            "networkMaxRetries": 2,
            "selectorMaxRetries": 1,
        },
        "runtime": {
            "_comment": "headless=false 表示打开可视浏览器窗口；userSessionIdleTtlSeconds=0 表示平台不主动关闭会话。",
            "headless": False,
            "slowMoMs": 250,
            "defaultTimeoutMs": 30000,
            "postLoginSettleMs": 2000,
            "postLoginWaitMs": 10000,
            "keepBrowserOpenAfterLogin": True,
            "userSessionIdleTtlSeconds": 0,
            "schoolSessionMaxAgeSeconds": 7200,
        },
        "waitPolicy": {
            "_comment": "学校页面节点稳定等待策略。关键 DOM 读写必须使用这些超时，不靠固定 sleep 判断成功。",
            "afterClickMs": 300,
            "afterInputMs": 100,
            "afterImageUploadMs": 1000,
            "modalOpenTimeoutMs": 15000,
            "fieldWriteTimeoutMs": 10000,
            "imageWriteTimeoutMs": 20000,
            "submitFeedbackTimeoutMs": 30000,
            "listRefreshTimeoutMs": 30000,
            "networkIdleTimeoutMs": 10000,
            "overviewStableMs": 1000,
            "overviewPollMs": 250,
        },
    }


def validate_config_payload(config_json: Dict[str, Any]) -> None:
    if not isinstance(config_json, dict):
        raise HTTPException(status_code=422, detail="config_json must be a JSON object.")

    missing = sorted(REQUIRED_TOP_LEVEL_KEYS - set(config_json.keys()))
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing config_json keys: {', '.join(missing)}")

    identity = config_json.get("identity") or {}
    if identity.get("passwordPolicy") != "encrypted_user_password":
        raise HTTPException(status_code=422, detail="identity.passwordPolicy must be encrypted_user_password.")

    captcha = config_json.get("captcha") or {}
    if captcha.get("expectedLength") is None:
        raise HTTPException(status_code=422, detail="captcha.expectedLength is required.")
    try:
        expected_length = int(captcha.get("expectedLength"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="captcha.expectedLength must be a positive integer.") from None
    if expected_length <= 0:
        raise HTTPException(status_code=422, detail="captcha.expectedLength must be a positive integer.")

    sync_policy = config_json.get("syncPolicy") or {}
    try:
        sync_cooldown_seconds = int(sync_policy.get("syncCooldownSeconds"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="syncPolicy.syncCooldownSeconds must be a non-negative integer.") from None
    if sync_cooldown_seconds < 0:
        raise HTTPException(status_code=422, detail="syncPolicy.syncCooldownSeconds must be a non-negative integer.")

    runtime = config_json.get("runtime") or {}
    if "keepBrowserOpenAfterLogin" not in runtime:
        raise HTTPException(status_code=422, detail="runtime.keepBrowserOpenAfterLogin is required.")
    if not isinstance(runtime.get("keepBrowserOpenAfterLogin"), bool):
        raise HTTPException(status_code=422, detail="runtime.keepBrowserOpenAfterLogin must be boolean.")

    for group_name, fields in {
        "runtime": ["defaultTimeoutMs", "postLoginSettleMs", "postLoginWaitMs"],
        "waitPolicy": [
            "modalOpenTimeoutMs",
            "fieldWriteTimeoutMs",
            "submitFeedbackTimeoutMs",
            "listRefreshTimeoutMs",
            "networkIdleTimeoutMs",
            "overviewStableMs",
            "overviewPollMs",
        ],
    }.items():
        group = config_json.get(group_name) or {}
        for field in fields:
            try:
                value = int(group.get(field))
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"{group_name}.{field} must be a positive integer.") from None
            if value <= 0:
                raise HTTPException(status_code=422, detail=f"{group_name}.{field} must be a positive integer.")

    if "playwrightScript" in config_json or "script" in config_json:
        raise HTTPException(status_code=422, detail="config_json cannot contain Playwright script code.")


def is_current_config_shape(config_json: Dict[str, Any]) -> bool:
    try:
        validate_config_payload(config_json)
    except HTTPException:
        return False
    return True


@router.get("", response_model=AutomationConfigResponse)
def get_automation_config(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationEngineConfig:
    config = session.exec(
        select(AutomationEngineConfig)
        .where(AutomationEngineConfig.name == "default")
        .order_by(AutomationEngineConfig.id.desc())
    ).first()
    if not config:
        config = AutomationEngineConfig(
            name="default",
            config_json=default_automation_config(),
            schema_version=CONFIG_SCHEMA_VERSION,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
    elif config.schema_version != CONFIG_SCHEMA_VERSION or not is_current_config_shape(config.config_json):
        config.config_json = default_automation_config()
        config.schema_version = CONFIG_SCHEMA_VERSION
        config.updated_by = current_user.id
        config.updated_at = get_utc_now()
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


@router.patch("", response_model=AutomationConfigResponse)
def update_automation_config(
    req: AutomationConfigUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> AutomationEngineConfig:
    validate_config_payload(req.config_json)

    config = session.exec(
        select(AutomationEngineConfig)
        .where(AutomationEngineConfig.name == req.name)
        .order_by(AutomationEngineConfig.id.desc())
    ).first()

    if not config:
        config = AutomationEngineConfig(
            name=req.name,
            created_by=current_user.id,
        )

    config.config_json = req.config_json
    config.schema_version = req.schema_version
    config.is_active = req.is_active
    config.updated_by = current_user.id
    config.updated_at = get_utc_now()
    session.add(config)
    session.flush()

    session.add(
        AuditLog(
            user_id=current_user.id,
            action="automation_config_updated",
            status="success",
            target_id=str(config.id),
            details=f"Updated automation config {config.name}",
        )
    )
    session.commit()
    session.refresh(config)
    return config
