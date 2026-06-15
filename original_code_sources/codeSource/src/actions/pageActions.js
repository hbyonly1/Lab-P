function runExtractAndCompute() {
    const profile = getActiveProfile();
    if (!profile) return { ok: false, error: "no_profile" };

    const extractIds = expandIdRanges(Array.isArray(profile.extract) ? profile.extract : []);

    const newExtract = {};
    const missing = [];
    for (const id of extractIds) {
        const v = readValue(id);
        const normalizedId = id.replace(/^#/, "");
        if (v == null) missing.push(id);
        else newExtract[normalizedId] = v;
    }

    state.store.extract = newExtract;

    // computed is deprecated/removed.
    state.store.computed = {};
    state.store.meta.lastRunAt = new Date().toISOString();
    saveJSON(LS_KEY_STORE, state.store);

    return { ok: true, missing }; // Removed computedOut, computeErrors
}

function applyFill(filterFn = null) {
    const profile = getActiveProfile();
    if (!profile) return { ok: false, error: "no_profile" };

    const fill = Array.isArray(profile.fill) ? profile.fill : [];
    const results = [];
    const fillCache = {};

    for (const item of fill) {
        if (filterFn && typeof filterFn === "function" && !filterFn(item)) {
            continue;
        }
        const id = item.id;
        let val;

        if (item.valueFromFn) {
            try {
                val = callCustomFunction(item.valueFromFn, item.args || [], fillCache);
            } catch (e) {
                results.push({ id, value: null, ok: false, reason: String(e?.message || e) });
                continue;
            }
        } else if (item.valueFrom) {
            val = resolveValueFromPath(item.valueFrom, fillCache);
        } else if (Object.prototype.hasOwnProperty.call(item, "value")) {
            val = item.value;
            if (typeof val === "string" && fillCache.hasOwnProperty(val)) {
                val = fillCache[val];
            }
        } else {
            val = "";
        }

        fillCache[id] = val;

        const r = writeValue(id, val);
        results.push({ id, value: val, ...r });
    }



    return { ok: true, results };
}

function collectConfiguredFieldIds(profile) {
    const ids = new Set();
    (Array.isArray(profile?.extract) ? profile.extract : []).forEach(x => ids.add(String(x)));
    (Array.isArray(profile?.fill) ? profile.fill : []).forEach(item => {
        if (item && item.id) ids.add(String(item.id));
    });
    return Array.from(ids);
}

function collectAllPageFormIds() {
    const els = Array.from(document.querySelectorAll("input[id], textarea[id], select[id]"));
    const filtered = els.filter(el => {
        if (el.tagName === "INPUT") {
            const t = (el.getAttribute("type") || "").toLowerCase();
            if (t === "checkbox" || t === "radio" || t === "button" || t === "submit") return false;
        }
        return true;
    });
    return filtered.map(el => el.id);
}

function exportPageFilledDataAsJSON({ mode = "configured" } = {}) {
    const profile = getActiveProfile();
    if (!profile) {
        alert("未选择配置或配置为空。");
        return;
    }

    // 1) 生成有序的 id 列表
    let orderedIds = [];
    if (mode === "all") {
        orderedIds = collectAllPageFormIds();
    } else {
        orderedIds = (Array.isArray(profile.fill) ? profile.fill : [])
            .map(x => x && x.id)
            .filter(Boolean)
            .map(String);
    }

    // 2) 读取页面值，生成 [{id, value}, ...]
    const items = [];
    const missing = [];

    for (const id of orderedIds) {
        const v = readValue(id);
        if (v == null) {
            missing.push(id);
            continue;
        }
        items.push({
            id: id.startsWith("#") ? id.slice(1) : id,
            value: v
        });
    }

    // 3) 直接导出“数组”，不带包装
    const filenameSafeProfile = (state.activeProfileName || "profile").replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
    const filename = `fill_${filenameSafeProfile}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    return { exported: items.length, missing: missing.length, filename, missingIds: missing };
}

function generateStringsFromExtract(extractIds, equationTypes = null, defaultEquationType = "07", batchSize = 2) {
    const results = [];

    if (!Array.isArray(extractIds)) {
        return results;
    }

    for (let i = 0; i < extractIds.length; i++) {
        const item = extractIds[i];
        let values = [];
        let equationType = defaultEquationType;

        // Calculate index in equationTypes based on batch
        const typeIndex = Math.floor(i / batchSize);
        let configType = null;
        if (Array.isArray(equationTypes) && equationTypes[typeIndex] != null) {
            configType = String(equationTypes[typeIndex]);
        }

        // 判断类型并处理
        if (typeof item === "string") {
            // 字符串格式：当作 extract ID 处理
            const ids = expandIdRanges([item]);
            for (const id of ids) {
                const normalizedId = id.replace(/^#/, "");
                const value = state.store.extract[normalizedId];
                if (value != null && value !== "") {
                    values.push(String(value));
                }
            }
            if (configType) equationType = configType;
        } else if (Array.isArray(item)) {
            // 数组格式：直接作为自定义值列表
            values = item.map(v => String(v ?? "")).filter(v => v !== "");
            if (configType) equationType = configType;
        } else if (typeof item === "object" && item !== null) {
            if (item.type === "custom" && Array.isArray(item.values)) {
                values = item.values.map(v => String(v ?? "")).filter(v => v !== "");
                equationType = item.equationType || configType || defaultEquationType;
            } else if (item.type === "extract" && Array.isArray(item.ids)) {
                const ids = expandIdRanges(item.ids);
                for (const id of ids) {
                    const normalizedId = id.replace(/^#/, "");
                    const value = state.store.extract[normalizedId];
                    if (value != null && value !== "") {
                        values.push(String(value));
                    }
                }
                equationType = item.equationType || configType || defaultEquationType;
            } else if (item.values && Array.isArray(item.values)) {
                values = item.values.map(v => String(v ?? "")).filter(v => v !== "");
                equationType = item.equationType || configType || defaultEquationType;
            } else if (item.string) {
                values = [item.string];
                equationType = item.equationType || configType || defaultEquationType;
            }
        }

        if (values.length > 0) {
            results.push({
                string: values.join(","),
                equationType: equationType
            });
        }
    }

    return results;
}

function clickSubmit() {
    const profile = getActiveProfile();
    if (!profile) return Promise.resolve({ ok: false, error: "no_profile" });

    return new Promise((resolve) => {
        if (profile.submit && profile.submit.selector) {
            const btn = document.querySelector(profile.submit.selector);
            if (btn) {
                btn.click();

                // Poll for confirmation modal (up to 5s)
                console.log("[TM] 点击提交，开启弹窗检测...");

                const logToUI = (msg, color) => {
                    const p = document.getElementById("__tm_log_content");
                    if (p) {
                        const d = document.createElement("div");
                        d.textContent = `[自动] ${msg}`;
                        d.style.color = color || "#e6edf3";
                        d.style.padding = "2px 0";
                        d.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
                        p.appendChild(d);
                        const parent = document.getElementById("__tm_log_panel");
                        if (parent) parent.scrollTop = parent.scrollHeight;
                    }
                    console.log("[TM] " + msg);
                };

                logToUI("等待确认弹窗...", "#a5d6ff");

                let checks = 0;
                const interval = setInterval(() => {
                    checks++;
                    const searchScope = document.querySelector(".bootbox.modal") || document.body;
                    const okBtn = searchScope.querySelector('button[data-bb-handler="ok"]');

                    if (okBtn) {
                        okBtn.click();
                        clearInterval(interval);
                        logToUI("已自动点击确认弹窗 [OK]", "#7ee787");
                        resolve({ ok: true });
                    } else if (checks >= 10) { // 5 seconds (10 * 500ms)
                        clearInterval(interval);
                        logToUI("未监测到弹窗，或无需确认。", "#8b949e");
                        resolve({ ok: true }); // Assume success if no modal appears
                    }
                }, 500);

            } else {
                resolve({ ok: false, error: "未找到提交按钮 (submit.selector)" });
            }
        } else {
            resolve({ ok: false, error: "配置未指定提交按钮 (submit.selector)" });
        }
    });
}

function clickClose() {
    // 尝试查找用户提供的关闭按钮
    // <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
    const btn = document.querySelector('button.close[data-dismiss="modal"]');
    if (btn) {
        btn.click();
        return { ok: true };
    }
    return { ok: false, error: "未找到关闭按钮 (button.close[data-dismiss=\"modal\"])" };
}
function clickLogout() {
    // 检查页面上的全局变量
    if (typeof _userInfo === "undefined" || typeof _websiteName === "undefined") {
        return { ok: false, error: "页面全局变量 _userInfo 或 _websiteName 未找到" };
    }

    // 获取输入的学号
    const inputId = document.getElementById("__tm_input_switch_id")?.value.trim();
    if (inputId) {
        localStorage.setItem("__tm_auto_login_id", inputId);
    }

    // 根据用户提供的逻辑，由于 $.ajax 是 jQuery 的，我们直接调用
    if (typeof jQuery === "undefined") {
        return { ok: false, error: "页面未加载 jQuery，无法调用 $.ajax" };
    }

    jQuery.ajax({
        type: 'post',
        url: _websiteName + '/Login/LoginOut',
        data: {
            userId: _userInfo.UserID,
            Guid: _userInfo.Token
        },
        success: function (data) {
            if (data.IsSuccess) {
                window.location.href = _websiteName + data.Data;
            }
            else {
                alert(data.Data);
            }
        },
        error: function (err) {
            alert("请求失败: " + String(err.statusText || err));
        }
    });
    return { ok: true };
}
