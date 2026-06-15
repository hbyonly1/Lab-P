/** ---------------------------
 *  DOM helpers
 *  --------------------------- */
function getElByIdOrSelector(idOrSel) {
    // 兼容：配置里可能写 "abc"（id）也可能写 "#abc"（selector）
    if (!idOrSel) return null;

    // Check for indexed ID: "FGJ6.1" -> ID "FGJ6", index 1
    // Matches "ANY_STRING.NUMBER"
    const match = idOrSel.match(/^(.+)\.(\d+)$/);
    if (match) {
        // It's an indexed request
        const baseId = match[1];
        const index = parseInt(match[2], 10);

        // Use querySelectorAll to find all matches
        // If it looks like an ID (no special selector chars), treat as ID
        let selector;
        if (baseId.startsWith("#") || baseId.startsWith(".") || baseId.includes("[") || baseId.includes(" ")) {
            selector = baseId;
        } else {
            // It's an ID, but we must use selector to get multiple
            // CSS.escape handles IDs with dots/colons which is tricky, but here we split by dot already
            // If baseId contains characters that need escaping?
            // Safer to use attribute selector for ID to avoid syntax errors
            selector = `[id="${baseId}"]`;
        }

        const all = document.querySelectorAll(selector);
        return all[index]; // returns undefined if out of bounds
    }

    if (idOrSel.startsWith("#") || idOrSel.startsWith(".") || idOrSel.includes("[") || idOrSel.includes(" ")) {
        return document.querySelector(idOrSel);
    }
    return document.getElementById(idOrSel);
}

function readValue(idOrSel) {
    const el = getElByIdOrSelector(idOrSel);
    if (!el) return null;
    // input/textarea/select 通用
    if ("value" in el) return String(el.value ?? "");
    return String(el.textContent ?? "");
}

function expandIdRanges(list) {
    // 输入：["DXYJ10-{0..10}", "abc", "Y{1..3}-x"] -> 输出：展开后的数组
    const out = [];
    const re = /\{(\d+)\.\.(\d+)\}/;

    for (const raw of (Array.isArray(list) ? list : [])) {
        if (typeof raw !== "string") continue;

        const m = raw.match(re);
        if (!m) { out.push(raw); continue; }

        const start = parseInt(m[1], 10);
        const end = parseInt(m[2], 10);
        const step = start <= end ? 1 : -1;

        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
            out.push(raw.replace(re, String(i)));
        }
    }
    return out;
}

function writeValue(idOrSel, value) {
    const el = getElByIdOrSelector(idOrSel);
    if (!el) return { ok: false, reason: "not_found" };

    const v = value == null ? "" : String(value);

    if ("value" in el) {
        el.value = v;
        // 触发事件，兼容 Vue/React/原生监听
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
    }

    el.textContent = v;
    return { ok: true };
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function waitForElement(selector, maxAttempts = 50, interval = 100) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            const el = document.querySelector(selector);
            if (el) {
                clearInterval(check);
                resolve(el);
            } else if (attempts >= maxAttempts) {
                clearInterval(check);
                reject(new Error("Timeout waiting for element: " + selector));
            }
        }, interval);
    });
}

function tmLog(message, type = "info") {
    // Console output
    const prefix = "[TM]";
    if (type === "error") {
        console.error(prefix, message);
    } else if (type === "warn") {
        console.warn(prefix, message);
    } else {
        console.log(prefix, message);
    }

    // UI output
    const logContent = document.getElementById("__tm_log_content");
    if (logContent) {
        const timestamp = new Date().toLocaleTimeString();
        const colorMap = {
            info: "#58a6ff",
            success: "#3fb950",
            warn: "#d29922",
            error: "#f85149"
        };
        const color = colorMap[type] || colorMap.info;

        const logEntry = document.createElement("div");
        logEntry.style.color = color;
        logEntry.textContent = `[${timestamp}] ${message}`;

        logContent.appendChild(logEntry);

        // Auto-scroll to bottom
        const panel = document.getElementById("__tm_log_panel");
        if (panel) {
            panel.scrollTop = panel.scrollHeight;
        }

        // Keep only last 50 entries
        while (logContent.children.length > 50) {
            logContent.removeChild(logContent.firstChild);
        }
    }
}
