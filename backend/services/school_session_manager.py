from __future__ import annotations

import asyncio
import threading
from concurrent.futures import Future
from dataclasses import dataclass, field
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Dict, Optional, Tuple, TypeVar

from models.core import get_utc_now

T = TypeVar("T")


@dataclass
class SchoolBrowserSession:
    user_id: int
    playwright: Any
    browser: Any
    context: Any
    page: Any
    created_by_job_id: str
    created_at: datetime = field(default_factory=get_utc_now)
    last_used_at: datetime = field(default_factory=get_utc_now)
    source: str = "overview_login"
    state: str = "active"
    last_diagnostic: Dict[str, Any] = field(default_factory=dict)


class SchoolSessionManager:
    def __init__(self) -> None:
        self._sessions: Dict[int, SchoolBrowserSession] = {}
        self._locks: Dict[int, asyncio.Lock] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[threading.Thread] = None
        self._loop_ready = threading.Event()

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        self._loop_ready.set()
        loop.run_forever()

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop and self._loop.is_running():
            return self._loop
        self._loop_ready.clear()
        self._loop_thread = threading.Thread(
            target=self._run_loop,
            name="school-session-playwright-loop",
            daemon=True,
        )
        self._loop_thread.start()
        self._loop_ready.wait(timeout=5)
        if not self._loop or not self._loop.is_running():
            raise RuntimeError("School session event loop failed to start.")
        return self._loop

    def run(self, coro: Awaitable[T]) -> T:
        loop = self._ensure_loop()
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is loop:
            raise RuntimeError("school_session_manager.run cannot be called from the school session event loop.")
        future: Future[T] = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result()

    def _lock_for(self, user_id: int) -> asyncio.Lock:
        lock = self._locks.get(user_id)
        if not lock:
            lock = asyncio.Lock()
            self._locks[user_id] = lock
        return lock

    @asynccontextmanager
    async def user_operation(self, user_id: int) -> AsyncIterator[None]:
        lock = self._lock_for(user_id)
        async with lock:
            yield

    async def _close_session_resources(self, session: SchoolBrowserSession, *, reason: str) -> None:
        session.state = "closed"
        session.last_diagnostic = {"reason": reason, "at": get_utc_now().isoformat()}
        for closer in [
            getattr(session.context, "close", None),
            getattr(session.browser, "close", None),
            getattr(session.playwright, "stop", None),
        ]:
            if not closer:
                continue
            try:
                result = closer()
                if hasattr(result, "__await__"):
                    await result
            except Exception:
                continue

    async def _close_all_sessions(self, *, reason: str) -> None:
        sessions = list(self._sessions.values())
        self._sessions.clear()
        self._locks.clear()
        for session in sessions:
            await self._close_session_resources(session, reason=reason)

    def shutdown(self, *, reason: str = "application_shutdown") -> None:
        loop = self._loop
        if not loop or not loop.is_running():
            self._sessions.clear()
            return
        future: Future[None] = asyncio.run_coroutine_threadsafe(
            self._close_all_sessions(reason=reason),
            loop,
        )
        future.result(timeout=10)
        loop.call_soon_threadsafe(loop.stop)
        if self._loop_thread:
            self._loop_thread.join(timeout=5)
        self._loop = None
        self._loop_thread = None

    def register(
        self,
        *,
        user_id: int,
        job_id: str,
        playwright: Any,
        browser: Any,
        context: Any,
        page: Any,
        source: str = "overview_login",
    ) -> SchoolBrowserSession:
        existing = self._sessions.get(user_id)
        if existing and existing is not None and existing.page is not page:
            existing.state = "replaced"
            try:
                asyncio.create_task(self._close_session_resources(existing, reason="replaced"))
            except RuntimeError:
                pass
        session = SchoolBrowserSession(
            user_id=user_id,
            playwright=playwright,
            browser=browser,
            context=context,
            page=page,
            created_by_job_id=job_id,
            source=source,
        )
        self._sessions[user_id] = session
        return session

    def get(self, user_id: int) -> Optional[SchoolBrowserSession]:
        session = self._sessions.get(user_id)
        if session:
            session.last_used_at = get_utc_now()
        return session

    def mark_invalid(self, user_id: int, *, reason: str) -> None:
        session = self._sessions.get(user_id)
        if not session:
            return
        session.state = "invalid"
        session.last_diagnostic = {"reason": reason, "at": get_utc_now().isoformat()}
        self._sessions.pop(user_id, None)

    async def close(self, user_id: int, *, reason: str) -> None:
        session = self._sessions.pop(user_id, None)
        if not session:
            return
        await self._close_session_resources(session, reason=reason)

    def _selectors(self, config: Dict[str, Any]) -> Dict[str, str]:
        selectors = config.get("selectors") or {}
        dashboard = selectors.get("dashboard") or {}
        modal = selectors.get("modal") or {}
        login = selectors.get("login") or {}
        school_system = config.get("schoolSystem") or {}
        base_url = str(school_system.get("baseUrl") or "").rstrip("/")
        return {
            "real_name": dashboard.get("realNameText") or "#LoginUserName",
            "report_nav": dashboard.get("reportNav") or "#reportA",
            "rows": dashboard.get("reportTableRows") or "tbody[data-bind='foreach: CompleteReportList'] tr",
            "modal_root": modal.get("root") or "#ReportModal",
            "modal_close": modal.get("close") or "#ReportModal button:has-text('关闭')",
            "login_username": login.get("username") or "#userName",
            "login_submit": login.get("submit") or ".loginBut",
            "complete_report_url": f"{base_url}/ReportStudent/CompleteReport/" if base_url else "",
        }

    async def _count(self, page: Any, selector: str) -> int:
        try:
            return await page.locator(selector).count()
        except Exception:
            return 0

    async def _visible(self, page: Any, selector: str) -> bool:
        try:
            locator = page.locator(selector).first
            return await locator.count() > 0 and await locator.is_visible()
        except Exception:
            return False

    async def detect_state(self, user_id: int, config: Dict[str, Any]) -> Dict[str, Any]:
        session = self._sessions.get(user_id)
        diagnostic = await self.diagnose(user_id, config)
        if not session:
            diagnostic["state"] = "missing"
            return diagnostic

        page = session.page
        if diagnostic.get("pageClosed"):
            session.state = "closed"
            diagnostic["state"] = "closed"
            session.last_diagnostic = diagnostic
            return diagnostic

        selectors = self._selectors(config)
        try:
            url = str(page.url)
            login_visible = "/Login" in url or await self._visible(page, selectors["login_username"]) or await self._visible(page, selectors["login_submit"])
            bootbox_visible = await self._visible(page, ".bootbox.modal.in") or await self._visible(page, ".bootbox-body")
            modal_visible = await self._visible(page, selectors["modal_root"])
            loading_visible = await self._visible(page, ".loading") or await self._visible(page, ".layui-layer-loading") or await self._visible(page, ".spinner")
            row_count = await self._count(page, selectors["rows"])

            if login_visible:
                state = "login_page"
            elif bootbox_visible:
                state = "bootbox_dialog"
            elif modal_visible:
                state = "report_modal"
            elif loading_visible:
                state = "loading"
            elif row_count > 0:
                state = "report_list"
            else:
                state = "unknown"

            diagnostic.update(
                {
                    "state": state,
                    "url": url,
                    "rowCount": row_count,
                    "bootboxVisible": bootbox_visible,
                    "modalVisible": modal_visible,
                    "loadingVisible": loading_visible,
                }
            )
            session.state = state
        except Exception as exc:
            diagnostic["state"] = "unknown"
            diagnostic["diagnosticError"] = f"{type(exc).__name__}: {exc}"
            session.state = "unknown"
        session.last_diagnostic = diagnostic
        return diagnostic

    async def _close_dialogs(self, page: Any, selectors: Dict[str, str]) -> None:
        for selector in [
            selectors["modal_close"],
            "#ReportModal .close",
            "#ReportModal button:has-text('关闭')",
            ".bootbox.modal.in .bootbox-close-button",
            ".bootbox.modal.in [data-dismiss='modal']",
            ".bootbox .close",
            ".bootbox button:has-text('OK')",
            ".bootbox button:has-text('确定')",
        ]:
            try:
                locator = page.locator(selector).first
                if await locator.count() > 0 and await locator.is_visible():
                    await locator.click()
                    await page.wait_for_timeout(300)
            except Exception:
                continue

    async def _wait_loading_gone(self, page: Any, timeout_ms: int) -> None:
        deadline = asyncio.get_running_loop().time() + max(timeout_ms, 1) / 1000
        loading_selectors = [".loading", ".layui-layer-loading", ".spinner"]
        while True:
            if not any([await self._visible(page, selector) for selector in loading_selectors]):
                return
            if asyncio.get_running_loop().time() >= deadline:
                return
            await page.wait_for_timeout(200)

    async def _wait_report_list(self, page: Any, selectors: Dict[str, str], timeout_ms: int) -> bool:
        try:
            await page.locator(selectors["rows"]).first.wait_for(state="visible", timeout=timeout_ms)
            return True
        except Exception:
            return False

    async def ensure_report_list(self, user_id: int, config: Dict[str, Any]) -> Tuple[Optional[Any], Dict[str, Any]]:
        session = self._sessions.get(user_id)
        diagnostic = await self.detect_state(user_id, config)
        if not session or diagnostic.get("state") in ["missing", "closed", "login_page"]:
            diagnostic["reuseDecision"] = "login_required"
            return None, diagnostic

        page = session.page
        selectors = self._selectors(config)
        runtime = config.get("runtime") or {}
        default_timeout_ms = int(runtime.get("defaultTimeoutMs") or 30000)
        recovery_steps = []

        for _ in range(3):
            state = (await self.detect_state(user_id, config)).get("state")
            recovery_steps.append(state)
            if state == "report_list":
                diagnostic = await self.detect_state(user_id, config)
                diagnostic["reuseDecision"] = "reused_existing_session"
                diagnostic["recoverySteps"] = recovery_steps
                return page, diagnostic
            if state in ["report_modal", "bootbox_dialog"]:
                await self._close_dialogs(page, selectors)
            elif state == "loading":
                await self._wait_loading_gone(page, default_timeout_ms)
            elif state == "unknown":
                try:
                    if await self._count(page, selectors["report_nav"]) > 0:
                        await page.locator(selectors["report_nav"]).first.click()
                    elif selectors["complete_report_url"]:
                        await page.goto(selectors["complete_report_url"], wait_until="domcontentloaded")
                    await self._wait_loading_gone(page, default_timeout_ms)
                except Exception as exc:
                    diagnostic["recoveryError"] = f"{type(exc).__name__}: {exc}"
                    break
            elif state in ["missing", "closed", "login_page"]:
                diagnostic["reuseDecision"] = "login_required"
                diagnostic["recoverySteps"] = recovery_steps
                return None, diagnostic

            if await self._wait_report_list(page, selectors, default_timeout_ms):
                diagnostic = await self.detect_state(user_id, config)
                diagnostic["reuseDecision"] = "recovered_existing_session"
                diagnostic["recoverySteps"] = recovery_steps
                return page, diagnostic

        diagnostic = await self.detect_state(user_id, config)
        diagnostic["reuseDecision"] = "existing_session_recovery_failed"
        diagnostic["recoverySteps"] = recovery_steps
        return None, diagnostic

    async def diagnose(self, user_id: int, config: Dict[str, Any]) -> Dict[str, Any]:
        session = self._sessions.get(user_id)
        diagnostic: Dict[str, Any] = {
            "hasSession": bool(session),
            "state": session.state if session else "missing",
            "source": session.source if session else None,
            "createdByJobId": session.created_by_job_id if session else None,
            "createdAt": session.created_at.isoformat() if session else None,
            "lastUsedAt": session.last_used_at.isoformat() if session else None,
            "pageClosed": None,
            "url": None,
            "onLoginPage": None,
            "hasRealNameNode": None,
            "hasReportRows": None,
            "hasReportModal": None,
        }
        if not session:
            return diagnostic
        page = session.page
        try:
            diagnostic["pageClosed"] = bool(page.is_closed())
            if diagnostic["pageClosed"]:
                return diagnostic
            diagnostic["url"] = page.url
            selectors = config.get("selectors") or {}
            dashboard = selectors.get("dashboard") or {}
            modal = selectors.get("modal") or {}
            row_selector = dashboard.get("reportTableRows") or "tbody[data-bind='foreach: CompleteReportList'] tr"
            real_name_selector = dashboard.get("realNameText") or "#LoginUserName"
            modal_root = modal.get("root") or "#ReportModal"
            diagnostic["onLoginPage"] = "/Login" in str(page.url)
            diagnostic["hasRealNameNode"] = await page.locator(real_name_selector).count() > 0
            diagnostic["hasReportRows"] = await page.locator(row_selector).count() > 0
            diagnostic["hasReportModal"] = await page.locator(modal_root).count() > 0
        except Exception as exc:
            diagnostic["diagnosticError"] = f"{type(exc).__name__}: {exc}"
        session.last_diagnostic = diagnostic
        return diagnostic


school_session_manager = SchoolSessionManager()


def school_user_session_key(user_id: int) -> str:
    return f"user:{user_id}"
