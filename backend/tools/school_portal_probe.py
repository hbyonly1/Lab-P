"""Probe the school report system login page with Playwright.

This tool captures page evidence for building the real automation worker. It
can optionally fill student credentials and submit the login form when a manual
captcha value is provided. It never prints or stores the school password.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from api.v1.automation_config import default_automation_config
from core.config import settings


DEFAULT_LOGIN_URL = "http://10.25.77.60:8001/Login"
DEFAULT_OUTPUT_ROOT = Path("backend/tmp/school_portal_probe")
DEFAULT_AI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_AI_MODEL = "gpt-4o"

LOGIN_SELECTORS = {
    "username": "#userName",
    "password": "#userPass",
    "captcha": "#checkCode",
    "captcha_image": "#imgCheckCode",
    "submit": ".loginBut",
}


def deep_get(value: dict[str, Any], path: str, default: Any = None) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def load_config(config_path: str | None) -> dict[str, Any]:
    if not config_path:
        return default_automation_config()
    return json.loads(Path(config_path).read_text(encoding="utf-8"))


def login_selectors_from_config(config: dict[str, Any]) -> dict[str, str]:
    login = deep_get(config, "selectors.login", {}) or {}
    return {
        "username": login.get("username") or LOGIN_SELECTORS["username"],
        "password": login.get("password") or LOGIN_SELECTORS["password"],
        "captcha": login.get("captchaInput") or login.get("captcha") or LOGIN_SELECTORS["captcha"],
        "captcha_image": login.get("captchaImage") or login.get("captcha_image") or LOGIN_SELECTORS["captcha_image"],
        "submit": login.get("submit") or LOGIN_SELECTORS["submit"],
    }


def apply_config_defaults(args: argparse.Namespace) -> argparse.Namespace:
    config = load_config(args.config_json)
    runtime = config.get("runtime") or {}
    captcha = config.get("captcha") or {}

    args.config = config
    args.url = args.url or deep_get(config, "schoolSystem.loginUrl", DEFAULT_LOGIN_URL)
    args.headless = runtime.get("headless", False) if args.headless is None else args.headless
    args.slow_mo = runtime.get("slowMoMs", args.slow_mo)
    args.timeout_ms = runtime.get("defaultTimeoutMs", args.timeout_ms)
    args.post_login_settle_ms = runtime.get("postLoginSettleMs", args.post_login_settle_ms)
    args.post_login_wait_ms = runtime.get("postLoginWaitMs", args.post_login_wait_ms)
    args.user_session_idle_ttl_seconds = runtime.get(
        "userSessionIdleTtlSeconds",
        args.user_session_idle_ttl_seconds,
    )
    args.captcha_ai_base_url = args.captcha_ai_base_url or captcha.get("baseUrl") or settings.AI_BASE_URL or DEFAULT_AI_BASE_URL
    args.captcha_ai_model = args.captcha_ai_model or captcha.get("model") or settings.AI_CAPTCHA_MODEL or DEFAULT_AI_MODEL
    args.captcha_ai_prompt = (
        args.captcha_ai_prompt
        or captcha.get("prompt")
        or "OCR this captcha. Return exactly one token: the 4-character uppercase code."
    )
    args.captcha_ai_timeout = args.captcha_ai_timeout or captcha.get("timeoutSeconds") or 30
    args.configured_login_selectors = login_selectors_from_config(config)
    return args


def mask_student_no(student_no: str) -> str:
    if len(student_no) <= 6:
        return "***"
    return f"{student_no[:3]}****{student_no[-4:]}"


def write_text(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


async def save_html(page: Page, path: Path) -> None:
    write_text(path, await page.content())


def chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def recognize_captcha_with_ai_sync(captcha_path: Path, args: argparse.Namespace) -> str:
    api_key = os.getenv("AI_API_KEY") or settings.AI_API_KEY
    if not api_key:
        raise RuntimeError("缺少环境变量 AI_API_KEY")

    image_b64 = base64.b64encode(captcha_path.read_bytes()).decode("ascii")
    payload = {
        "model": args.captcha_ai_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                    {"type": "text", "text": args.captcha_ai_prompt},
                ],
            }
        ],
        "temperature": 0,
    }
    request = urllib.request.Request(
        chat_completions_url(args.captcha_ai_base_url),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=args.captcha_ai_timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"验证码 AI HTTP {exc.code}: {body}") from exc

    content = (
        result.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    captcha = re.sub(r"[^0-9A-Za-z]", "", str(content)).upper()
    if not captcha:
        raise RuntimeError("验证码 AI 返回为空")
    return captcha[:8]


async def recognize_captcha_with_ai(captcha_path: Path, args: argparse.Namespace) -> str:
    return await asyncio.to_thread(recognize_captcha_with_ai_sync, captcha_path, args)


async def summarize_dom(page: Page) -> dict[str, Any]:
    return await page.evaluate(
        """
        () => {
          const visibleText = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
          const attrs = (el, names) => Object.fromEntries(names.map((name) => [name, el.getAttribute(name)]));
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          };
          const redactValue = (el) => {
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'password') return '<redacted>';
            return el.value ? '<present>' : '';
          };
          return {
            url: location.href,
            title: document.title,
            forms: Array.from(document.querySelectorAll('form, #loginForm')).map((el, index) => ({
              index,
              tag: el.tagName.toLowerCase(),
              text: visibleText(el).slice(0, 300),
              rect: rect(el),
              attrs: attrs(el, ['id', 'name', 'class', 'action', 'method'])
            })),
            inputs: Array.from(document.querySelectorAll('input, textarea, select')).map((el, index) => ({
              index,
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || '',
              value: redactValue(el),
              placeholder: el.getAttribute('placeholder') || '',
              rect: rect(el),
              attrs: attrs(el, ['id', 'name', 'class', 'maxlength', 'autocomplete', 'onclick', 'onkeypress'])
            })),
            buttons: Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], a')).map((el, index) => ({
              index,
              tag: el.tagName.toLowerCase(),
              text: (visibleText(el) || el.value || '').slice(0, 200),
              rect: rect(el),
              attrs: attrs(el, ['id', 'name', 'class', 'type', 'href', 'onclick', 'value'])
            })),
            images: Array.from(document.querySelectorAll('img')).map((el, index) => ({
              index,
              src: el.currentSrc || el.src || el.getAttribute('src') || '',
              alt: el.getAttribute('alt') || '',
              title: el.getAttribute('title') || '',
              rect: rect(el),
              attrs: attrs(el, ['id', 'name', 'class', 'onclick', 'width', 'height'])
            })),
            scripts: Array.from(document.scripts).map((el) => el.src || '<inline>').slice(0, 80),
            localStorageKeys: Object.keys(localStorage).sort(),
            sessionStorageKeys: Object.keys(sessionStorage).sort()
          };
        }
        """
    )


def score_login_candidates(dom: dict[str, Any]) -> dict[str, Any]:
    inputs = dom.get("inputs", [])
    buttons = dom.get("buttons", [])
    images = dom.get("images", [])

    def hay(item: dict[str, Any]) -> str:
        attrs = item.get("attrs", {})
        return " ".join(
            str(v or "")
            for v in [
                item.get("type"),
                item.get("placeholder"),
                item.get("text"),
                attrs.get("id"),
                attrs.get("name"),
                attrs.get("class"),
                attrs.get("onclick"),
                item.get("alt"),
                item.get("title"),
                item.get("src"),
            ]
        ).lower()

    username = next(
        (
            i
            for i in inputs
            if any(k in hay(i) for k in ["username", "user", "userid", "user_name", "学号", "用户名"])
            and i.get("type", "").lower() not in ["password", "hidden", "button", "submit"]
        ),
        None,
    )
    if not username:
        username = next((i for i in inputs if i.get("type", "").lower() in ["text", ""]), None)

    password = next((i for i in inputs if i.get("type", "").lower() == "password"), None)

    captcha = next(
        (
            i
            for i in inputs
            if any(k in hay(i) for k in ["captcha", "checkcode", "verify", "验证码", "code"])
            and i.get("type", "").lower() not in ["hidden", "button", "submit"]
        ),
        None,
    )
    captcha_image = next(
        (
            i
            for i in images
            if any(k in hay(i) for k in ["captcha", "checkcode", "verify", "验证码", "denglu", "ashx", "点击刷新"])
        ),
        None,
    )
    submit = next(
        (
            i
            for i in buttons
            if any(k in hay(i) for k in ["login", "登录", "loginbut"])
        ),
        None,
    )

    return {
        "username": username,
        "password": password,
        "captcha": captcha,
        "captcha_image": captcha_image,
        "submit": submit,
    }


async def selector_exists(page: Page, selector: str) -> bool:
    try:
        return await page.locator(selector).count() > 0
    except Exception:
        return False


async def resolve_selectors(page: Page, dom: dict[str, Any]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {}
    configured = getattr(page, "_labp_login_selectors", LOGIN_SELECTORS)
    for key, selector in configured.items():
        resolved[key] = selector if await selector_exists(page, selector) else None

    candidates = score_login_candidates(dom)
    for key, item in candidates.items():
        if resolved.get(key) or not item:
            continue
        attrs = item.get("attrs", {})
        element_id = attrs.get("id")
        name = attrs.get("name")
        if element_id:
            resolved[key] = f"#{element_id}"
        elif name:
            resolved[key] = f"[name={json.dumps(name)}]"
    return resolved


async def extract_message_candidates(page: Page) -> list[str]:
    texts = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('.bootbox, .modal, .alert, .help-block, .has-error, body'))
          .map((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 20)
        """
    )
    keywords = re.compile(r"(错误|失败|验证码|密码|用户名|登录|超时|失效|error|fail|invalid)", re.I)
    return [text[:500] for text in texts if keywords.search(text)]


