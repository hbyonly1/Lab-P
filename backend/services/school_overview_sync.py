from __future__ import annotations

import asyncio
import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select
from celery.exceptions import TimeoutError as CeleryTimeoutError

from api.v1.automation_config import CONFIG_SCHEMA_VERSION, default_automation_config
from core.db import engine
from core.school_password import SchoolPasswordError, decrypt_school_password
from models.core import AuditLog, AutomationEngineConfig, AutomationJob, SchoolSyncSnapshot, User, get_utc_now
from services.school_dom import SchoolDomTimeout, read_non_empty_text, wait_for_selector_count
from services.school_session_manager import school_session_manager, school_user_session_key
from worker.ai_tasks import recognize_captcha_task


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = BACKEND_ROOT / "tmp" / "school_overview_sync"


class SchoolAutomationError(Exception):
    def __init__(
        self,
        error_code: str,
        reason: str,
        *,
        message: Optional[str] = None,
        current_step: Optional[str] = None,
    ) -> None:
        self.error_code = error_code
        self.reason = reason
        self.message = message or reason
        self.current_step = current_step
        super().__init__(self.message)


@dataclass
class SchoolOverviewResult:
    real_name: Optional[str]
    experiments: List[Dict[str, str]]
    summary: Dict[str, Any]
    artifacts: Dict[str, str]
    messages: List[str]


@dataclass
class CaptchaRecognitionResult:
    code: str
    raw_text: str
    cleaned_text: str


def deep_get(value: Dict[str, Any], path: str, default: Any = None) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_active_config(session: Session) -> Dict[str, Any]:
    config = session.exec(
        select(AutomationEngineConfig)
        .where(AutomationEngineConfig.name == "default")
        .where(AutomationEngineConfig.is_active == True)  # noqa: E712
        .order_by(AutomationEngineConfig.id.desc())
    ).first()
    if not config or not config.config_json or config.schema_version != CONFIG_SCHEMA_VERSION:
        return default_automation_config()
    return config.config_json


def set_job_progress(job_id: str, message_code: str, message_params: Optional[Dict[str, Any]] = None) -> None:
    with Session(engine) as session:
        job = session.get(AutomationJob, job_id)
        if not job or job.status not in ["queued", "running", "retrying"]:
            return
        job.status = "running"
        job.public_status = "running"
        job.public_message_code = message_code
        if message_params is not None:
            job.public_message_params = message_params
        job.updated_at = get_utc_now()
        session.add(job)
        session.commit()


def normalize_score(value: Any) -> str:
    score = str(value or "").strip()
    if not score:
        return ""
    normalized = re.sub(r"\s+", "", score)
    if re.fullmatch(r"\d+(?:\.\d+)?", normalized):
        return normalized
    return ""


def map_school_status(raw_status: str, score: Any = None) -> str:
    if normalize_score(score):
        return "school_graded"
    normalized = (raw_status or "").strip()
    if normalized == "未提交":
        return "school_not_submitted"
    if normalized == "临时提交":
        return "school_draft_submitted"
    if normalized == "正常提交":
        return "school_final_submitted"
    return "school_unknown"


def summarize_experiments(experiments: List[Dict[str, str]], real_name: Optional[str]) -> Dict[str, Any]:
    total = len(experiments)
    unsubmitted = sum(1 for item in experiments if item.get("schoolStatus") == "school_not_submitted")
    draft = sum(1 for item in experiments if item.get("schoolStatus") == "school_draft_submitted")
    final = sum(1 for item in experiments if item.get("schoolStatus") == "school_final_submitted")
    graded = sum(1 for item in experiments if item.get("schoolStatus") == "school_graded")
    unknown = sum(1 for item in experiments if item.get("schoolStatus") == "school_unknown")
    return {
        "source": "school_complete_report_list",
        "realName": real_name,
        "total": total,
        "completed": draft + final + graded,
        "unsubmitted": unsubmitted,
        "draftSubmitted": draft,
        "finalSubmitted": final + graded,
        "graded": graded,
        "unknown": unknown,
    }


COMMON_OCR_WORDS = {
    "CODE",
    "TEXT",
    "FREE",
    "OCR",
    "IMAGE",
    "CAPTCHA",
}


def get_captcha_expected_length(config: Dict[str, Any]) -> int:
    value = deep_get(config, "captcha.expectedLength")
    if value in [None, ""]:
        raise SchoolAutomationError(
            "CONFIG_INVALID",
            "验证码长度配置缺失",
            current_step="school.overview.recognizingCaptcha",
        )
    expected_length = safe_int(value, 0)
    if expected_length <= 0:
        raise SchoolAutomationError(
            "CONFIG_INVALID",
            "验证码长度配置无效",
            current_step="school.overview.recognizingCaptcha",
        )
    return expected_length


def extract_captcha_candidate(raw_text: str, expected_length: int = 4) -> Optional[str]:
    raw = str(raw_text or "")
    cleaned = re.sub(r"[^0-9A-Za-z]", "", raw).upper()
    if len(cleaned) == expected_length:
        return cleaned

    tokens = [
        token.upper()
        for token in re.findall(r"[0-9A-Za-z]+", raw)
        if len(token) == expected_length and token.upper() not in COMMON_OCR_WORDS
    ]
    if tokens:
        return tokens[-1]
    return None


