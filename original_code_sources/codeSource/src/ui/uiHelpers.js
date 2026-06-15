/** ---------------------------
 *  UI Helper Functions
 *  --------------------------- */

// HTML Escape
function escapeHtml(unsafe) {
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Logging to UI
function tmLog(message, type = "info") {
    const logPanel = document.getElementById("__tm_log_content");
    if (!logPanel) return;

    const entry = document.createElement("div");
    entry.style.padding = "2px 0";
    entry.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    // Color by type
    if (type === "success") entry.style.color = "#7ee787";
    else if (type === "warn") entry.style.color = "#ffc107";
    else if (type === "error") entry.style.color = "#ff6b6b";
    else entry.style.color = "#a5d6ff";

    logPanel.appendChild(entry);

    // Auto-scroll
    const parent = document.getElementById("__tm_log_panel");
    if (parent) parent.scrollTop = parent.scrollHeight;
}

// Update User Info UI
function updateUserInfoUI() {
    const nameEl = document.getElementById("__tm_user_name");
    const idEl = document.getElementById("__tm_student_id");
    if (nameEl) nameEl.textContent = state.userInfo.name || "未知";
    if (idEl) idEl.textContent = state.userInfo.studentId || "未知";
}

// Enable Drag for Panel
function enableDrag(panel, handle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e) => {
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;

        panel.style.left = `${startLeft}px`;
        panel.style.top = `${startTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = `${startLeft + dx}px`;
        panel.style.top = `${startTop + dy}px`;
    });

    document.addEventListener("mouseup", () => {
        dragging = false;
    });
}

// Preview window
function openPreview() {
    const profile = getActiveProfile();
    const profiles = getProfiles();

    const fill = Array.isArray(profile?.fill) ? profile.fill : [];
    // 创建填充缓存，模拟填充过程，支持字段间引用
    const fillCache = {};
    const previewFill = fill.map(item => {
        const id = item.id;
        let val;
        let source = "";

        // 优先级：valueFromFn > valueFrom > value
        if (item.valueFromFn) {
            try {
                // 传递 fillCache，使函数可以访问已计算但未写入的值
                val = callCustomFunction(item.valueFromFn, item.args || [], fillCache);
                source = `函数: ${item.valueFromFn}(${Array.isArray(item.args) ? item.args.join(", ") : ""})`;
            } catch (e) {
                val = `[错误: ${String(e?.message || e)}]`;
                source = `函数调用失败`;
            }
        } else if (item.valueFrom) {
            // 传递 fillCache，支持引用已计算但未写入的值
            val = resolveValueFromPath(item.valueFrom, fillCache);
            source = `路径: ${item.valueFrom}`;
        } else if (Object.prototype.hasOwnProperty.call(item, "value")) {
            val = item.value;
            // 如果 value 是字符串，且该字符串在填充缓存中存在，则从缓存读取
            if (typeof val === "string" && fillCache.hasOwnProperty(val)) {
                val = fillCache[val];
                source = `引用字段: ${item.value}`;
            } else {
                source = "直接值";
            }
        } else {
            val = "";
            source = "未指定";
        }

        // 将计算好的值存入缓存，供后续字段引用
        fillCache[id] = val;

        return { id, value: val, source };
    });

    const data = {
        activeProfile: state.activeProfileName,
        availableProfiles: Object.keys(profiles),
        store: state.store,
        willFill: previewFill,
    };

    const w = window.open("", "__tm_cfg_preview", "width=900,height=700");
    if (!w) {
        alert("预览窗口被浏览器拦截，请允许弹窗。");
        return;
    }

    w.document.open();
    w.document.write(renderPreviewHTML(data));
    w.document.close();
}

function renderPreviewHTML(data) {
    const jsonText = escapeHtml(JSON.stringify(data.store, null, 2));
    const willFillRows = data.willFill.map(x =>
        `<tr><td>${escapeHtml(x.id)}</td><td style="white-space:pre-wrap;">${escapeHtml(x.value)}</td></tr>`
    ).join("");

    return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>配置预览</title>
  <style>
    body { margin: 0; background: #0b0f14; color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial; }
    .wrap { padding: 16px; }
    .card { background: #0f1720; border: 1px solid #223042; border-radius: 12px; padding: 14px; margin-bottom: 14px; }
    h2 { margin: 0 0 10px 0; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border-bottom: 1px solid #223042; padding: 8px; vertical-align: top; }
    th { text-align: left; color: #9fb3c8; font-weight: 600; }
    pre { background: #0b0f14; border: 1px solid #223042; padding: 10px; border-radius: 10px; overflow: auto; }
    .hint { color: #9fb3c8; font-size: 12px; }
    button { background: #111b27; border: 1px solid #223042; color: #e6edf3; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
    button:hover { background: #132235; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2>当前配置</h2>
      <div class="hint">activeProfile: ${escapeHtml(data.activeProfile)}</div>
      <div class="hint">availableProfiles: ${escapeHtml(data.availableProfiles.join(", "))}</div>
    </div>

    <div class="card">
      <h2>即将写入页面的字段</h2>
      <table>
        <thead><tr><th>id</th><th>value</th></tr></thead>
        <tbody>${willFillRows || `<tr><td colspan="2" class="hint">无</td></tr>`}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>暂存数据（可复制）</h2>
      <div class="hint">包含 extract / meta</div>
      <button onclick="navigator.clipboard.writeText(document.getElementById('store').innerText)">复制</button>
      <pre id="store">${jsonText}</pre>
    </div>
  </div>
</body>
</html>`;
}