async def wait_for_visible_loading_to_disappear(page: Page, timeout_ms: int) -> bool:
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
    except PlaywrightTimeoutError:
        return False


async def extract_real_name(page: Page, config: dict[str, Any]) -> str | None:
    selector = deep_get(config, "selectors.dashboard.realNameText", "#LoginUserName")
    try:
        locator = page.locator(selector).first
        if await locator.count() == 0:
            return None
        text = (await locator.inner_text()).strip()
        return text or None
    except Exception:
        return None


async def extract_school_report_list(page: Page, config: dict[str, Any]) -> list[dict[str, str]]:
    row_selector = deep_get(
        config,
        "selectors.dashboard.reportTableRows",
        "tbody[data-bind='foreach: CompleteReportList'] tr",
    )
    columns = deep_get(config, "selectors.reportList.columns", {}) or {}
    experiment_idx = int(columns.get("experimentName", 2))
    status_idx = int(columns.get("status", 6))

    return await page.evaluate(
        """
        ({ rowSelector, experimentIdx, statusIdx }) => {
          return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
            const cells = Array.from(row.querySelectorAll('td')).map((cell) =>
              (cell.innerText || cell.textContent || '').replace(/\\s+/g, ' ').trim()
            );
            return {
              experimentName: cells[experimentIdx] || '',
              status: cells[statusIdx] || ''
            };
          }).filter((item) => item.experimentName || item.status);
        }
        """,
        {
            "rowSelector": row_selector,
            "experimentIdx": experiment_idx,
            "statusIdx": status_idx,
        },
    )