async def recognize_captcha(captcha_path: Path, config: Dict[str, Any]) -> CaptchaRecognitionResult:
    try:
        timeout_seconds = safe_int(deep_get(config, "captcha.timeoutSeconds"), 30) + 15
        image_b64 = base64.b64encode(captcha_path.read_bytes()).decode("ascii")
        task = recognize_captcha_task.delay(image_b64, config)
        result = await asyncio.to_thread(task.get, timeout=timeout_seconds, propagate=True)
    except CeleryTimeoutError as exc:
        raise SchoolAutomationError(
            "CAPTCHA_RETRY_EXHAUSTED",
            "验证码识别超时",
            message=f"worker task timeout: {exc}",
            current_step="school.overview.recognizingCaptcha",
        ) from exc
    except Exception as exc:
        raise SchoolAutomationError(
            "CAPTCHA_RETRY_EXHAUSTED",
            "验证码识别失败",
            message=str(exc),
            current_step="school.overview.recognizingCaptcha",
        ) from exc

    content = str((result or {}).get("raw_text") or "")
    cleaned = str((result or {}).get("cleaned_text") or "")
    expected_length = get_captcha_expected_length(config)
    captcha = extract_captcha_candidate(content, expected_length)
    if not captcha:
        reason = "验证码识别结果为空" if not cleaned else f"验证码识别结果不是 {expected_length} 位"
        raise SchoolAutomationError(
            "CAPTCHA_RETRY_EXHAUSTED",
            reason,
            message=f"raw={content!r}; cleaned={cleaned!r}",
            current_step="school.overview.recognizingCaptcha",
        )
    return CaptchaRecognitionResult(code=captcha, raw_text=content, cleaned_text=cleaned)


