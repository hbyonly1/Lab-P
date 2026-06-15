/** ---------------------------
 *  Modal Helper
 *  Modal UI 组件辅助函数
 *  --------------------------- */

/**
 * 创建基础 Modal
 * @param {Object} options - Modal 配置
 * @returns {Object} - { modal, content, close }
 */
function createModal(options = {}) {
    const {
        width = "400px",
        height = "auto",
        closeOnOverlay = true
    } = options;

    const modal = document.createElement("div");
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 1000000;
        display: flex; align-items: center; justify-content: center;
    `;

    const content = document.createElement("div");
    content.style.cssText = `
        background: #0f1720; border: 1px solid #223042; border-radius: 12px;
        padding: 20px; width: ${width}; ${height !== 'auto' ? `height: ${height};` : ''}
        display: flex; flex-direction: column;
        color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8);
    `;

    modal.appendChild(content);

    // Prevent focus stealing
    modal.addEventListener("focusin", (e) => e.stopPropagation());
    modal.addEventListener("keydown", (e) => e.stopPropagation());
    modal.addEventListener("mousedown", (e) => e.stopPropagation());

    const close = () => {
        if (document.body.contains(modal)) {
            document.body.removeChild(modal);
        }
    };

    if (closeOnOverlay) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) close();
        });
    }

    return { modal, content, close };
}

/**
 * 显示自定义数据管理 Modal
 */
function showCustomDataModal() {
    const { modal, content, close } = createModal({ width: "400px" });

    const renderList = () => {
        const listDiv = content.querySelector("#__tm_custom_list");
        listDiv.innerHTML = "";
        const custom = getAllCustomData();
        if (Object.keys(custom).length === 0) {
            listDiv.innerHTML = `<div style="color:#9fb3c8;font-size:12px;padding:10px;text-align:center;">暂无自定义数据</div>`;
        } else {
            for (const [key, val] of Object.entries(custom)) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;gap:10px;margin-bottom:8px;align-items:center;";
                row.innerHTML = `
                    <div style="flex:1;background:#0b0f14;padding:6px;border-radius:6px;border:1px solid #223042;font-family:monospace;">${escapeHtml(key)}</div>
                    <div style="flex:2;background:#0b0f14;padding:6px;border-radius:6px;border:1px solid #223042;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(String(val))}</div>
                    <button class="del-btn" data-key="${escapeHtml(key)}" style="background:#302020;border:1px solid rgba(190,70,70,.9);color:#e6edf3;padding:4px 8px;border-radius:6px;cursor:pointer;">删除</button>
                `;
                listDiv.appendChild(row);
            }
            // Bind delete buttons
            listDiv.querySelectorAll(".del-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    const k = e.currentTarget.dataset.key;
                    if (confirm(`确定删除自定义数据 "${k}" 吗？`)) {
                        deleteCustomData(k);
                        renderList();
                    }
                });
            });
        }
    };

    content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
            <h3 style="margin:0;font-size:16px;">自定义数据管理</h3>
            <button id="__tm_modal_close" style="background:transparent;border:none;color:#9fb3c8;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <div style="margin-bottom:15px;display:flex;gap:8px;">
            <input id="__tm_custom_key" placeholder="点击输入ID" readonly style="flex:1;background:#0b0f14;border:1px solid #223042;color:#e6edf3;padding:6px;border-radius:6px;cursor:pointer;">
            <input id="__tm_custom_val" placeholder="点击输入值" readonly style="flex:1;background:#0b0f14;border:1px solid #223042;color:#e6edf3;padding:6px;border-radius:6px;cursor:pointer;">
            <button id="__tm_custom_add" style="background:#132235;border:1px solid rgba(60,110,180,.9);color:#e6edf3;padding:6px 12px;border-radius:6px;cursor:pointer;">添加</button>
        </div>
        <div id="__tm_custom_list" style="max-height:300px;overflow-y:auto;margin-bottom:15px;"></div>
        <div style="font-size:12px;color:#9fb3c8;">在配置中使用: custom.ID (例如 custom.myVar)</div>
    `;

    document.body.appendChild(modal);
    renderList();

    // Close button
    content.querySelector("#__tm_modal_close").addEventListener("click", close);

    // Setup prompt inputs
    const setupPrompt = (selector, msg) => {
        content.querySelector(selector).addEventListener("click", function () {
            const val = prompt(msg, this.value);
            if (val !== null) {
                this.value = val;
                this.dispatchEvent(new Event("input"));
            }
        });
    };
    setupPrompt("#__tm_custom_key", "请输入ID");
    setupPrompt("#__tm_custom_val", "请输入值");

    // Add button
    content.querySelector("#__tm_custom_add").addEventListener("click", () => {
        const kInput = content.querySelector("#__tm_custom_key");
        const vInput = content.querySelector("#__tm_custom_val");
        const key = kInput.value.trim();
        const val = vInput.value.trim();

        if (!key) return alert("请输入 ID");

        setCustomData(key, val);
        kInput.value = "";
        vInput.value = "";
        renderList();
    });

    // Stop propagation for inputs
    const inputs = content.querySelectorAll("input");
    inputs.forEach(inp => {
        inp.addEventListener("keydown", e => e.stopPropagation());
        inp.addEventListener("keypress", e => e.stopPropagation());
        inp.addEventListener("keyup", e => e.stopPropagation());
        inp.addEventListener("input", e => e.stopPropagation());
    });
}

/**
 * 显示字典填充 Modal
 */
function showDictFillModal() {
    const { modal, content, close } = createModal({ width: "500px", height: "400px" });

    content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:16px;">根据自定义字典填写</h3>
            <button id="__tm_dict_close" style="background:transparent;border:none;color:#9fb3c8;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <div style="font-size:12px;color:#9fb3c8;margin-bottom:8px;">请输入 JSON 数据 (对象或数组，支持逗号分隔的对象):</div>
        <textarea id="__tm_dict_input" readonly style="flex:1;background:#0b0f14;border:1px solid #223042;color:#e6edf3;padding:10px;border-radius:8px;font-family:monospace;resize:none;margin-bottom:12px;cursor:pointer;"></textarea>
        <button id="__tm_dict_confirm" style="background:#1f6feb;border:1px solid rgba(240,246,252,0.1);color:#e6edf3;padding:10px;border-radius:8px;cursor:pointer;font-weight:600;">确认填写</button>
    `;

    document.body.appendChild(modal);

    // Setup prompt for textarea
    content.querySelector("#__tm_dict_input").addEventListener("click", function () {
        const val = prompt("请输入 JSON 数据 (支持粘贴)", this.value);
        if (val !== null) {
            this.value = val;
            this.dispatchEvent(new Event("input"));
        }
    });

    // Close button
    content.querySelector("#__tm_dict_close").addEventListener("click", close);

    // Confirm button
    content.querySelector("#__tm_dict_confirm").addEventListener("click", () => {
        const raw = content.querySelector("#__tm_dict_input").value.trim();
        try {
            const count = fillFromDictionary(raw);
            tmLog(`已通过字典填写 ${count} 项数据`, "success");
            alert(`已填写 ${count} 项数据`);
            close();
        } catch (e) {
            alert(e.message);
        }
    });
}