def summarize_school_report_list(items: list[dict[str, str]]) -> dict[str, Any]:
    total = len(items)
    unsubmitted = sum(1 for item in items if item.get("status") == "未提交")
    completed = sum(1 for item in items if item.get("status") and item.get("status") != "未提交")
    return {
        "total": total,
        "completed": completed,
        "unsubmitted": unsubmitted,
    }


async def collect_forbidden_action_targets(page: Page, config: dict[str, Any]) -> list[dict[str, str]]:
    forbidden = deep_get(config, "safety.forbiddenActions", {}) or {}
    results: list[dict[str, str]] = []
    for action, action_config in forbidden.items():
        if action_config.get("policy") != "never_click":
            continue
        selectors = action_config.get("selectors") or []
        texts = action_config.get("texts") or []
        for selector in selectors:
            try:
                count = await page.locator(selector).count()
            except Exception:
                count = 0
            if count:
                results.append({"action": action, "type": "selector", "value": selector, "count": str(count)})
        for text in texts:
            try:
                count = await page.get_by_text(text, exact=True).count()
            except Exception:
                count = 0
            if count:
                results.append({"action": action, "type": "text", "value": text, "count": str(count)})
    return results


def save_school_snapshot(report: dict[str, Any], user_id: int, real_name: str | None, items: list[dict[str, str]]) -> None:
    from sqlmodel import Session

    from core.db import engine
    from models.core import SchoolSyncSnapshot, User

    with Session(engine) as session:
        user = session.get(User, user_id)
        if user and real_name:
            user.real_name = real_name
            session.add(user)
        snapshot = SchoolSyncSnapshot(
            user_id=user_id,
            snapshot_json={
                "source": "school_complete_report_list",
                "experiments": items,
            },
            summary_json=summarize_school_report_list(items),
        )
        session.add(snapshot)
        session.commit()
        report["school_snapshot_id"] = snapshot.id