def write_debug_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def build_overview_failure_diagnostic(
    *,
    job: AutomationJob,
    user_id: int,
    error: SchoolAutomationError,
    config: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    config = config or {}
    school_system = config.get("schoolSystem") or {}
    runtime = config.get("runtime") or {}
    wait_policy = config.get("waitPolicy") or {}
    sync_policy = config.get("syncPolicy") or {}
    retry_policy = config.get("retryPolicy") or {}
    captcha = config.get("captcha") or {}
    return {
        "jobId": job.id,
        "userId": user_id,
        "action": job.action,
        "errorCode": error.error_code,
        "reason": error.reason,
        "message": error.message,
        "currentStep": error.current_step,
        "publicMessageCode": job.public_message_code,
        "request": {
            "source": (job.request_payload or {}).get("source"),
            "force": (job.request_payload or {}).get("force"),
        },
        "config": {
            "schoolSystem": {
                "baseUrl": school_system.get("baseUrl"),
                "loginUrl": school_system.get("loginUrl"),
            },
            "runtime": {
                "headless": runtime.get("headless"),
                "slowMoMs": runtime.get("slowMoMs"),
                "defaultTimeoutMs": runtime.get("defaultTimeoutMs"),
                "postLoginSettleMs": runtime.get("postLoginSettleMs"),
                "postLoginWaitMs": runtime.get("postLoginWaitMs"),
                "keepBrowserOpenAfterLogin": runtime.get("keepBrowserOpenAfterLogin"),
            },
            "waitPolicy": {
                "modalOpenTimeoutMs": wait_policy.get("modalOpenTimeoutMs"),
                "fieldWriteTimeoutMs": wait_policy.get("fieldWriteTimeoutMs"),
                "submitFeedbackTimeoutMs": wait_policy.get("submitFeedbackTimeoutMs"),
                "listRefreshTimeoutMs": wait_policy.get("listRefreshTimeoutMs"),
                "networkIdleTimeoutMs": wait_policy.get("networkIdleTimeoutMs"),
                "overviewStableMs": wait_policy.get("overviewStableMs"),
                "overviewPollMs": wait_policy.get("overviewPollMs"),
            },
            "syncPolicy": {
                "initialSync": sync_policy.get("initialSync"),
                "detailSync": sync_policy.get("detailSync"),
                "listCacheTtlSeconds": sync_policy.get("listCacheTtlSeconds"),
                "syncCooldownSeconds": sync_policy.get("syncCooldownSeconds"),
            },
            "retryPolicy": {
                "captchaMaxRetries": retry_policy.get("captchaMaxRetries"),
                "networkMaxRetries": retry_policy.get("networkMaxRetries"),
            },
            "captcha": {
                "task": captcha.get("task"),
                "expectedLength": captcha.get("expectedLength"),
            },
        },
    }


async def wait_for_loading_to_disappear(page: Any, timeout_ms: int) -> bool:
    try:
        await page.wait_for_function(
            """
            () => !Array.from(document.querySelectorAll('#ajaxInfo, .loadingLayout, .loading')).some((el) => {
              const style = getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity || 1) > 0
                && rect.width > 0
                && rect.height > 0;
            })
            """,
            timeout=timeout_ms,
        )
        return True
    except Exception:
        return False


async def extract_real_name(page: Any, config: Dict[str, Any], timeout_ms: int = 5000) -> Optional[str]:
    selector = deep_get(config, "selectors.dashboard.realNameText", "#LoginUserName")
    try:
        return await read_non_empty_text(page, selector, timeout_ms=timeout_ms)
    except SchoolDomTimeout:
        return None


async def extract_report_list(page: Any, config: Dict[str, Any], timeout_ms: int = 30000) -> List[Dict[str, str]]:
    row_selector = deep_get(
        config,
        "selectors.dashboard.reportTableRows",
        "tbody[data-bind='foreach: CompleteReportList'] tr",
    )
    columns = deep_get(config, "selectors.reportList.columns", {}) or {}
    experiment_idx = safe_int(columns.get("experimentName"), 0)
    status_idx = safe_int(columns.get("status"), 6)
    score_idx = safe_int(columns.get("score"), 7)
    try:
        await wait_for_selector_count(page, row_selector, min_count=1, timeout_ms=timeout_ms)
    except SchoolDomTimeout:
        return []
    raw_items = await page.evaluate(
        """
        ({ rowSelector, experimentIdx, statusIdx, scoreIdx }) => {
          return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
            const cells = Array.from(row.querySelectorAll('td')).map((cell) =>
              (cell.innerText || cell.textContent || '').replace(/\\s+/g, ' ').trim()
            );
            return {
              experimentName: cells[experimentIdx] || '',
              originalStatusText: cells[statusIdx] || '',
              score: scoreIdx >= 0 ? (cells[scoreIdx] || '') : ''
            };
          }).filter((item) => item.experimentName || item.originalStatusText);
        }
        """,
        {
            "rowSelector": row_selector,
            "experimentIdx": experiment_idx,
            "statusIdx": status_idx,
            "scoreIdx": score_idx,
        },
    )
    return [
        {
            "experimentName": item.get("experimentName", ""),
            "originalStatusText": item.get("originalStatusText", ""),
            "score": normalize_score(item.get("score", "")),
            "schoolStatus": map_school_status(item.get("originalStatusText", ""), item.get("score", "")),
        }
        for item in raw_items
    ]


async def wait_and_extract_overview(
    page: Any,
    config: Dict[str, Any],
    timeout_ms: int,
    *,
    stable_ms: int,
    poll_ms: int,
) -> Dict[str, Any]:
    real_name_selector = deep_get(config, "selectors.dashboard.realNameText", "#LoginUserName")
    row_selector = deep_get(
        config,
        "selectors.dashboard.reportTableRows",
        "tbody[data-bind='foreach: CompleteReportList'] tr",
    )
    columns = deep_get(config, "selectors.reportList.columns", {}) or {}
    experiment_idx = safe_int(columns.get("experimentName"), 0)
    status_idx = safe_int(columns.get("status"), 6)
    score_idx = safe_int(columns.get("score"), 7)
    deadline = asyncio.get_running_loop().time() + max(timeout_ms, 1) / 1000
    last_snapshot: Optional[Dict[str, Any]] = None
    stable_since: Optional[float] = None

    while True:
        snapshot = await page.evaluate(
            """
            ({ realNameSelector, rowSelector, experimentIdx, statusIdx, scoreIdx }) => {
              const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
              const realNameNode = document.querySelector(realNameSelector);
              const realName = normalize(realNameNode && (realNameNode.innerText || realNameNode.textContent));
              const rows = Array.from(document.querySelectorAll(rowSelector));
              const experiments = rows.map((row) => {
                const cells = Array.from(row.querySelectorAll('td')).map((cell) =>
                  normalize(cell.innerText || cell.textContent)
                );
                return {
                  experimentName: cells[experimentIdx] || '',
                  originalStatusText: cells[statusIdx] || '',
                  score: scoreIdx >= 0 ? (cells[scoreIdx] || '') : '',
                  rowText: normalize(row.innerText || row.textContent)
                };
              }).filter((item) => item.experimentName || item.originalStatusText);
              return {
                ready: Boolean(realName && experiments.length > 0),
                realName,
                experiments,
                rowCount: experiments.length,
                firstRow: experiments[0]?.rowText || '',
                lastRow: experiments[experiments.length - 1]?.rowText || ''
              };
            }
            """,
            {
                "realNameSelector": real_name_selector,
                "rowSelector": row_selector,
                "experimentIdx": experiment_idx,
                "statusIdx": status_idx,
                "scoreIdx": score_idx,
            },
        )
        now = asyncio.get_running_loop().time()
        stable_key = json.dumps(
            {
                "realName": snapshot.get("realName"),
                "rowCount": snapshot.get("rowCount"),
                "firstRow": snapshot.get("firstRow"),
                "lastRow": snapshot.get("lastRow"),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        last_key = None
        if last_snapshot:
            last_key = json.dumps(
                {
                    "realName": last_snapshot.get("realName"),
                    "rowCount": last_snapshot.get("rowCount"),
                    "firstRow": last_snapshot.get("firstRow"),
                    "lastRow": last_snapshot.get("lastRow"),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        if snapshot.get("ready") and stable_key == last_key:
            if stable_since is None:
                stable_since = now
            if now - stable_since >= max(stable_ms, 1) / 1000:
                experiments = [
                    {
                        "experimentName": item.get("experimentName", ""),
                        "originalStatusText": item.get("originalStatusText", ""),
                        "score": normalize_score(item.get("score", "")),
                        "schoolStatus": map_school_status(item.get("originalStatusText", ""), item.get("score", "")),
                    }
                    for item in snapshot.get("experiments", [])
                ]
                return {
                    "real_name": snapshot.get("realName") or None,
                    "experiments": experiments,
                    "readySnapshot": snapshot,
                }
        else:
            stable_since = None
        last_snapshot = snapshot
        if now >= deadline:
            raise SchoolAutomationError(
                "OVERVIEW_DATA_NOT_READY",
                "学校概览页面关键节点未稳定加载",
                message=json.dumps(
                    {
                        "realNameSelector": real_name_selector,
                        "rowSelector": row_selector,
                        "timeoutMs": timeout_ms,
                        "stableMs": stable_ms,
                        "pollMs": poll_ms,
                        "lastSnapshot": snapshot,
                    },
                    ensure_ascii=False,
                ),
                current_step="school.overview.readingList",
            )
        await page.wait_for_timeout(max(poll_ms, 1))


async def extract_login_messages(page: Any) -> List[str]:
    try:
        texts = await page.evaluate(
            """
            () => {
              const isVisible = (el) => {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && Number(style.opacity || 1) > 0
                  && rect.width > 0
                  && rect.height > 0;
              };
              const selectors = [
                '.bootbox.modal.in .bootbox-body',
                '.bootbox-body',
                '.modal.in .modal-body',
                '.modal.show .modal-body',
                '.alert',
                '.help-block',
                '.has-error'
              ];
              const messages = [];
              for (const selector of selectors) {
                for (const el of Array.from(document.querySelectorAll(selector))) {
                  if (!isVisible(el)) continue;
                  const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
                  if (text) messages.push(text);
                }
              }
              return Array.from(new Set(messages)).slice(0, 20);
            }
            """
        )
    except Exception:
        return []
    keywords = re.compile(r"(错误|失败|验证码|密码|用户名|登录|超时|失效|error|fail|invalid)", re.I)
    return [text[:300] for text in texts if keywords.search(text)]


def is_captcha_error_message(message: str) -> bool:
    return "验证码" in message and any(keyword in message for keyword in ["不正确", "错误", "失败", "无效"])


def is_credential_error_message(message: str) -> bool:
    return any(keyword in message for keyword in ["密码", "用户名", "账号"]) and any(
        keyword in message for keyword in ["错误", "失败", "不正确", "无效"]
    )


async def close_login_error_modal(page: Any) -> None:
    for selector in [
        ".bootbox.modal.in .bootbox-close-button",
        ".bootbox.modal.in [data-dismiss='modal']",
        ".bootbox-close-button",
        "[data-dismiss='modal']",
    ]:
        try:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click()
                await page.wait_for_timeout(300)
                return
        except Exception:
            continue


async def save_login_failure_artifacts(
    page: Any,
    *,
    out_dir: Path,
    attempt: int,
    messages: List[str],
    artifacts: Dict[str, str],
) -> None:
    screenshot_path = out_dir / f"03_login_failed_attempt_{attempt}.png"
    html_path = out_dir / f"03_login_failed_attempt_{attempt}.html"
    messages_path = out_dir / f"03_login_failed_attempt_{attempt}.json"
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        artifacts[f"login_failed_screenshot_attempt_{attempt}"] = str(screenshot_path)
    except Exception:
        pass
    try:
        html_path.write_text(await page.content(), encoding="utf-8")
        artifacts[f"login_failed_html_attempt_{attempt}"] = str(html_path)
    except Exception:
        pass
    try:
        write_debug_json(messages_path, {"attempt": attempt, "messages": messages, "url": page.url})
        artifacts[f"login_failed_messages_attempt_{attempt}"] = str(messages_path)
    except Exception:
        pass


async def check_login_error_feedback(
    page: Any,
    *,
    out_dir: Path,
    attempt: int,
    captcha_max_retries: int,
    messages: List[str],
    artifacts: Dict[str, str],
) -> str:
    login_messages = await extract_login_messages(page)
    if not login_messages:
        return "none"

    for message in login_messages:
        if message not in messages:
            messages.append(message)

    if any(is_captcha_error_message(message) for message in login_messages):
        await save_login_failure_artifacts(
            page,
            out_dir=out_dir,
            attempt=attempt,
            messages=login_messages,
            artifacts=artifacts,
        )
        if attempt < captcha_max_retries:
            await close_login_error_modal(page)
            await page.wait_for_timeout(300)
            return "captcha_retry"
        raise SchoolAutomationError(
            "CAPTCHA_RETRY_EXHAUSTED",
            "验证码多次校验失败",
            message="; ".join(login_messages[:3]),
            current_step="school.overview.recognizingCaptcha",
        )

    if any(is_credential_error_message(message) for message in login_messages):
        await save_login_failure_artifacts(
            page,
            out_dir=out_dir,
            attempt=attempt,
            messages=login_messages,
            artifacts=artifacts,
        )
        raise SchoolAutomationError(
            "CREDENTIAL_FAILED",
            "学校系统账号或密码错误",
            message="; ".join(login_messages[:3]),
            current_step="school.overview.loggingIn",
        )

    return "none"


async def save_overview_read_failure_artifacts(
    page: Any,
    *,
    out_dir: Path,
    config: Dict[str, Any],
    real_name: Optional[str],
    experiments: List[Dict[str, str]],
    artifacts: Dict[str, str],
) -> None:
    screenshot_path = out_dir / "03_overview_read_incomplete.png"
    html_path = out_dir / "03_overview_read_incomplete.html"
    diagnostic_path = out_dir / "03_overview_read_incomplete.json"
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        artifacts["overview_read_incomplete_screenshot"] = str(screenshot_path)
    except Exception:
        pass
    try:
        html_path.write_text(await page.content(), encoding="utf-8")
        artifacts["overview_read_incomplete_html"] = str(html_path)
    except Exception:
        pass
    try:
        real_name_selector = deep_get(config, "selectors.dashboard.realNameText", "#LoginUserName")
        row_selector = deep_get(
            config,
            "selectors.dashboard.reportTableRows",
            "tbody[data-bind='foreach: CompleteReportList'] tr",
        )
        dom_snapshot = await page.evaluate(
            """
            ({ realNameSelector, rowSelector }) => {
              const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
              const realNameNode = document.querySelector(realNameSelector);
              const rows = Array.from(document.querySelectorAll(rowSelector));
              return {
                realNameSelector,
                rowSelector,
                realNameNodeExists: Boolean(realNameNode),
                realNameText: normalize(realNameNode && (realNameNode.innerText || realNameNode.textContent)),
                rowCount: rows.length,
                firstRows: rows.slice(0, 3).map((row) => normalize(row.innerText || row.textContent))
              };
            }
            """,
            {"realNameSelector": real_name_selector, "rowSelector": row_selector},
        )
        write_debug_json(
            diagnostic_path,
            {
                "url": page.url,
                "hasRealName": bool(real_name),
                "experimentCount": len(experiments),
                "waitPolicy": config.get("waitPolicy"),
                "domSnapshot": dom_snapshot,
            },
        )
        artifacts["overview_read_incomplete_diagnostic"] = str(diagnostic_path)
    except Exception:
        pass


def school_login_password_for_user(user: User) -> str:
    try:
        return decrypt_school_password(user.encrypted_school_password)
    except SchoolPasswordError as exc:
        raise SchoolAutomationError(
            "CREDENTIAL_FAILED",
            "当前账号缺少可用的学校系统密码",
            message=str(exc),
            current_step="school.overview.openingLogin",
        ) from exc


async def perform_school_overview_sync(
    *,
    job_id: str,
    user: User,
    config: Dict[str, Any],
) -> SchoolOverviewResult:
    if not user.student_no:
        raise SchoolAutomationError("CREDENTIAL_FAILED", "当前账号缺少学号")
    school_password = school_login_password_for_user(user)

    set_job_progress(job_id, "school.overview.connecting")

    try:
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError
        from playwright.async_api import async_playwright
    except Exception as exc:
        raise SchoolAutomationError(
            "UNKNOWN_LOGIN_RESULT",
            "Playwright 运行环境不可用",
            message=str(exc),
            current_step="school.overview.connecting",
        ) from exc

    login_url = deep_get(config, "schoolSystem.loginUrl")
    if not login_url:
        raise SchoolAutomationError(
            "NETWORK_UNREACHABLE",
            "学校系统登录地址未配置",
            current_step="school.overview.openingLogin",
        )
    login_selectors = deep_get(config, "selectors.login", {}) or {}
    username_selector = login_selectors.get("username") or "#userName"
    password_selector = login_selectors.get("password") or "#userPass"
    captcha_selector = login_selectors.get("captchaInput") or "#checkCode"
    captcha_image_selector = login_selectors.get("captchaImage") or "#imgCheckCode"
    submit_selector = login_selectors.get("submit") or ".loginBut"

    runtime = config.get("runtime") or {}
    wait_policy = config.get("waitPolicy") or {}
    retry_policy = config.get("retryPolicy") or {}
    default_timeout_ms = safe_int(runtime.get("defaultTimeoutMs"), 30000)
    post_login_settle_ms = safe_int(runtime.get("postLoginSettleMs"), 2000)
    post_login_wait_ms = safe_int(runtime.get("postLoginWaitMs"), 10000)
    network_idle_timeout_ms = safe_int(wait_policy.get("networkIdleTimeoutMs"), default_timeout_ms)
    overview_data_timeout_ms = safe_int(wait_policy.get("listRefreshTimeoutMs"), post_login_wait_ms)
    overview_stable_ms = safe_int(wait_policy.get("overviewStableMs"), 1000)
    overview_poll_ms = safe_int(wait_policy.get("overviewPollMs"), 250)
    captcha_max_retries = max(safe_int(retry_policy.get("captchaMaxRetries"), 3), 1)
    if "keepBrowserOpenAfterLogin" not in runtime:
        raise SchoolAutomationError(
            "CONFIG_INVALID",
            "浏览器保留配置缺失",
            current_step="school.overview.connecting",
        )
    keep_browser_open = bool(runtime["keepBrowserOpenAfterLogin"])

    out_dir = ARTIFACT_ROOT / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts: Dict[str, str] = {}
    messages: List[str] = []
    saw_school_captcha_error = False

    existing_page, session_diagnostic = await school_session_manager.ensure_report_list(user.id, config)
    if existing_page:
        set_job_progress(job_id, "school.overview.readingList")
        try:
            overview_data = await wait_and_extract_overview(
                existing_page,
                config,
                overview_data_timeout_ms,
                stable_ms=overview_stable_ms,
                poll_ms=overview_poll_ms,
            )
        except SchoolAutomationError:
            await save_overview_read_failure_artifacts(
                existing_page,
                out_dir=out_dir,
                config=config,
                real_name=None,
                experiments=[],
                artifacts=artifacts,
            )
            raise
        real_name = overview_data["real_name"]
        experiments = overview_data["experiments"]
        if not real_name or not experiments:
            await save_overview_read_failure_artifacts(
                existing_page,
                out_dir=out_dir,
                config=config,
                real_name=real_name,
                experiments=experiments,
                artifacts=artifacts,
            )
            missing_parts = []
            if not real_name:
                missing_parts.append("real_name")
            if not experiments:
                missing_parts.append("report_list")
            raise SchoolAutomationError(
                "OVERVIEW_DATA_INCOMPLETE",
                "学校概览关键数据未读取完整",
                message=json.dumps(
                    {
                        "missing": missing_parts,
                        "url": existing_page.url,
                        "artifactKeys": sorted(artifacts.keys()),
                        "sessionDiagnostic": session_diagnostic,
                    },
                    ensure_ascii=False,
                ),
                current_step="school.overview.readingList",
            )
        after_screenshot = out_dir / "03_after_reused_session.png"
        await existing_page.screenshot(path=str(after_screenshot), full_page=True)
        artifacts["after_reused_session_screenshot"] = str(after_screenshot)
        artifacts["kept_browser_session"] = school_user_session_key(user.id)
        artifacts["session_reuse_decision"] = session_diagnostic.get("reuseDecision", "")
        return SchoolOverviewResult(
            real_name=real_name,
            experiments=experiments,
            summary=summarize_experiments(experiments, real_name),
            artifacts=artifacts,
            messages=messages,
        )
    if session_diagnostic.get("hasSession"):
        await school_session_manager.close(user.id, reason="overview_relogin_required")

    playwright = await async_playwright().start()
    try:
        browser = await playwright.chromium.launch(
            headless=bool(runtime.get("headless", False)),
            slow_mo=safe_int(runtime.get("slowMoMs"), 0),
        )
    except Exception as exc:
        await playwright.stop()
        message = f"{type(exc).__name__}: {exc}"
        if "XServer" in message or "headed browser" in message:
            raise SchoolAutomationError(
                "BROWSER_HEADLESS_REQUIRED",
                "Docker 环境无法打开可视浏览器，请切换 Headless",
                message=message,
                current_step="school.overview.connecting",
            ) from exc
        raise
    context = await browser.new_context(
        viewport={"width": 1440, "height": 1000},
        locale="zh-CN",
        timezone_id="Asia/Shanghai",
    )
    page = await context.new_page()
    page.set_default_timeout(default_timeout_ms)
    page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))
    should_keep_browser_open = False

    try:
        set_job_progress(job_id, "school.overview.openingLogin")
        try:
            await page.goto(login_url, wait_until="domcontentloaded")
        except Exception as exc:
            raise SchoolAutomationError(
                "NETWORK_UNREACHABLE",
                "学校系统登录页无法打开",
                message=f"{type(exc).__name__}: {exc}",
                current_step="school.overview.openingLogin",
            ) from exc
        try:
            await page.wait_for_load_state("networkidle", timeout=network_idle_timeout_ms)
        except PlaywrightTimeoutError:
            messages.append("登录页网络静默等待超时，继续执行登录流程")

        login_screenshot = out_dir / "01_login_page.png"
        await page.screenshot(path=str(login_screenshot), full_page=True)
        artifacts["login_screenshot"] = str(login_screenshot)

        for attempt in range(1, captcha_max_retries + 1):
            if attempt > 1:
                set_job_progress(job_id, "school.overview.retryingCaptcha")
            else:
                set_job_progress(job_id, "school.overview.loggingIn")
            missing = []
            for name, selector in [
                ("username", username_selector),
                ("password", password_selector),
                ("submit", submit_selector),
            ]:
                if await page.locator(selector).count() == 0:
                    missing.append(name)
            if missing:
                raise SchoolAutomationError(
                    "SELECTOR_MISSING",
                    "学校登录页结构已变化",
                    message=f"Missing login selectors: {', '.join(missing)}",
                    current_step="school.overview.openingLogin",
                )

            await page.locator(username_selector).fill(user.student_no)
            await page.locator(password_selector).fill(school_password)

            if await page.locator(captcha_selector).count() > 0:
                if await page.locator(captcha_image_selector).count() == 0:
                    raise SchoolAutomationError(
                        "SELECTOR_MISSING",
                        "学校验证码图片节点缺失",
                        current_step="school.overview.recognizingCaptcha",
                    )
                set_job_progress(job_id, "school.overview.recognizingCaptcha")
                captcha_path = out_dir / f"02_captcha_attempt_{attempt}.png"
                await page.locator(captcha_image_selector).first.screenshot(path=str(captcha_path))
                artifacts[f"captcha_image_attempt_{attempt}"] = str(captcha_path)
                try:
                    captcha = await recognize_captcha(captcha_path, config)
                except SchoolAutomationError as exc:
                    messages.append(f"第 {attempt} 次验证码识别失败：{exc.reason}")
                    write_debug_json(
                        out_dir / f"02_captcha_attempt_{attempt}.json",
                        {
                            "attempt": attempt,
                            "errorCode": exc.error_code,
                            "reason": exc.reason,
                            "message": exc.message,
                        },
                    )
                    if exc.error_code == "CONFIG_INVALID" or "未配置" in exc.reason:
                        raise
                    if attempt >= captcha_max_retries:
                        reason = "验证码多次校验失败" if saw_school_captcha_error else "验证码多次识别失败"
                        raise SchoolAutomationError(
                            "CAPTCHA_RETRY_EXHAUSTED",
                            reason,
                            message="; ".join(messages[-5:]),
                            current_step="school.overview.recognizingCaptcha",
                        ) from exc
                    await page.wait_for_timeout(300)
                    continue
                write_debug_json(
                    out_dir / f"02_captcha_attempt_{attempt}.json",
                    {
                        "attempt": attempt,
                        "rawText": captcha.raw_text,
                        "cleanedText": captcha.cleaned_text,
                        "codeLength": len(captcha.code),
                    },
                )
                await page.locator(captcha_selector).fill(captcha.code)

            set_job_progress(job_id, "school.overview.loggingIn")
            before_url = page.url
            await page.locator(submit_selector).click()
            set_job_progress(job_id, "school.overview.checkingLogin")
            try:
                await page.wait_for_load_state("networkidle", timeout=network_idle_timeout_ms)
            except PlaywrightTimeoutError:
                messages.append("登录提交后网络静默等待超时，继续检查页面状态")
            await page.wait_for_timeout(post_login_settle_ms)
            await wait_for_loading_to_disappear(page, post_login_wait_ms)

            login_feedback = await check_login_error_feedback(
                page,
                out_dir=out_dir,
                attempt=attempt,
                captcha_max_retries=captcha_max_retries,
                messages=messages,
                artifacts=artifacts,
            )
            if login_feedback == "captcha_retry":
                saw_school_captcha_error = True
                continue

            set_job_progress(job_id, "school.overview.readingList")
            try:
                overview_data = await wait_and_extract_overview(
                    page,
                    config,
                    overview_data_timeout_ms,
                    stable_ms=overview_stable_ms,
                    poll_ms=overview_poll_ms,
                )
            except SchoolAutomationError:
                login_feedback = await check_login_error_feedback(
                    page,
                    out_dir=out_dir,
                    attempt=attempt,
                    captcha_max_retries=captcha_max_retries,
                    messages=messages,
                    artifacts=artifacts,
                )
                if login_feedback == "captcha_retry":
                    saw_school_captcha_error = True
                    continue
                await save_overview_read_failure_artifacts(
                    page,
                    out_dir=out_dir,
                    config=config,
                    real_name=None,
                    experiments=[],
                    artifacts=artifacts,
                )
                raise

            real_name = overview_data["real_name"]
            experiments = overview_data["experiments"]
            login_feedback = await check_login_error_feedback(
                page,
                out_dir=out_dir,
                attempt=attempt,
                captcha_max_retries=captcha_max_retries,
                messages=messages,
                artifacts=artifacts,
            )
            if login_feedback == "captcha_retry":
                saw_school_captcha_error = True
                continue

            if not real_name or not experiments:
                await save_overview_read_failure_artifacts(
                    page,
                    out_dir=out_dir,
                    config=config,
                    real_name=real_name,
                    experiments=experiments,
                    artifacts=artifacts,
                )
                missing_parts = []
                if not real_name:
                    missing_parts.append("real_name")
                if not experiments:
                    missing_parts.append("report_list")
                raise SchoolAutomationError(
                    "OVERVIEW_DATA_INCOMPLETE",
                    "学校概览关键数据未读取完整",
                    message=json.dumps(
                        {
                            "missing": missing_parts,
                            "url": page.url,
                            "artifactKeys": sorted(artifacts.keys()),
                        },
                        ensure_ascii=False,
                    ),
                    current_step="school.overview.readingList",
                )

            if real_name and experiments:
                after_screenshot = out_dir / "03_after_login.png"
                await page.screenshot(path=str(after_screenshot), full_page=True)
                artifacts["after_login_screenshot"] = str(after_screenshot)
                if keep_browser_open:
                    should_keep_browser_open = True
                    artifacts["kept_browser_session"] = school_user_session_key(user.id)
                summary = summarize_experiments(experiments, real_name)
                return SchoolOverviewResult(
                    real_name=real_name,
                    experiments=experiments,
                    summary=summary,
                    artifacts=artifacts,
                    messages=messages,
                )

        raise SchoolAutomationError(
            "CAPTCHA_RETRY_EXHAUSTED",
            "验证码多次校验失败" if saw_school_captcha_error else "验证码多次识别失败",
            message="; ".join(messages[-3:]) if messages else "Login stayed on login page after captcha retries.",
            current_step="school.overview.recognizingCaptcha",
        )
    finally:
        if should_keep_browser_open:
            school_session_manager.register(
                user_id=user.id,
                job_id=job_id,
                playwright=playwright,
                browser=browser,
                context=context,
                page=page,
                source="overview_login",
            )
        else:
            await context.close()
            await browser.close()
            await playwright.stop()


def mark_overview_success(
    session: Session,
    *,
    job: AutomationJob,
    user: User,
    result: SchoolOverviewResult,
) -> None:
    now = get_utc_now()
    if result.real_name:
        user.real_name = result.real_name
        session.add(user)

    snapshot = SchoolSyncSnapshot(
        user_id=user.id,
        snapshot_json={
            "source": "school_complete_report_list",
            "realName": result.real_name,
            "experiments": result.experiments,
        },
        summary_json=result.summary,
        synced_at=now,
        automation_job_id=job.id,
    )
    job.status = "succeeded"
    job.public_status = "succeeded"
    job.public_message_code = "school.overview.success"
    job.result_payload = {
        "summary": result.summary,
        "messages": result.messages[-10:],
        "artifacts": result.artifacts,
    }
    job.finished_at = now
    job.updated_at = now
    session.add(snapshot)
    session.add(job)
    session.add(
        AuditLog(
            user_id=user.id,
            action="school_overview_sync_completed",
            status="success",
            target_id=job.id,
            details="学校概览同步已完成。",
        )
    )


def mark_overview_failed(
    session: Session,
    *,
    job: AutomationJob,
    user_id: int,
    error: SchoolAutomationError,
    config: Optional[Dict[str, Any]] = None,
) -> None:
    now = get_utc_now()
    diagnostic = build_overview_failure_diagnostic(job=job, user_id=user_id, error=error, config=config)
    job.status = "failed"
    job.public_status = "failed"
    job.public_message_code = "school.overview.failed"
    job.public_message_params = {"reason": error.reason}
    job.error_code = error.error_code
    job.error_message = error.message[:1000]
    job.result_payload = {
        "currentStep": error.current_step,
        "errorCode": error.error_code,
        "diagnosticPayload": diagnostic,
    }
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    session.add(
        AuditLog(
            user_id=user_id,
            action="school_overview_sync_failed",
            status="failed",
            target_id=job.id,
            details=json.dumps(diagnostic, ensure_ascii=False, indent=2),
        )
    )


def run_school_overview_sync(job_id: str, user_id: int) -> None:
    config: Optional[Dict[str, Any]] = None
    close_session_after_finish = False
    try:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            config = load_active_config(session)
            close_session_after_finish = bool((job.request_payload or {}).get("closeSessionAfterFinish"))

        async def _run() -> SchoolOverviewResult:
            async with school_session_manager.user_operation(user.id):
                return await perform_school_overview_sync(job_id=job_id, user=user, config=config)

        result = school_session_manager.run(_run())

        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            user = session.get(User, user_id)
            if not job or not user or job.status not in ["queued", "running", "retrying"]:
                return
            set_job_progress(job_id, "school.overview.savingSnapshot")
            mark_overview_success(session, job=job, user=user, result=result)
            session.commit()
    except SchoolAutomationError as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            mark_overview_failed(session, job=job, user_id=user_id, error=exc, config=config)
            session.commit()
    except (SQLAlchemyError, Exception) as exc:
        with Session(engine) as session:
            job = session.get(AutomationJob, job_id)
            if not job:
                return
            mark_overview_failed(
                session,
                job=job,
                user_id=user_id,
                error=SchoolAutomationError(
                    "UNKNOWN_LOGIN_RESULT",
                    "学校系统同步异常",
                    message=str(exc),
                    current_step=job.public_message_code,
                ),
                config=config,
            )
            session.commit()
    finally:
        if close_session_after_finish:
            try:
                school_session_manager.run(
                    school_session_manager.close(user_id, reason="overview_sync_close_session_after_finish")
                )
            except Exception:
                pass
