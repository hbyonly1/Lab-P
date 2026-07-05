from __future__ import annotations

import asyncio
from typing import Any


class SchoolDomTimeout(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


async def wait_for_selector_count(
    page: Any,
    selector: str,
    *,
    min_count: int = 1,
    timeout_ms: int = 30000,
    stable_ms: int = 300,
) -> int:
    try:
        await page.wait_for_function(
            """
            ({ selector, minCount }) => document.querySelectorAll(selector).length >= minCount
            """,
            arg={"selector": selector, "minCount": min_count},
            timeout=timeout_ms,
        )
        first_count = await page.locator(selector).count()
        if stable_ms > 0:
            await page.wait_for_timeout(stable_ms)
            second_count = await page.locator(selector).count()
            return min(first_count, second_count)
        return first_count
    except Exception as exc:
        raise SchoolDomTimeout(f"Timed out waiting for selector count: {selector}") from exc


async def read_non_empty_text(
    page: Any,
    selector: str,
    *,
    timeout_ms: int = 30000,
    stable_ms: int = 300,
) -> str:
    try:
        await page.wait_for_function(
            """
            (selector) => {
              const el = document.querySelector(selector);
              const text = (el && (el.innerText || el.textContent || '')) || '';
              return Boolean(text.trim());
            }
            """,
            arg=selector,
            timeout=timeout_ms,
        )
        if stable_ms > 0:
            await page.wait_for_timeout(stable_ms)
        text = await page.evaluate(
            """
            (selector) => {
              const el = document.querySelector(selector);
              return ((el && (el.innerText || el.textContent || '')) || '').trim();
            }
            """,
            selector,
        )
        if not str(text or "").strip():
            raise SchoolDomTimeout(f"Selector text is empty after wait: {selector}")
        return str(text).strip()
    except SchoolDomTimeout:
        raise
    except Exception as exc:
        raise SchoolDomTimeout(f"Timed out waiting for non-empty text: {selector}") from exc


async def read_locator_value(locator: Any) -> str:
    value = await locator.evaluate(
        """
        (el) => {
          if (el.isContentEditable) return el.innerHTML || '';
          if ('value' in el) return el.value ?? '';
          return el.textContent ?? '';
        }
        """
    )
    return str(value or "")


async def wait_for_locator_value(
    locator: Any,
    expected: str,
    *,
    timeout_ms: int = 10000,
    interval_ms: int = 200,
) -> str:
    expected_text = str(expected or "").strip()
    deadline = asyncio.get_running_loop().time() + max(timeout_ms, 1) / 1000
    last_value = ""
    while True:
        last_value = await read_locator_value(locator)
        actual_text = last_value.strip()
        if actual_text == expected_text or expected_text in actual_text:
            return last_value
        if asyncio.get_running_loop().time() >= deadline:
            break
        await asyncio.sleep(max(interval_ms, 1) / 1000)
    raise SchoolDomTimeout("Timed out waiting for locator value to match expected text")