async def probe(args: argparse.Namespace) -> dict[str, Any]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) / f"{timestamp}_{mask_student_no(args.student_no)}"
    out_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "status": "started",
        "student_no_masked": mask_student_no(args.student_no),
        "login_url": args.url,
        "out_dir": str(out_dir),
        "artifacts": {},
        "selectors": {},
        "captcha": {"source": args.captcha_source, "recognized": False},
        "schoolReportList": [],
        "schoolReportSummary": {"total": 0, "completed": 0, "unsubmitted": 0},
        "forbiddenActionTargets": [],
        "messages": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=args.headless, slow_mo=args.slow_mo)
        context = await browser.new_context(
            viewport={"width": args.viewport_width, "height": args.viewport_height},
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
        )
        page = await context.new_page()
        page._labp_login_selectors = args.configured_login_selectors
        page.set_default_timeout(args.timeout_ms)
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))

        try:
            await page.goto(args.url, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=args.timeout_ms)
            except PlaywrightTimeoutError:
                report["messages"].append("页面网络静默等待超时，继续保存已加载内容")

            login_png = out_dir / "01_login_page.png"
            login_html = out_dir / "01_login_page.html"
            login_dom = out_dir / "01_login_dom.json"
            await page.screenshot(path=str(login_png), full_page=True)
            await save_html(page, login_html)
            dom = await summarize_dom(page)
            write_json(login_dom, dom)
            report["artifacts"].update(
                {
                    "login_screenshot": str(login_png),
                    "login_html": str(login_html),
                    "login_dom": str(login_dom),
                }
            )

            selectors = await resolve_selectors(page, dom)
            report["selectors"] = selectors
            write_json(out_dir / "02_selector_candidates.json", score_login_candidates(dom))

            captcha_selector = selectors.get("captcha_image")
            captcha_path = None
            if captcha_selector and await selector_exists(page, captcha_selector):
                captcha_path = out_dir / "02_captcha.png"
                await page.locator(captcha_selector).first.screenshot(path=str(captcha_path))
                report["artifacts"]["captcha_image"] = str(captcha_path)
                if args.prompt_captcha:
                    print(f"captcha_image: {captcha_path}", flush=True)

            if not args.attempt_login:
                report["status"] = "captured_login_page"
                return report

            required = ["username", "password", "submit"]
            missing = [key for key in required if not selectors.get(key)]
            if missing:
                report["status"] = "login_not_attempted"
                report["messages"].append(f"缺少登录选择器: {', '.join(missing)}")
                return report

            await page.locator(selectors["username"]).fill(args.student_no)
            await page.locator(selectors["password"]).fill(args.student_no)

            if selectors.get("captcha") and not args.captcha and args.captcha_source == "ai":
                if not captcha_path:
                    report["messages"].append("未找到验证码图片，无法调用 AI 识别")
                else:
                    try:
                        args.captcha = await recognize_captcha_with_ai(captcha_path, args)
                        report["captcha"]["recognized"] = True
                        report["captcha"]["provider"] = "openai_compatible"
                        report["captcha"]["model"] = args.captcha_ai_model
                        report["messages"].append("验证码 AI 识别完成，已填入登录表单")
                    except Exception as exc:
                        report["messages"].append(f"验证码 AI 识别失败: {exc}")

            if selectors.get("captcha") and not args.captcha and args.prompt_captcha:
                args.captcha = (
                    await asyncio.to_thread(input, "请输入当前验证码，留空则停止登录: ")
                ).strip()
                if args.captcha:
                    report["captcha"]["recognized"] = True
                    report["captcha"]["provider"] = "manual_prompt"

            if selectors.get("captcha") and not args.captcha:
                report["status"] = "captcha_required"
                report["messages"].append("已填写账号密码但未提交；需要验证码识别结果")
                await page.locator(selectors["password"]).fill("")
                await page.locator(selectors["username"]).fill("")
                return report

            if selectors.get("captcha") and args.captcha:
                if not report["captcha"]["recognized"]:
                    report["captcha"]["recognized"] = True
                    report["captcha"]["provider"] = "manual_arg"
                await page.locator(selectors["captcha"]).fill(args.captcha)

            before_url = page.url
            await page.locator(selectors["submit"]).click()
            try:
                await page.wait_for_load_state("networkidle", timeout=args.timeout_ms)
            except PlaywrightTimeoutError:
                report["messages"].append("登录提交后网络静默等待超时，继续保存当前页面")
            await page.wait_for_timeout(args.post_login_settle_ms)
            loading_finished = await wait_for_visible_loading_to_disappear(page, args.post_login_wait_ms)
            if not loading_finished:
                report["messages"].append("登录后页面 loading 遮罩未在等待窗口内消失")
            await page.wait_for_timeout(500)

            after_png = out_dir / "03_after_login.png"
            after_html = out_dir / "03_after_login.html"
            after_dom = out_dir / "03_after_login_dom.json"
            await page.screenshot(path=str(after_png), full_page=True)
            await save_html(page, after_html)
            after_summary = await summarize_dom(page)
            write_json(after_dom, after_summary)
            report["artifacts"].update(
                {
                    "after_login_screenshot": str(after_png),
                    "after_login_html": str(after_html),
                    "after_login_dom": str(after_dom),
                }
            )
            report["messages"].extend(await extract_message_candidates(page))
            report["final_url"] = page.url
            report["final_title"] = await page.title()
            report["real_name"] = await extract_real_name(page, args.config)
            school_report_list = await extract_school_report_list(page, args.config)
            report["schoolReportList"] = school_report_list
            report["schoolReportSummary"] = summarize_school_report_list(school_report_list)
            report["forbiddenActionTargets"] = await collect_forbidden_action_targets(page, args.config)
            if args.save_snapshot_user_id:
                save_school_snapshot(
                    report,
                    args.save_snapshot_user_id,
                    report.get("real_name"),
                    school_report_list,
                )
            report["status"] = "login_submitted"
            if page.url != before_url and "/Login" not in page.url:
                report["status"] = "login_navigation_observed"
            if args.keep_open:
                ttl = int(args.user_session_idle_ttl_seconds or 0)
                if ttl <= 0:
                    print("keep_open: userSessionIdleTtlSeconds=0，浏览器将保持打开，按 Ctrl+C 退出。", flush=True)
                    while True:
                        await page.wait_for_timeout(60_000)
                else:
                    print(f"keep_open: 浏览器保持打开 {ttl} 秒后退出。", flush=True)
                    await page.wait_for_timeout(ttl * 1000)
        finally:
            await context.close()
            await browser.close()

    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture school report system login page evidence.")
    parser.add_argument("--student-no", required=True, help="Student number. The school password is assumed equal to it.")
    parser.add_argument("--config-json", help="Path to automation config JSON. Defaults to backend default config.")
    parser.add_argument("--url", default=None, help=f"Login page URL. Default: config schoolSystem.loginUrl or {DEFAULT_LOGIN_URL}")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUTPUT_ROOT), help="Directory for screenshots and JSON evidence.")
    parser.add_argument("--attempt-login", action="store_true", help="Fill credentials and submit when possible.")
    parser.add_argument("--captcha", help="Manual captcha text. Omit to stop before login submission.")
    parser.add_argument(
        "--captcha-source",
        choices=["none", "ai"],
        default="none",
        help="How to obtain captcha automatically. Use 'ai' for OpenAI-compatible vision API.",
    )
    parser.add_argument("--prompt-captcha", action="store_true", help="Pause after saving captcha image and read captcha from stdin.")
    parser.add_argument("--captcha-ai-base-url", default=None)
    parser.add_argument("--captcha-ai-model", default=None)
    parser.add_argument("--captcha-ai-prompt", default=None)
    parser.add_argument("--captcha-ai-timeout", type=int, default=None)
    parser.add_argument("--headless", action=argparse.BooleanOptionalAction, default=None)
    parser.add_argument("--slow-mo", type=int, default=0)
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("--post-login-settle-ms", type=int, default=1500)
    parser.add_argument("--post-login-wait-ms", type=int, default=5000)
    parser.add_argument("--user-session-idle-ttl-seconds", type=int, default=0)
    parser.add_argument("--keep-open", action="store_true", help="Keep browser open after login. TTL 0 means never close proactively.")
    parser.add_argument("--save-snapshot-user-id", type=int, help="Persist real_name and {experimentName, status} list for this user_id.")
    parser.add_argument("--viewport-width", type=int, default=1440)
    parser.add_argument("--viewport-height", type=int, default=1000)
    return parser.parse_args()


def main() -> None:
    args = apply_config_defaults(parse_args())
    parsed_url = urlparse(args.url)
    if parsed_url.scheme and parsed_url.netloc and parsed_url.path in ["", "/"]:
        args.url = args.url.rstrip("/") + "/Login"
    report = asyncio.run(probe(args))
    out_dir = Path(report["out_dir"])
    report_path = out_dir / "probe_report.json"
    write_json(report_path, report)
    print(f"status: {report['status']}")
    print(f"out_dir: {out_dir}")
    print(f"report: {report_path}")
    for name, path in report.get("artifacts", {}).items():
        print(f"{name}: {path}")


if __name__ == "__main__":
    main()
