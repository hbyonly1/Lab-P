

(() => {
  "use strict";

// ==UserScript==
// @name         Configurable Extract/Compute/Fill Toolkit
// @namespace    Lilsis
// @version      12.0
// @description  Multi-profile DOM extractor + calculator + filler with preview UI
// @match        http://10.25.77.60:8001/*
// @match        https://www.qinms.com/webapp/curvefit/*
// @match        https://www.doubao.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/** ---------------------------
 *  Storage model
 *  ---------------------------
 *  config: loaded JSON config
 *  activeProfileName: current profile key
 *  store: runtime data
 *    - extract: { [id]: string }
 *    - computed: { [key]: any }
 */
const LS_KEY_CONFIG = "__tm_cfg_toolkit_config_v1";
const LS_KEY_PROFILE = "__tm_cfg_toolkit_active_profile_v1";
const LS_KEY_STORE = "__tm_cfg_toolkit_store_v1";

// Shared state object (hoisted in IIFE scope)
const state = {
    config: null, // Will be initialized in store.js or main.js logic? 
    // Actually cyclic dependency risk if we initialize here calling loadJSON which is in store.js.
    // Better to define state here as null/empty, and init in a setup function or just allow loadJSON to be hoisted.
    // In IIFE concatenation, functions are hoisted. 
    // Let's defer initialization of properties to first use or main init if possible, or just assume loadJSON is available if variables are at top.
    // To be safe: initialize with basic structure or nulls.
    activeProfileName: "",
    store: { extract: {}, meta: {} },
    custom: { c: 0.260 }, // Default custom data
    userInfo: { name: "", studentId: "" },
    configFiles: [] // Store all files from selected config directory
    // config: loadJSON(...) <- cannot call loadJSON here if it's defined later in the concatenated file?
    // IF we concat vars.js BEFORE store.js, loadJSON is undefined at this line.
    // So we should init state properties separately or just define the variable here.
};

// Custom functions registry
const customFunctions = {};

// Batch Queue
const batchQueue = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    queue: [],
    config: null,
    onProgress: null,
    onComplete: null,

    // logic will be attached in crossSite.js or defined here if circular deps. 
    // Ideally defined in crossSite.js but state is shared. 
    // Let's define the object structure here and attach methods in crossSite.js? 
    // Or just put the whole batchQueue object in crossSite.js if it doesn't need to be accessed by other early modules.
    // It's accessed by UI (ui.js). So it needs to be visible.
};

function loadJSON(key, fallback) {
    try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : fallback;
    } catch {
        return fallback;
    }
}
function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
}

// Initialize state (can be called after all function declarations are hoisted)
function initState() {
    state.config = loadJSON(LS_KEY_CONFIG, null);
    state.activeProfileName = localStorage.getItem(LS_KEY_PROFILE) || "";
    // Always start with empty store on page load (don't persist temporary data)
    state.store = { extract: {}, computed: {}, meta: {} };
    // Preserve default custom data values (don't reset to empty)
    if (!state.custom || Object.keys(state.custom).length === 0) {
        state.custom = { c: 0.260 }; // Default custom data
    }

    // Clear the persisted store from localStorage
    localStorage.removeItem(LS_KEY_STORE);
}

function getProfiles() {
    return (state.config && state.config.profiles) ? state.config.profiles : {};
}

function getActiveProfile() {
    const profiles = getProfiles();
    if (!state.activeProfileName || !profiles[state.activeProfileName]) {
        const first = Object.keys(profiles)[0] || "";
        state.activeProfileName = first;
        localStorage.setItem(LS_KEY_PROFILE, first);
    }
    return profiles[state.activeProfileName] || null;
}

// Explicitly define changeProfile to ensure it's available
function changeProfile(name) {
    if (state.config && state.config.profiles && state.config.profiles[name]) {
        state.activeProfileName = name;
        localStorage.setItem(LS_KEY_PROFILE, name);
        console.log(`[Store] Switched profile to: ${name}`);

        // Update UI if present
        const sel = document.getElementById("__tm_profile");
        if (sel) sel.value = name;
    } else {
        console.warn(`[Store] Profile not found: ${name}`);
    }
}

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

/** ---------------------------
 *  Compute engine (custom functions only)
 *  --------------------------- */

/**
 * 注册自定义函数
 * @param {string} name - 函数名称
 * @param {Function} fn - 函数实现
 */
function registerCustomFunction(name, fn) {
    if (typeof name !== "string" || !name.trim()) {
        throw new Error("函数名称必须是非空字符串");
    }
    if (typeof fn !== "function") {
        throw new Error("函数必须是 Function 类型");
    }
    customFunctions[name] = fn;
}

function resolveValueFromPath(path, fillCache = null) {
    // 支持 valueFrom: "extract.abc" / "page.xxx" / "fill.xxx" / "FGJ4" (直接 ID 引用)
    // page.xxx 或 fill.xxx 表示从页面元素或填充缓存中读取值
    // fillCache: 当前填充过程中的缓存对象，优先从缓存读取（支持引用刚计算但未写入的值）
    if (!path || typeof path !== "string") return "";
    const [root, ...rest] = path.split(".");
    if (root === "extract") return state.store.extract[rest.join(".")] ?? "";
    if (root === "page" || root === "fill") {
        const elementId = rest.join(".");
        // 优先从填充缓存中读取（支持引用刚计算但未写入的值）
        if (fillCache && fillCache.hasOwnProperty(elementId)) {
            return fillCache[elementId] ?? "";
        }
        // 如果缓存中没有，则从页面元素中读取
        return readValue(elementId) ?? "";
    }
    if (root === "crossSite") {
        // format: crossSite.b1, crossSite.b2, crossSite.rSquared ...
        // rest might be "b1", "rSquared"
        const key = rest.join(".");

        // Handle rSquared from computed
        if (key === "rSquared") {
            return state.store.computed && state.store.computed['crossSite.rSquared'] !== undefined
                ? state.store.computed['crossSite.rSquared']
                : "";
        }

        // Handle b0, b1, b2, etc.
        if (key.startsWith("b")) {
            const indexStr = key.slice(1); // "0", "1", ...
            const index = parseInt(indexStr, 10);
            if (!isNaN(index) && index >= 0) {
                // index is 0-based
                const batchIndex = index;
                if (state.store.crossSiteResults && state.store.crossSiteResults[batchIndex]) {
                    return state.store.crossSiteResults[batchIndex].b ?? "";
                }
            }
        }
        return "";
    }
    if (root === "custom") {
        const val = state.custom && state.custom[rest.join(".")] !== undefined
            ? state.custom[rest.join(".")]
            : "";
        console.log(`[TM] Resolve custom.${rest.join(".")}:`, val);
        return val;
    }

    // Fallback: 如果没有匹配任何前缀，尝试作为直接 ID 引用
    // 这支持 valueFrom: "FGJ4" 这样的简单引用
    // 优先从 fillCache 查找（支持引用刚计算的值）
    if (fillCache && fillCache.hasOwnProperty(path)) {
        return fillCache[path] ?? "";
    }

    // 如果 fillCache 中没有，尝试从页面元素读取
    return readValue(path) ?? "";
}

function resolveArgs(args, fillCache = null) {
    console.log("[TM] resolveArgs input:", args);
    if (!Array.isArray(args)) return [];
    return args.map(arg => {
        // 如果是字符串
        if (typeof arg === "string") {
            // 1. 优先检查是否是路径格式（extract.xxx、computed.xxx、page.xxx、fill.xxx、crossSite.xxx、custom.xxx）
            if (arg.startsWith("extract.") || arg.startsWith("computed.") || arg.startsWith("page.") || arg.startsWith("fill.") || arg.startsWith("crossSite.") || arg.startsWith("custom.")) {
                return resolveValueFromPath(arg, fillCache);
            }
            // 2. 如果不是路径格式，检查是否是填充缓存中的字段ID
            if (fillCache && fillCache.hasOwnProperty(arg)) {
                return fillCache[arg];
            }
            // 3. 如果都不匹配，返回原值（可能是普通字符串或数字字符串）
            return arg;
        }
        // 非字符串直接返回
        return arg;
    });
}

function callCustomFunction(fnName, args = [], fillCache = null) {
    if (!fnName || typeof fnName !== "string") {
        throw new Error("函数名称无效");
    }
    const fn = customFunctions[fnName];
    if (!fn) {
        throw new Error(`未找到自定义函数: ${fnName}`);
    }
    const resolvedArgs = resolveArgs(args, fillCache);
    console.log(`[TM] Call ${fnName} args:`, resolvedArgs);
    try {
        return fn(...resolvedArgs);
    } catch (e) {
        throw new Error(`调用函数 ${fnName} 时出错: ${String(e?.message || e)}`);
    }
}

// ========== 自定义函数注册区域 ==========

// 动力学法测杨氏模量：

// 铝的杨氏模量计算函数（输出：×10¹⁰ N/m² 对应的数值）
registerCustomFunction("calculateEForAl", (f) => {
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());
    const fVal = parseNum(f); // 基频f₀（Hz）

    const m = 0.0153; // kg
    const l = 0.2; // m
    const d = 0.00601; // m
    const coefficient = 1.6067;
    const T1 = 1.005; // 修正因子

    // 计算核心项
    const term = (Math.pow(l, 3) * m) / Math.pow(d, 4);
    const E_Pa = coefficient * term * Math.pow(fVal, 2) * T1; // 单位：Pa
    const E_1e10 = E_Pa / 1e10; // 转换为×10¹⁰ N/m²

    return Number(E_1e10.toFixed(2)); // 返回该量级下的数值
});
// 铜的杨氏模量计算函数（输出：×10¹⁰ N/m² 对应的数值）
registerCustomFunction("calculateEForCu", (f) => {
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());
    const fVal = parseNum(f); // 基频f₀（Hz）

    const m = 0.0486; // kg
    const l = 0.2; // m
    const d = 0.00600; // m
    const coefficient = 1.6067;
    const T1 = 1.005; // 修正因子

    // 计算核心项
    const term = (Math.pow(l, 3) * m) / Math.pow(d, 4);
    const E_Pa = coefficient * term * Math.pow(fVal, 2) * T1; // 单位：Pa
    const E_1e10 = E_Pa / 1e10; // 转换为×10¹⁰ N/m²

    return Number(E_1e10.toFixed(2)); // 返回该量级下的数值
});
// 铝的误差百分比计算（输入e为×10¹⁰量级的实验值）
registerCustomFunction("calculateErrorForAl", (e) => {
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());
    const measuredVal = parseNum(e); // 实验值（×10¹⁰ N/m²）
    const standardVal = 7.0; // 铝标准值（×10¹⁰ N/m²）

    // 计算相对误差百分比（无%符号，保留3位小数）
    const absoluteError = Math.abs(measuredVal - standardVal);
    const errorPercent = (absoluteError / standardVal) * 100;

    // 返回数值（如21.454，而非21.454%）
    return parseFloat(errorPercent.toFixed(2));
});
// 铜的误差百分比计算（输入e为×10¹⁰量级的实验值）
registerCustomFunction("calculateErrorForCu", (e) => {
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());
    const measuredVal = parseNum(e); // 实验值（×10¹⁰ N/m²）
    const standardVal = 9.69; // 铜标准值（×10¹⁰ N/m²）

    // 计算相对误差百分比（无%符号，保留3位小数）
    const absoluteError = Math.abs(measuredVal - standardVal);
    const errorPercent = (absoluteError / standardVal) * 100;

    // 返回数值（如21.454，而非21.454%）
    return parseFloat(errorPercent.toFixed(2));
});



// 分光计实验：
registerCustomFunction("degMinToDecimal", (degMin) => {
    const num = parseFloat(String(degMin ?? "").replace(/,/g, "").trim());
    if (!Number.isFinite(num)) return 0;
    const degrees = Math.floor(num);
    const minutes = Math.round((num - degrees) * 100);
    const decimalDeg = degrees + minutes / 60;
    return decimalDeg.toFixed(2);
});
// 计算顶角测量值 An
registerCustomFunction("getPrismVertexAngle", (left1, left2, right1, right2) => {
    // 解析并清洗数值（处理逗号、空值、非数字，保证鲁棒性）
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };

    // 解析四个读数：left1=左游标1, left2=左游标2, right1=右游标1, right2=右游标2
    const l1 = parseNum(left1);
    const l2 = parseNum(left2);
    const r1 = parseNum(right1);
    const r2 = parseNum(right2);

    // 计算单组游标读数差（取绝对值），并修正分光计特有的“超过180°取补角”逻辑
    const calcAngleDiff = (num1, num2) => {
        let diff = Math.abs(num1 - num2);
        // 分光计游标最大有效差值为180°，超过则取360°-diff（比如差值200°实际等价于160°）
        return diff > 180 ? 360 - diff : diff;
    };

    // 核心计算：(左1-左2绝对值 + 右1-右2绝对值) / 4
    const leftDiff = calcAngleDiff(l1, l2);   // 左游标差值（已修正超180°情况）
    const rightDiff = calcAngleDiff(r1, r2);  // 右游标差值（已修正超180°情况）
    const avgDiff = (leftDiff + rightDiff) / 4;

    return Number(avgDiff.toFixed(2));
});
// 计算顶角 A
registerCustomFunction("calculateA", (a, b, c, d, e) => {
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };
    const numA = parseNum(a);
    const numB = parseNum(b);
    const numC = parseNum(c);
    const numD = parseNum(d);
    const numE = parseNum(e);
    const res = (numA + numB + numC + numD + numE) / 5;
    return res.toFixed(2);
});
// 计算顶角 A 的不确定度 ua
registerCustomFunction("calculateUa", (a, b, c, d, e) => {
    const values = [a, b, c, d, e].map(item => {
        const num = parseFloat(String(item ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    });
    const N = values.length;
    const meanA = values.reduce((sum, val) => sum + val, 0) / N;
    const sumOfSquares = values.reduce((sum, val) => sum + Math.pow(val - meanA, 2), 0);
    const sA = Math.sqrt(sumOfSquares / (N - 1));
    const uA = sA / Math.sqrt(N);
    return uA.toFixed(3);
});
// 计算最小偏向角 σmin
registerCustomFunction("calculateSigmaMin", (left1, left2, right1, right2) => {
    // 1. 解析并清洗数值（处理逗号、空值、非数字，保证输入容错）
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };

    // 2. 解析四个读数：left1=出射左游标, left2=入射左游标, right1=出射右游标, right2=入射右游标
    const l1 = parseNum(left1); // 出射光左游标读数
    const l2 = parseNum(left2); // 入射光左游标读数
    const r1 = parseNum(right1); // 出射光右游标读数
    const r2 = parseNum(right2); // 入射光右游标读数

    // 3. 计算单游标偏向角（修正超过180°的情况，分光计角度差≤180°）
    const calcAngleDiff = (outNum, inNum) => {
        let diff = Math.abs(outNum - inNum);
        return diff > 180 ? 360 - diff : diff; // 超过180°取补角
    };

    // 4. 双游标偏向角取平均（消除偏心差）
    const leftDiff = calcAngleDiff(l1, l2); // 左游标偏向角
    const rightDiff = calcAngleDiff(r1, r2); // 右游标偏向角
    const sigmaMin = (leftDiff + rightDiff) / 2; // 最小偏向角=（左+右）/2

    // 5. 保留2位小数，返回数值型（如需字符串可保留 .toString()）
    return Number(sigmaMin.toFixed(2));
});
// 计算折射率 n
registerCustomFunction("calculateN", (a, b) => {
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };
    const A_avg = parseNum(a);
    const delta_min = parseNum(b);
    const radHalfA = Math.PI * (A_avg / 2) / 180;
    const radHalfADelta = Math.PI * ((A_avg + delta_min) / 2) / 180;
    const sinHalfA = Math.sin(radHalfA);
    const sinHalfADelta = Math.sin(radHalfADelta);
    let n = sinHalfADelta / sinHalfA;
    if (!Number.isFinite(n)) { n = 0; }
    return n.toFixed(3);
});

// 霍尔效应实验：
registerCustomFunction("calculateNHallCoefficient", (a) => {
    const q = 1.60e-19;
    const strVal = String(a ?? "").replace(/,/g, "").trim();
    if (!strVal) return ""; // Return empty if input is empty

    const num = parseFloat(strVal);
    if (!Number.isFinite(num)) return ""; // Return empty if input is not a number

    const RH = num;
    const n = 1 / (RH * q);
    const getCoefficient = (num) => {
        if (num === 0) return 0;
        const exponent = Math.floor(Math.log10(Math.abs(num)));
        const coefficient = (num / Math.pow(10, exponent)).toFixed(3);
        return parseFloat(coefficient);
    };
    return getCoefficient(n);
});
registerCustomFunction("calculateNHallExponent", (a) => {
    const q = 1.60e-19;
    const strVal = String(a ?? "").replace(/,/g, "").trim();
    if (!strVal) return ""; // Return empty if input is empty

    const num = parseFloat(strVal);
    if (!Number.isFinite(num)) return ""; // Return empty if input is not a number

    const RH = num;
    const n = 1 / (RH * q);
    const getExponent = (num) => {
        if (num === 0) return 0;
        return Math.floor(Math.log10(Math.abs(num)));
    };
    return getExponent(n);
});
// 计算Rh
registerCustomFunction("computeRhFromIS", (b, c) => {
    // 常量（标准单位）
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());

    const bVal = parseNum(b);
    const cVal = parseNum(c);

    const C = cVal;        // T/A
    const d = 260e-6;       // m
    const Im = 0.5;         // A

    // 霍尔系数计算
    const Rh = (bVal * d) / (C * Im);

    // 保留 4 位小数
    return Rh.toFixed(4);
});
registerCustomFunction("computeRhFromIM", (b, c) => {
    // 常量（标准单位）
    const parseNum = (val) => parseFloat(String(val ?? "").replace(/,/g, "").trim());

    const bVal = parseNum(b);
    const cVal = parseNum(c);

    const C = cVal;        // T/A
    const d = 260e-6;       // m
    const Is = 0.003;       // A

    // b 的单位：mV/mA ≡ V/A
    const Rh = (bVal * d) / (C * Is);

    return Rh.toFixed(4);
});

// 波尔共振仪实验：
registerCustomFunction("multiply3T", (beta, t) => {
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };
    const numBeta = parseNum(beta);
    const numT = parseNum(t);
    const res = numBeta * numT * 3;
    return res.toFixed(3);
});
registerCustomFunction("dividedby3", (a, b, c) => {
    const parseNum = (val) => {
        const num = parseFloat(String(val ?? "").replace(/,/g, "").trim());
        return Number.isFinite(num) ? num : 0;
    };
    const numA = parseNum(a);
    const numB = parseNum(b);
    const numC = parseNum(c);
    const res = (numA + numB + numC) / 3;
    return res.toFixed(3);
});
// 比例系数 CB = B / Uc（单位：T/V）
registerCustomFunction("calculateCBValue", () => {
    const R2 = 51.0e3;      // Ω
    const C = 4.70e-6;      // F
    const N2 = 200;         // 匝
    const S = 75e-6;        // m²

    const CB = (R2 * C) / (N2 * S); // T / V
    return Number(CB.toPrecision(4)); // 4 位有效数字
});
// 比例系数 CH = H / U1（单位：A·m⁻¹ / V）
registerCustomFunction("calculateCHValue", () => {
    const N1 = 200;        // 匝
    const R1 = 2.0;        // Ω
    const l = 95.8e-3;     // m

    const CH = N1 / (l * R1); // A·m⁻¹ / V

    return Number(CH.toPrecision(4)); // 保留 4 位有效数字
});
// 相对磁导率 μr 的极大值计算函数
registerCustomFunction("calculateMuRMax", (
    UI0, UI1, UI2, UI3, UI4, UI5, UI6, UI7, UI8, UI9,
    UC0, UC1, UC2, UC3, UC4, UC5, UC6, UC7, UC8, UC9
) => {
    const parseNum = (val) =>
        parseFloat(String(val ?? "").replace(/,/g, "").trim());

    // === 仪器与样品参数（来自题目） ===
    const N1 = 200;
    const N2 = 200;
    const R1 = 2.0;          // Ω
    const R2 = 51.0e3;       // Ω
    const C = 4.70e-6;      // F
    const S = 75e-6;        // m²
    const l = 95.8e-3;      // m
    const mu0 = 4 * Math.PI * 1e-7; // H/m

    // 比例系数
    const CB = (R2 * C) / (N2 * S);      // B / Uc
    const CH = N1 / (l * R1);            // H / U1

    const UI = [UI0, UI1, UI2, UI3, UI4, UI5, UI6, UI7, UI8, UI9].map(parseNum);
    const UC = [UC0, UC1, UC2, UC3, UC4, UC5, UC6, UC7, UC8, UC9].map(parseNum);

    let muRMax = 0;

    for (let i = 0; i < 10; i++) {
        if (!UI[i] || !UC[i]) continue;

        const H = CH * UI[i];
        const B = CB * UC[i];
        const muR = B / (mu0 * H);

        if (muR > muRMax) muRMax = muR;
    }

    return Number(muRMax.toPrecision(4)); // 4 位有效数字
});
// 牛顿环曲率半径平均值（单位：mm）
registerCustomFunction("calculateRMean", (
    R0, R1, R2, R3, R4
) => {
    const parseNum = (v) =>
        parseFloat(String(v ?? "").replace(/,/g, "").trim());

    const values = [R0, R1, R2, R3, R4]
        .map(parseNum)
        .filter(v => !isNaN(v));

    if (values.length === 0) return "";

    const sum = values.reduce((a, b) => a + b, 0);
    return Number((sum / values.length).toFixed(3));
});
// 劈尖夹角平均值（单位：10^-3 rad）
registerCustomFunction("calculateThetaMean", (
    T0, T1, T2
) => {
    const parseNum = (v) =>
        parseFloat(String(v ?? "").replace(/,/g, "").trim());

    const values = [T0, T1, T2]
        .map(parseNum)
        .filter(v => !isNaN(v));

    if (values.length === 0) return "";

    const sum = values.reduce((a, b) => a + b, 0);
    return Number((sum / values.length).toFixed(3));
});
// 计算氩原子第一激发电位 U0（V）
registerCustomFunction("calculateU0", (U1, U2, U3, U4) => {
    const parseNum = (v) =>
        parseFloat(String(v ?? "").replace(/,/g, "").trim());

    const u1 = parseNum(U1);
    const u2 = parseNum(U2);
    const u3 = parseNum(U3);
    const u4 = parseNum(U4);

    const deltas = [
        u2 - u1,
        u3 - u2,
        u4 - u3
    ].filter(v => !isNaN(v));

    if (deltas.length === 0) return "";

    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return Number(avg.toFixed(2));
});
// 更稳：平滑 + 窗口极小值 + prominence + 自适应阈值，保证尽量找满 4 个谷
// 传参：k, U1,I1,U2,I2,...,U80,I80
registerCustomFunction("findValleyUk", (k, ...pairs) => {
  const parseNum = (v) => {
    const s = String(v ?? "").replace(/,/g, "").trim();
    if (!s) return NaN;
    const x = parseFloat(s);
    return Number.isFinite(x) ? x : NaN;
  };
  const kk = parseInt(parseNum(k), 10);
  if (!(kk >= 1 && kk <= 4)) return "";

  // 组装 U[], I[]
  const U = [];
  const I = [];
  for (let idx = 0; idx < pairs.length; idx += 2) {
    const u = parseNum(pairs[idx]);
    const i = parseNum(pairs[idx + 1]);
    if (!Number.isFinite(u) || !Number.isFinite(i)) continue;
    U.push(u);
    I.push(i);
  }
  const n = U.length;
  if (n < 7) return "";

  // --- 1) 平滑：移动平均（窗口=5，奇数）
  const smoothWin = 5;
  const halfS = Math.floor(smoothWin / 2);
  const Is = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = i - halfS; j <= i + halfS; j++) {
      if (j < 0 || j >= n) continue;
      s += I[j];
      c++;
    }
    Is[i] = s / c;
  }

  // --- 2) 全局幅度，用于阈值尺度
  let iMin = Is[0], iMax = Is[0];
  for (let i = 1; i < n; i++) {
    if (Is[i] < iMin) iMin = Is[i];
    if (Is[i] > iMax) iMax = Is[i];
  }
  const range = Math.max(1e-12, iMax - iMin);

  // --- 3) 用窗口找“真谷”并计算 prominence
  // 窗口半径：建议 2~4；80点里 3 比较稳
  const w = 3;

  const detectValleys = (promFrac) => {
    const promMin = promFrac * range; // prominence阈值
    const cand = [];

    for (let i = w; i < n - w; i++) {
      // i 必须是窗口内最小
      let isMin = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        if (Is[i] > Is[j]) { isMin = false; break; }
      }
      if (!isMin) continue;

      // prominence：左右窗口最高点 - 谷底
      let leftMax = Is[i - w];
      for (let j = i - w; j <= i - 1; j++) leftMax = Math.max(leftMax, Is[j]);

      let rightMax = Is[i + w];
      for (let j = i + 1; j <= i + w; j++) rightMax = Math.max(rightMax, Is[j]);

      const prom = Math.min(leftMax, rightMax) - Is[i]; // 用较低一侧做prominence更合理
      if (prom >= promMin) {
        cand.push({ u: U[i], idx: i, prom });
      }
    }

    // 去重/间隔约束：避免一个宽谷被挑出多个点（要求 idx 间隔 >= w）
    cand.sort((a, b) => a.u - b.u);
    const filtered = [];
    for (const v of cand) {
      const last = filtered[filtered.length - 1];
      if (!last || Math.abs(v.idx - last.idx) >= w) filtered.push(v);
      else {
        // 同一谷附近选 prominence 更大的
        if (v.prom > last.prom) filtered[filtered.length - 1] = v;
      }
    }
    return filtered;
  };

  // --- 4) 自适应阈值：从严格到宽松，直到找到 >=4 个
  // 你原先 2% 太严格且基于相邻点，这里给一组更合理的prominence比例
  const promSchedule = [0.08, 0.05, 0.03, 0.02, 0.01, 0.005]; // 会逐步放宽
  let valleys = [];
  for (const p of promSchedule) {
    valleys = detectValleys(p);
    if (valleys.length >= 4) break;
  }

  if (valleys.length < kk) return "";

  return Number(valleys[kk - 1].u.toFixed(2));
});
registerCustomFunction("calculateD_G3_FromNormalIncidence", (
    phi0A, phi0B,
    thetaL1A, thetaL1B, thetaR1A, thetaR1B,
    thetaL2A, thetaL2B, thetaR2A, thetaR2B
) => {
    const parseNum = (v) => {
        const x = parseFloat(String(v ?? "").replace(/,/g, "").trim());
        return Number.isFinite(x) ? x : NaN;
    };
    const deg2rad = (deg) => deg * Math.PI / 180;

    const p0A = parseNum(phi0A), p0B = parseNum(phi0B);
    const tL1A = parseNum(thetaL1A), tL1B = parseNum(thetaL1B);
    const tR1A = parseNum(thetaR1A), tR1B = parseNum(thetaR1B);
    const tL2A = parseNum(thetaL2A), tL2B = parseNum(thetaL2B);
    const tR2A = parseNum(thetaR2A), tR2B = parseNum(thetaR2B);

    const arr = [p0A, p0B, tL1A, tL1B, tR1A, tR1B, tL2A, tL2B, tR2A, tR2B];
    if (arr.some(v => !Number.isFinite(v))) return "";

    // PPT: φ_Lm, φ_Rm
    const phiL1 = (Math.abs(tL1A - p0A) + Math.abs(tL1B - p0B)) / 2;
    const phiR1 = (Math.abs(tR1A - p0A) + Math.abs(tR1B - p0B)) / 2;
    const phiL2 = (Math.abs(tL2A - p0A) + Math.abs(tL2B - p0B)) / 2;
    const phiR2 = (Math.abs(tR2A - p0A) + Math.abs(tR2B - p0B)) / 2;

    // λ = 589.3 nm = 0.5893 μm
    const lambda_um = 0.5893;

    const dL1 = (1 * lambda_um) / Math.sin(deg2rad(phiL1));
    const dR1 = (1 * lambda_um) / Math.sin(deg2rad(phiR1));
    const dL2 = (2 * lambda_um) / Math.sin(deg2rad(phiL2));
    const dR2 = (2 * lambda_um) / Math.sin(deg2rad(phiR2));

    const dAvg = (dL1 + dR1 + dL2 + dR2) / 4;

    return Number(dAvg.toPrecision(4)); // 四位有效数字
});
registerCustomFunction("calculateLambda_G5_FromMinDeviation", (
    phi0A, phi0B,
    phi1A, phi1B,
    phi2A, phi2B,
    d_um
) => {
    const parseNum = (v) => {
        const x = parseFloat(String(v ?? "").replace(/,/g, "").trim());
        return Number.isFinite(x) ? x : NaN;
    };
    const deg2rad = (deg) => deg * Math.PI / 180;

    const p0A = parseNum(phi0A), p0B = parseNum(phi0B);
    const p1A = parseNum(phi1A), p1B = parseNum(phi1B);
    const p2A = parseNum(phi2A), p2B = parseNum(phi2B);
    const d = parseNum(d_um);

    const arr = [p0A, p0B, p1A, p1B, p2A, p2B, d];
    if (arr.some(v => !Number.isFinite(v))) return "";

    // PPT: δm
    const delta1 = (Math.abs(p1A - p0A) + Math.abs(p1B - p0B)) / 2;
    const delta2 = (Math.abs(p2A - p0A) + Math.abs(p2B - p0B)) / 2;

    // PPT: λm = (2d/|m|) * sin(δm/2)
    const lambda1_um = (2 * d / 1) * Math.sin(deg2rad(delta1 / 2));
    const lambda2_um = (2 * d / 2) * Math.sin(deg2rad(delta2 / 2));

    const lambdaAvg_nm = ((lambda1_um + lambda2_um) / 2) * 1000; // μm -> nm

    return Number(lambdaAvg_nm.toPrecision(4)); // 四位有效数字
});

/** ---------------------------
 *  AI Module (Doubao API Integration)
 *  --------------------------- */

function aiRecognizeCaptcha(imgElement) {
    return new Promise(async (resolve, reject) => {
        tmLog("AI 验证码识别开始（使用豆包 API）", "info");

        try {
            // 1. Convert image to base64
            tmLog("步骤 1: 转换验证码图片为 base64", "info");

            // Wait for image to load if not already loaded
            if (!imgElement.complete || imgElement.naturalWidth === 0) {
                tmLog("等待图片加载完成...", "info");
                await new Promise((resolve, reject) => {
                    imgElement.onload = resolve;
                    imgElement.onerror = () => reject(new Error("图片加载失败"));
                    // Timeout after 5 seconds
                    setTimeout(() => reject(new Error("图片加载超时")), 5000);
                });
            }

            const canvas = document.createElement("canvas");
            canvas.width = imgElement.naturalWidth || imgElement.width;
            canvas.height = imgElement.naturalHeight || imgElement.height;

            if (canvas.width === 0 || canvas.height === 0) {
                tmLog("图片尺寸无效: " + canvas.width + "x" + canvas.height, "error");
                reject(new Error("图片尺寸无效"));
                return;
            }

            const ctx = canvas.getContext("2d");
            ctx.drawImage(imgElement, 0, 0);

            const dataUrl = canvas.toDataURL("image/png");
            const base64Image = dataUrl.split(',')[1]; // Remove "data:image/png;base64," prefix
            tmLog("图片转换完成，大小: " + Math.round(base64Image.length / 1024) + "KB", "success");

            // 2. Call Doubao API
            tmLog("步骤 2: 调用豆包 API", "info");

            // Get API key from localStorage or prompt user
            let apiKey = localStorage.getItem("__tm_doubao_api_key");
            if (!apiKey) {
                apiKey = prompt("请输入豆包 API Key (ARK_API_KEY):");
                if (!apiKey) {
                    tmLog("未提供 API Key，取消识别", "error");
                    reject(new Error("未提供 API Key"));
                    return;
                }
                localStorage.setItem("__tm_doubao_api_key", apiKey);
            }

            const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "doubao-1.5-vision-lite-250315",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/png;base64,${base64Image}`
                                    }
                                },
                                {
                                    type: "text",
                                    text: "识别图片验证码，只回答内容"
                                }
                            ]
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                tmLog(`API 调用失败: ${response.status} ${errorText}`, "error");
                reject(new Error(`API 调用失败: ${response.status}`));
                return;
            }

            const result = await response.json();
            tmLog("API 响应: " + JSON.stringify(result), "info");

            // Extract captcha text from Chat API response
            // Response structure: result.choices[0].message.content
            let captchaText = "";
            try {
                if (result.choices && Array.isArray(result.choices) && result.choices.length > 0) {
                    const firstChoice = result.choices[0];
                    if (firstChoice.message && firstChoice.message.content) {
                        captchaText = firstChoice.message.content;
                    }
                }
            } catch (e) {
                tmLog("解析响应失败: " + e.message, "error");
            }

            captchaText = String(captchaText).trim();

            if (captchaText) {
                tmLog("AI 识别成功: " + captchaText, "success");
                resolve(captchaText);
            } else {
                tmLog("API 返回为空或解析失败", "error");
                reject(new Error("API 返回为空"));
            }

        } catch (e) {
            tmLog("AI 识别失败: " + e.message, "error");
            reject(e);
        }
    });
}

/** ---------------------------
 *  Generic Doubao API Call
 *  --------------------------- */
async function callDoubaoAPI(promptText, imageBase64 = null, model = "doubao-seed-1-6-vision-250815") {
    tmLog("调用豆包 API (Model: " + model + ")", "info");

    try {
        // Get API key
        let apiKey = localStorage.getItem("__tm_doubao_api_key");
        if (!apiKey) {
            apiKey = prompt("请输入豆包 API Key (ARK_API_KEY):");
            if (!apiKey) {
                throw new Error("未提供 API Key");
            }
            localStorage.setItem("__tm_doubao_api_key", apiKey);
        }

        // Build content array
        const content = [];
        if (imageBase64) {
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:image/png;base64,${imageBase64}`
                }
            });
        }
        content.push({
            type: "text",
            text: promptText
        });

        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: [{
                    role: "user",
                    content: content
                }]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 调用失败: ${response.status} ${errorText}`);
        }

        const result = await response.json();

        // Extract text from response
        let responseText = "";
        if (result.choices && Array.isArray(result.choices) && result.choices.length > 0) {
            const firstChoice = result.choices[0];
            if (firstChoice.message && firstChoice.message.content) {
                responseText = firstChoice.message.content;
            }
        }

        responseText = String(responseText).trim();

        if (responseText) {
            tmLog("API 调用成功", "success");
            return responseText;
        } else {
            throw new Error("API 返回为空");
        }

    } catch (e) {
        tmLog("API 调用失败: " + e.message, "error");
        throw e;
    }
}

/** ---------------------------
 *  Doubao Page Side Logic (DEPRECATED - No longer needed with API)
 *  --------------------------- */
async function runDoubaoGuestLogic() {
    // This function is no longer needed when using API
    // Kept for backward compatibility
    console.log("[TM] runDoubaoGuestLogic called but not needed with API");
}

/** ---------------------------
 *  API Key Management
 *  --------------------------- */

/**
 * 重置 API Key
 */
function resetApiKey() {
    localStorage.removeItem("__tm_doubao_api_key");
    tmLog("API Key 已清除，下次使用时会提示重新输入", "success");
}

/**
 * 获取 API Key
 * @returns {string|null} - API Key
 */
function getApiKey() {
    return localStorage.getItem("__tm_doubao_api_key");
}

/** ---------------------------
 *  Recognition Service
 *  处理实验数据识别的业务逻辑
 *  --------------------------- */

/**
 * 识别实验数据并返回填充数据
 * @param {Object} profile - 当前配置
 * @param {string} studentId - 学号
 * @returns {Promise<Array>} - 填充数据数组 [{id, value}, ...]
 */
async function recognizeExperimentData(profile, studentId) {
    if (!profile || !profile.prompts) {
        throw new Error("当前配置未定义 prompts");
    }

    // Find textRecognition prompts
    const recognitionPrompts = profile.prompts.filter(p => p.type === "textRecognition");
    if (recognitionPrompts.length === 0) {
        throw new Error("当前配置中没有 textRecognition 类型的 prompt");
    }

    if (!studentId) {
        throw new Error("未找到学号信息，请先登录");
    }

    const allFillData = [];

    for (const promptConfig of recognitionPrompts) {
        const { value: promptText, recognitionSource } = promptConfig;
        if (!promptText || !recognitionSource) {
            tmLog("跳过不完整的 prompt 配置", "warn");
            continue;
        }

        // Find image file
        const imagePath = `personalData/${studentId}/${recognitionSource}`;
        let imageFile = null;
        for (const file of state.configFiles) {
            if (file.webkitRelativePath && file.webkitRelativePath.toLowerCase().includes(imagePath.toLowerCase())) {
                imageFile = file;
                break;
            }
        }

        if (!imageFile) {
            tmLog(`未找到图片: ${imagePath}`, "error");
            continue;
        }

        // Read image as base64
        const reader = new FileReader();
        const base64Image = await new Promise((resolve, reject) => {
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(imageFile);
        });

        tmLog("开始识别实验数据: " + recognitionSource, "info");

        // Call Doubao API
        const responseText = await callDoubaoAPI(promptText, base64Image, promptConfig.model);
        tmLog("API 返回: " + responseText, "info");

        // Parse JSON response
        let fillData;
        try {
            fillData = JSON.parse(responseText);
        } catch (e) {
            tmLog("解析 JSON 失败，尝试提取 JSON 片段", "warn");
            const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                fillData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            } else {
                throw new Error("无法解析 API 返回的 JSON");
            }
        }

        // Support both object format {"id": "value"} and array format [{"id": "x", "value": "y"}]
        let fillEntries;
        if (Array.isArray(fillData)) {
            fillEntries = fillData.map(item => ({ id: item.id, value: item.value }));
        } else if (typeof fillData === 'object' && fillData !== null) {
            fillEntries = Object.entries(fillData).map(([id, value]) => ({ id, value }));
        } else {
            throw new Error("API 返回的数据格式不正确");
        }

        allFillData.push(...fillEntries);
    }

    return allFillData;
}

/** ---------------------------
 *  Answer Service
 *  处理答案生成的业务逻辑
 *  --------------------------- */

/**
 * 生成实验问题答案
 * @param {Object} profile - 当前配置
 * @returns {Promise<Object>} - 返回 {type: 'multiple'|'single', data: ...}
 */
async function generateExperimentAnswer(profile) {
    if (!profile || !profile.prompts) {
        throw new Error("当前配置未定义 prompts");
    }

    const answerPrompts = profile.prompts.filter(p => p.type === "generateAnswer");
    if (answerPrompts.length === 0) {
        throw new Error("当前配置中没有 generateAnswer 类型的 prompt");
    }

    const results = [];

    for (const promptConfig of answerPrompts) {
        const { value: promptText, toFillNode } = promptConfig;
        if (!promptText) {
            tmLog("跳过无效 prompt", "warn");
            continue;
        }

        tmLog("正在生成答案...", "info");
        const responseText = await callDoubaoAPI(promptText, null, promptConfig.model);
        tmLog("API 返回数据长度: " + responseText.length, "info");

        // Try parse JSON
        let answers = null;
        try {
            let jsonStr = responseText.trim();
            // 1. Try regex for code blocks (json or generic)
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            // 2. Find first '{' and last '}' to extract valid JSON part if there is preamble text
            const firstBrace = jsonStr.indexOf("{");
            const lastBrace = jsonStr.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
                try {
                    answers = JSON.parse(jsonStr);
                } catch (e) {
                    // Retry with LaTex escape fix: replace \ that is not a valid escape char with \\
                    // Valid JSON escapes: " \ / b f n r t u
                    console.warn("[TM] First JSON parse failed, trying to escape LaTeX backslashes...");
                    const fixedStr = jsonStr.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
                    try {
                        answers = JSON.parse(fixedStr);
                        tmLog("经修复后 JSON 解析成功", "success");
                    } catch (e2) {
                        console.warn("[TM] JSON Rescue Failed:", e2);
                        throw e; // Original error bubble up
                    }
                }
            }
        } catch (e) {
            console.warn("[TM] JSON Parse Failed Final:", e);
        }

        // If JSON parsed successfully and is object with content
        if (answers && typeof answers === "object" && !Array.isArray(answers)) {
            // Robustly extract numbered keys "1", "2", etc.
            // We allow discontinuous keys but we sort them by number value.
            const keys = Object.keys(answers).filter(k => !isNaN(parseInt(k)));

            // Sort keys numerically: "1", "2", "10"
            keys.sort((a, b) => parseInt(a) - parseInt(b));

            if (keys.length > 0) {
                const orderedAnswers = keys.map(k => answers[k]);
                results.push({
                    type: 'multiple',
                    data: orderedAnswers,
                    toFillNode
                });
                tmLog(`解析到 ${orderedAnswers.length} 条答案 (Keys: ${keys.join(",")})`, "success");
                continue;
            }
        }

        // Fallback: single answer
        results.push({
            type: 'single',
            data: responseText,
            toFillNode
        });
    }

    return results;
}

/**
 * 填充答案到编辑器
 * @param {Object|Array} answers - 答案数据
 * @param {string} toFillNode - 目标节点选择器
 */
function fillAnswersToEditors(answers, toFillNode) {
    const escapeHtml = (unsafe) => {
        return String(unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // If parsed as map { "1": "...", "2": "..." }
    if (answers && typeof answers === "object" && !Array.isArray(answers)) {
        const keys = Object.keys(answers).sort();
        const editors = document.querySelectorAll(".wysiwyg-editor");
        const count = keys.length;

        if (editors.length < count) {
            tmLog(`警告: 只有 ${editors.length} 个编辑器，但有 ${count} 个答案`, "warn");
        }

        for (let i = 0; i < count; i++) {
            const key = keys[i];
            const val = answers[key];
            const idx = editors.length - count + i;
            if (idx >= 0 && idx < editors.length) {
                const ed = editors[idx];
                ed.innerHTML = `<p>${escapeHtml(val)}</p>`;
                ed.dispatchEvent(new Event("input", { bubbles: true }));
                tmLog(`已填入答案 [${key}] 到编辑器 #${idx + 1}`, "success");
            }
        }
    } else {
        // Single text fallback
        let target = toFillNode ? document.querySelector(toFillNode) : null;
        if (!target && toFillNode === undefined) {
            const allEd = document.querySelectorAll(".wysiwyg-editor");
            if (allEd.length > 0) target = allEd[allEd.length - 1];
        }

        if (target) {
            const textContent = typeof answers === 'string' ? answers : String(answers);
            if (target.classList && target.classList.contains("wysiwyg-editor")) {
                target.innerHTML = `<p>${escapeHtml(textContent)}</p>`;
            } else if (target.value !== undefined) {
                target.value = textContent;
            } else {
                target.textContent = textContent;
            }
            target.dispatchEvent(new Event("input", { bubbles: true }));
            tmLog("已填入单独答案", "success");
        } else {
            tmLog("未找到目标节点填入答案", "error");
        }
    }
}

/** ---------------------------
 *  Pre-recognition Service
 *  批量预识别与数据填充
 *  --------------------------- */

/**
 * 运行批量预识别 (所有配置)
 * @param {string} studentId - 学号
 */
async function runBatchPreRecognition(studentId) {
    if (!state.config || !state.config.profiles) {
        alert("配置未加载");
        return;
    }

    if (!studentId) {
        alert("请先输入学号");
        return;
    }

    const profiles = state.config.profiles;
    const profileNames = Object.keys(profiles);
    const resultData = {};

    tmLog(`开始批量预识别，共 ${profileNames.length} 个配置...`, "info");

    // UI feedback helper
    const updateBatchStatus = (msg) => {
        const el = document.getElementById("__tm_batch_status");
        if (el) {
            el.style.display = "block";
            el.textContent = msg;
        }
        console.log("[Batch] " + msg);
    };

    let processedCount = 0;

    for (const name of profileNames) {
        const profile = profiles[name];
        updateBatchStatus(`正在处理 (${processedCount + 1}/${profileNames.length}): ${name}`);

        try {
            const profileResult = {
                expName: profile.expName || name,
                fill: [],
                generatedAnswer: null
            };

            // 1. Process Text Recognition (Images)
            if (profile.prompts) {
                const recPrompts = profile.prompts.filter(p => p.type === "textRecognition");
                for (const p of recPrompts) {
                    if (!p.value || !p.recognitionSource) continue;

                    // Find image
                    const imagePath = `personalData/${studentId}/${p.recognitionSource}`;
                    let imageFile = null;
                    if (state.configFiles) {
                        for (const file of state.configFiles) {
                            if (file.webkitRelativePath && file.webkitRelativePath.toLowerCase().includes(imagePath.toLowerCase())) {
                                imageFile = file;
                                break;
                            }
                        }
                    }

                    if (imageFile) {
                        try {
                            const base64 = await readFileAsBase64(imageFile);
                            const response = await callDoubaoAPI(p.value, base64, p.model);

                            // Parse JSON
                            let data = null;
                            try {
                                const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
                                const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : response;
                                data = JSON.parse(jsonStr);
                            } catch (e) { /* ignore */ }

                            if (data) {
                                // Normalize to array of {id, value}
                                if (Array.isArray(data)) {
                                    profileResult.fill.push(...data.map(i => ({ id: i.id, value: i.value })));
                                } else if (typeof data === 'object') {
                                    profileResult.fill.push(...Object.entries(data).map(([k, v]) => ({ id: k, value: v })));
                                }
                            }
                        } catch (e) {
                            tmLog(`[${name}] 图片识别失败: ${e.message}`, "warn");
                        }
                    } else {
                        tmLog(`[${name}] 未找到图片: ${imagePath}`, "warn");
                    }
                }
            }

            // 2. Process Answer Generation (Text)
            if (profile.prompts) {
                const ansPrompts = profile.prompts.filter(p => p.type === "generateAnswer");
                // Combine answers or just take the last one? Usually one answer per profile
                // but if multiple, we might want to store them. 
                // Requirement says: "generatedAnswer": "API result"
                // If multiple, maybe return array or object? 
                // Let's assume one main answer or merge them.

                // For concurrent processing of multiple prompts in one profile:
                const ansPromises = ansPrompts.map(async (p) => {
                    try {
                        return await callDoubaoAPI(p.value, null, p.model);
                    } catch (e) {
                        tmLog(`[${name}] 答案生成失败: ${e.message}`, "warn");
                        return null;
                    }
                });

                const ansResults = await Promise.all(ansPromises);
                const validAns = ansResults.filter(a => a !== null);

                // Simplified storage: if 1 answer, store string. If multiple, store array?
                // The requirement example: generatedAnswer: "API返回值"
                // Let's store the raw API response text. If multiple, join them or store object?
                // Given `fillAnswersToEditors` handles multiple answers via ONE API response (parsed JSON),
                // we probably just want the raw response of the primary prompt.
                // If multiple prompts exist, we might overwrite. Let's use the last valid one or merge.
                if (validAns.length > 0) {
                    profileResult.generatedAnswer = validAns.join("\n\n---\n\n");
                    // Or better: keep robust structure if user wants "last few".
                    // If the API returns JSON for multiple answers, we store that JSON string.
                    if (validAns.length === 1) profileResult.generatedAnswer = validAns[0];
                }
            }

            resultData[name] = profileResult;
            processedCount++;

        } catch (err) {
            console.error(err);
            tmLog(`[${name}] 处理出错: ${err.message}`, "error");
        }
    }

    updateBatchStatus(`批量处理完成。正在生成文件...`);

    // Save/Download
    const filename = `${studentId}_apiRecognizedData.json`;
    const blob = new Blob([JSON.stringify(resultData, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    tmLog(`${filename} 已生成并下载`, "success");
    updateBatchStatus("");
}

/**
 * 从预识别文件填写 (当前配置)
 */
async function fillFromPreRecognizedData(studentId) {
    const profileName = state.activeProfileName;
    if (!profileName) {
        alert("未选择配置");
        return;
    }

    // Find *_apiRecognizedData.json or specifically studentId_apiRecognizedData.json
    let dataFile = null;

    // 首先尝试从 configFiles 中查找（手动上传的情况）
    if (state.configFiles && state.configFiles.length > 0) {
        for (const file of state.configFiles) {
            const name = file.name;
            // Priority: Exact match with studentId, then any file ending with _apiRecognizedData.json
            // Then fallback to generic apiRecognizedData.json
            if (studentId && name === `${studentId}_apiRecognizedData.json`) {
                dataFile = file;
                break;
            }
            if (name.endsWith("_apiRecognizedData.json")) {
                dataFile = file;
                // Continue to see if there's a better match
            }
            if (name === "apiRecognizedData.json") {
                if (!dataFile) dataFile = file;
            }
        }
    }

    // 如果没有找到，且存在文件服务器URL，则从文件服务器获取
    if (!dataFile && window.__tm_file_server_url && studentId) {
        const jsonPath = `personalData/${studentId}/${studentId}_apiRecognizedData.json`;
        const fileServerUrl = `${window.__tm_file_server_url}/${jsonPath}`;

        console.log(`[PreRecognition] 从文件服务器获取: ${fileServerUrl}`);

        try {
            const response = await fetch(fileServerUrl);
            if (response.ok) {
                const jsonText = await response.text();
                // 创建一个虚拟 File 对象
                const blob = new Blob([jsonText], { type: 'application/json' });
                dataFile = new File([blob], `${studentId}_apiRecognizedData.json`, { type: 'application/json' });
                console.log(`[PreRecognition] 成功从文件服务器获取 JSON 文件`);
            } else {
                console.warn(`[PreRecognition] 文件服务器返回 ${response.status}: ${jsonPath}`);
            }
        } catch (e) {
            console.error(`[PreRecognition] 从文件服务器获取 JSON 失败:`, e);
        }
    }

    if (!dataFile) {
        alert("未在加载的目录中找到 apiRecognizedData.json\n请确保已进行“批量预识别”并将生成的文件放入配置目录中重新加载。");
        return;
    }

    try {
        const text = await readFileAsText(dataFile);
        const data = JSON.parse(text);

        const profileData = data[profileName];
        if (!profileData) {
            alert(`未在预识别文件中找到当前配置 (${profileName}) 的数据`);
            return;
        }

        tmLog(`开始从预识别数据填写: ${profileName}`, "info");

        // 1. Fill extracted data (Images)
        if (profileData.fill && Array.isArray(profileData.fill)) {
            let successCount = 0;
            for (const item of profileData.fill) {
                if (item && item.id && item.value != null) {
                    const r = writeValue(item.id, item.value);
                    if (r.ok) successCount++;
                }
            }
            tmLog(`已填写识别数据: ${successCount} 项`, "success");
        }

        // 2. Fill Generated Answer
        if (profileData.generatedAnswer) {
            tmLog("正在填写预生成的答案...", "info");
            // Reuse logic from answerService.js via global function if available
            // Note: We need to parse it if it's JSON, similar to answerService logic.
            // But wait, answerService logic does Parsing + Filling.
            // If we just pass the raw string to `fillAnswersToEditors`, does it parse?
            // Checking answerService.js: `fillAnswersToEditors(answers, ...)` expects `answers` to be OBJECT or STRING.
            // It does NOT parse JSON inside `fillAnswersToEditors`.
            // So we must parse it here first.

            const raw = profileData.generatedAnswer;
            let parsed = null;

            // Try parse JSON
            try {
                let jsonStr = raw.trim();
                const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
                if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

                const firstBrace = jsonStr.indexOf("{");
                const lastBrace = jsonStr.lastIndexOf("}");
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
                    try {
                        parsed = JSON.parse(jsonStr);
                    } catch (e) {
                        // Rescue LaTeX backslashes
                        jsonStr = jsonStr.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
                        parsed = JSON.parse(jsonStr);
                    }
                }
            } catch (e) { }

            // Support numbered keys sorting for multiple answers
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                // Ensure pure numbering
                const keys = Object.keys(parsed).filter(k => !isNaN(parseInt(k)));
                keys.sort((a, b) => parseInt(a) - parseInt(b));
                if (keys.length > 0) {
                    // Pass the whole parsed object or re-ordered?
                    // fillAnswersToEditors in answerService expects object map or string.
                    // And IT DOES THE SORTING internally?
                    // Let's check answerService.js again.
                    // Yes: `const keys = Object.keys(answers).sort();` -> Wait, distinct sort behavior?
                    // My recent fix in answerService was in `generateExperimentAnswer` (Parsing), NOT in `fillAnswersToEditors` (Filling).
                    // `fillAnswersToEditors` has `const keys = Object.keys(answers).sort();` which is lexicographical!! ("1", "10", "2")
                    // I SHOULD FIX `fillAnswersToEditors` too, or sort here and pass array.
                    // `fillAnswersToEditors` handles `typeof answers === "object"`. 

                    // Optimization: Let's reuse the robust parsing/sorting logic by copying or updating answerService.
                    // For now, I will manually handle the array conversion here to be safe and use the "last n editors" logic.

                    const orderedVals = keys.map(k => parsed[k]);
                    const editors = document.querySelectorAll(".wysiwyg-editor");
                    const count = orderedVals.length;

                    for (let i = 0; i < count; i++) {
                        const val = orderedVals[i];
                        const idx = editors.length - count + i;
                        if (idx >= 0 && idx < editors.length) {
                            editors[idx].innerHTML = `<p>${val}</p>`; // rudimentary escape?
                            editors[idx].dispatchEvent(new Event("input", { bubbles: true }));
                        }
                    }
                    tmLog(`已填入 ${count} 个答案 (倒数)`, "success");
                    return;
                }
            }

            // Fallback Single
            if (typeof fillAnswersToEditors === "function") {
                fillAnswersToEditors(raw);
            } else {
                // Inline fallback
                const editors = document.querySelectorAll(".wysiwyg-editor");
                if (editors.length > 0) {
                    editors[editors.length - 1].innerHTML = `<p>${raw}</p>`;
                    editors[editors.length - 1].dispatchEvent(new Event("input", { bubbles: true }));
                    tmLog("已填入单独答案", "success");
                }
            }
        }

    } catch (e) {
        alert("读取或解析文件失败: " + e.message);
    }
}

// Helper
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

/** ---------------------------
 *  Image Upload Service
 *  处理实验图片上传的业务逻辑
 *  --------------------------- */

/**
 * 获取实验图片文件
 * @param {Object} profile - 当前配置
 * @param {string} studentId - 学号
 * @returns {Promise<Object>} - 返回 {file: File, base64: string, targetNode: string}
 */
async function getExperimentImage(profile, studentId) {
    if (!profile || !profile.uploadExpImage) {
        throw new Error("当前配置未定义 uploadExpImage");
    }

    const { toFillNode, source } = profile.uploadExpImage;
    if (!toFillNode || !source) {
        throw new Error("uploadExpImage 配置不完整");
    }

    if (!studentId) {
        throw new Error("未找到学号信息");
    }

    const imagePath = `personalData/${studentId}/${source}`;
    let imageFile = null;

    // 首先尝试从 configFiles 中查找（手动上传的情况）
    for (const file of state.configFiles) {
        if (file.webkitRelativePath && file.webkitRelativePath.toLowerCase().includes(imagePath.toLowerCase())) {
            imageFile = file;
            break;
        }
    }

    // 如果没有找到，且存在文件服务器URL，则从文件服务器获取
    if (!imageFile && window.__tm_file_server_url) {
        const fileServerUrl = `${window.__tm_file_server_url}/${imagePath}`;
        console.log(`[TM] 从文件服务器获取图片: ${fileServerUrl}`);

        try {
            const response = await fetch(fileServerUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const blob = await response.blob();
            imageFile = new File([blob], source, { type: blob.type || 'image/jpeg' });
            console.log(`[TM] 成功从文件服务器获取图片: ${source}`);
        } catch (e) {
            throw new Error(`从文件服务器获取图片失败: ${imagePath} - ${e.message}`);
        }
    }

    if (!imageFile) {
        throw new Error(`未找到图片: ${imagePath}`);
    }

    // Read image as base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
    });

    return {
        file: imageFile,
        base64: base64,
        targetNode: toFillNode
    };
}

/**
 * 插入图片到目标节点
 * @param {string} base64 - 图片 base64
 * @param {Element} targetNode - 目标 DOM 节点
 * @param {File} imageFile - 图片文件对象
 */
/**
 * 插入图片到目标节点 (Strict Mode: Simulated Upload Only)
 * @param {string} base64 - 图片 base64 (Unused for upload, kept for signature compatibility)
 * @param {Element} targetNode - 目标 DOM 节点
 * @param {File} imageFile - 图片文件对象
 */
async function insertImageToNode(base64, targetNode, imageFile) {
    if (targetNode.classList.contains("wysiwyg-editor") || targetNode.contentEditable === "true") {
        // 1. Locate the wrapper
        const wrapper = targetNode.closest(".wysiwyg-container") || targetNode.parentElement;
        if (!wrapper) throw new Error("无法找到编辑器容器 (.wysiwyg-container)");

        // 2. Find and Click the "Insert Image" toolbar button
        // Selector provided by user: a[title="插入图片"]
        const insertBtn = wrapper.querySelector('a.wysiwyg-toolbar-icon[title="插入图片"]');
        if (!insertBtn) {
            throw new Error("未找到“插入图片”按钮 (title='插入图片')");
        }

        insertBtn.click();
        tmLog("已点击插入图片按钮", "info");

        // 3. Wait/Find the file input
        // User described: <input type="file" draggable="true" ...>
        // It should be within the wrapper or document body depending on implementation.
        // Usually it's inside the dropzone created or revealed by the button.

        // Give a small delay for UI to react if necessary, though often synchronous.
        await new Promise(r => setTimeout(r, 100));

        const fileInput = wrapper.querySelector('input[type="file"]') || document.querySelector('input[type="file"][draggable="true"]');

        if (!fileInput) {
            throw new Error("点击按钮后未找到文件输入框 (input[type='file'])");
        }

        // 4. Assign File
        try {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);
            fileInput.files = dataTransfer.files;

            // 5. Dispatch Events
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input", { bubbles: true }));

            tmLog("已模拟文件上传操作", "success");
        } catch (e) {
            throw new Error("模拟上传失败: " + e.message);
        }

    } else if (targetNode.tagName === "INPUT" || targetNode.tagName === "TEXTAREA") {
        // For standard inputs, we cannot "upload" unless it IS a file input. 
        // If it's a text input, user previously accepted base64 val. 
        // But request implies "delete base64 insert mode". 
        // Assume this service is primarily for the WYSIWYG editor image upload.
        // We will throw error for non-supported nodes to be strict as requested.
        throw new Error("目标节点不是富文本编辑器，不支持图片上传模式。");
    } else {
        throw new Error("不支持的目标节点类型");
    }
}

// fallbackInsert removed as per request.
// syncHidden removed as it was part of fallback logic or specific synchronization.

/** ---------------------------
 *  Image Preview Service
 *  提供图片悬浮预览、缩放、拖拽功能
 *  --------------------------- */

let isPreviewOpen = false;

/**
 * 显示图片预览悬浮窗
 * @param {string} base64 - 图片 Base64 数据
 */
function showImagePreview(base64) {
    if (isPreviewOpen) {
        tmLog("预览窗口已打开", "warn");
        return;
    }

    // 1. Create Container
    const container = document.createElement("div");
    container.id = "__tm_preview_container";
    container.style.cssText = `
        position: fixed; top: 100px; left: 100px; width: 800px; height: 600px;
        background: rgba(0,0,0,0.8); border: 2px solid #58a6ff; border-radius: 8px;
        z-index: 1000000; overflow: hidden; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7); resize: both;
    `;

    // 2. Create Header (Drag Handler & Close)
    const header = document.createElement("div");
    header.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 30px;
        background: rgba(40,60,90,0.8); cursor: move; z-index: 2;
        display: flex; justify-content: flex-end; align-items: center; padding: 0 10px; box-sizing: border-box;
    `;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
        background: none; border: none; color: #fff; font-size: 18px; cursor: pointer;
    `;
    closeBtn.onclick = () => {
        document.body.removeChild(container);
        isPreviewOpen = false;
    };
    header.appendChild(closeBtn);
    container.appendChild(header);

    // 3. Create Image Wrapper
    const imgWrapper = document.createElement("div");
    imgWrapper.style.cssText = `
        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden;
    `;

    // 4. Create Image
    const img = document.createElement("img");
    img.src = base64;
    img.style.cssText = `
        max-width: 100%; max-height: 100%; transition: transform 0.1s; cursor: grab;
    `;
    imgWrapper.appendChild(img);
    container.appendChild(imgWrapper);
    document.body.appendChild(container);

    isPreviewOpen = true;

    // --- Window Drag Logic (Header) ---
    enableDrag(container, header);

    // --- Image Zoom & Pan Logic ---
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDraggingImg = false;
    let startX = 0, startY = 0;

    const updateTransform = () => {
        img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    };

    // Zoom
    container.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        scale *= delta;
        scale = Math.min(Math.max(0.1, scale), 10); // Limit scale
        updateTransform();
    });

    // Pan (Drag Image)
    img.addEventListener("mousedown", (e) => {
        isDraggingImg = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        img.style.cursor = "grabbing";
        e.preventDefault();
        e.stopPropagation(); // prevent window drag
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDraggingImg) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateTransform();
    });

    document.addEventListener("mouseup", () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            img.style.cursor = "grab";
        }
    });
}

/** ---------------------------
 *  Automation Service
 *  执行配置中的自动化流程
 *  --------------------------- */

/**
 * 执行自动化流程
 */
/**
 * 执行自动化流程（依次执行所有配置）
 */
async function runAutomationAction() {
    // 获取所有配置
    if (!state.config || !state.config.profiles) {
        tmLog("配置未加载，无法执行自动化", "warn");
        return;
    }

    const profileNames = Object.keys(state.config.profiles);
    if (profileNames.length === 0) {
        tmLog("没有找到实验配置", "warn");
        return;
    }

    tmLog(`[自动流程] 开始执行所有配置，共 ${profileNames.length} 个实验`, "info");
    const statusEl = document.getElementById("__tm_status_text");

    // Fetch file list for validation
    let fileList = [];
    if (window.__tm_file_server_url) {
        try {
            const sid = window.__tm_student_id || (state.userInfo && state.userInfo.studentId);
            const listUrl = sid
                ? `${window.__tm_file_server_url}/__tm_list_files?student_id=${sid}`
                : `${window.__tm_file_server_url}/__tm_list_files`;

            const resp = await fetch(listUrl);
            if (resp.ok) {
                fileList = await resp.json();
                tmLog(`[自动流程] 文件列表已加载 (${fileList.length} 个文件)`, "info");
            }
        } catch (e) {
            tmLog(`[自动流程] 获取文件列表失败: ${e.message}`, "warn");
        }
    }

    for (let pIndex = 0; pIndex < profileNames.length; pIndex++) {
        const name = profileNames[pIndex];
        const p = state.config.profiles[name];

        // Check image existence if specified in prompts array
        if (p.prompts && Array.isArray(p.prompts)) {
            const promptWithImg = p.prompts.find(item => item.recognitionSource);
            if (promptWithImg) {
                const imgName = promptWithImg.recognitionSource;
                // Only check if it looks like a file (not URL or base64)
                if (typeof imgName === 'string' && !imgName.includes("://") && !imgName.startsWith("data:")) {
                    if (!fileList.includes(imgName)) {
                        tmLog(`[自动流程] 跳过实验 ${name}: 图片文件 ${imgName} 不存在`, "warn");
                        continue;
                    }
                }
            }
        }

        tmLog(`[自动流程 ${pIndex + 1}/${profileNames.length}] 切换到实验: ${name}`, "info");

        // 切换配置
        changeProfile(name);
        if (statusEl) statusEl.textContent = `执行实验: ${name}`;

        // 等待配置切换生效
        await new Promise(r => setTimeout(r, 1000));

        const profile = state.config.profiles[name];
        const autoConfig = profile.automation;

        if (!autoConfig || !autoConfig.autoFlowButtonList || !Array.isArray(autoConfig.autoFlowButtonList) || autoConfig.autoFlowButtonList.length === 0) {
            tmLog(`[自动流程] 配置 ${name} 未定义自动化流程，跳过`, "warn");
            continue;
        }

        const timeIntervalStr = autoConfig.timeInterval || "1s";
        let delayMs = 1000;

        // 新增：配置文件切换/执行间隔
        const profileIntervalStr = autoConfig.profileInterval || "1s";
        let profileDelayMs = 1000;

        // Parse timeInterval
        try {
            const parseTime = (str) => {
                if (typeof str === 'number') return str;
                if (typeof str === 'string') {
                    const lower = str.toLowerCase();
                    if (lower.endsWith("ms")) {
                        return parseFloat(lower);
                    } else if (lower.endsWith("s")) {
                        return parseFloat(lower) * 1000;
                    } else {
                        let val = parseFloat(lower);
                        if (val < 100) val *= 1000;
                        return val;
                    }
                }
                return 1000;
            };

            delayMs = parseTime(timeIntervalStr);
            profileDelayMs = parseTime(profileIntervalStr);

        } catch (e) {
            console.warn("[Automation] time parse error", e);
            delayMs = 1000;
            profileDelayMs = 1000;
        }

        if (isNaN(delayMs) || delayMs < 0) delayMs = 1000;
        if (isNaN(profileDelayMs) || profileDelayMs < 0) profileDelayMs = 1000;

        tmLog(`[自动流程] 执行配置: ${name}，步骤数: ${autoConfig.autoFlowButtonList.length}，间隔: ${delayMs}ms, 实验间隔: ${profileDelayMs}ms`, "info");

        // 在开始执行前添加初始延迟（使用 profileInterval）
        if (pIndex === 0) {
            tmLog(`[自动流程] 等待初始延迟 (${profileDelayMs}ms)...`, "info");
            await new Promise(r => setTimeout(r, profileDelayMs));
        } else {
            // 切换配置间的等待
            tmLog(`[自动流程] 切换配置等待 (${profileDelayMs}ms)...`, "info");
            await new Promise(r => setTimeout(r, profileDelayMs));
        }

        const buttons = autoConfig.autoFlowButtonList;
        for (let i = 0; i < buttons.length; i++) {
            const btnId = buttons[i];

            // Handle selector or ID
            let btn = document.getElementById(btnId);
            if (!btn && btnId.startsWith("#")) {
                btn = document.querySelector(btnId);
            } else if (!btn) {
                btn = document.querySelector(btnId); // try as selector
            }

            if (btn) {
                // Test Mode Interception
                const isTestMode = localStorage.getItem('__tm_test_mode') === 'true';
                if (isTestMode) {
                    const submitCfg = (profile.automation && profile.automation.submit) || (profile.submit);
                    if (submitCfg && submitCfg.selector) {
                        try {
                            if (btnId === submitCfg.selector || (btn.matches && btn.matches(submitCfg.selector))) {
                                tmLog(`[测试模式] 拦截提交操作`, "warn");
                                try {
                                    await showSubmitConfirmationUI();
                                    tmLog(`[测试模式] 用户确认提交`, "info");
                                } catch (e) {
                                    tmLog(`[测试模式] 流程终止`, "error");
                                    break; // Stop loop
                                }
                            }
                        } catch (e) { /* ignore selector error */ }
                    }
                }

                tmLog(`[自动流程 ${i + 1}/${buttons.length}] 点击: ${btn.textContent.trim() || btnId}`, "info");

                // Highlight for visual feedback
                const originalBorder = btn.style.border;
                btn.style.border = "2px solid #ffeb3b";

                // Check special buttons
                const isCrossSiteBtn = btnId === "__tm_btn_cross_site" || btnId === "#__tm_btn_cross_site";
                const isSwitchExpBtn = btnId === "__tm_btn_switch_exp" || btnId === "#__tm_btn_switch_exp";

                btn.click();

                // Restore style after short delay
                setTimeout(() => { btn.style.border = originalBorder; }, 300);

                // If this is switch experiment button, wait for page navigation
                if (isSwitchExpBtn) {
                    tmLog("[自动流程] 检测到切换实验按钮，等待页面加载...", "info");

                    // Wait for page to navigate and load
                    await new Promise((resolve) => {
                        let waitTime = 0;
                        const maxWait = 10000; // 10 seconds max
                        const checkInterval = setInterval(() => {
                            waitTime += 500;
                            const hasExpElements = document.querySelector('.wysiwyg-editor') ||
                                document.querySelector('input[type="file"]') ||
                                document.querySelector('#__tm_panel');

                            if (hasExpElements || waitTime >= maxWait) {
                                clearInterval(checkInterval);
                                if (hasExpElements) {
                                    tmLog("[自动流程] 实验页面已加载", "success");
                                } else {
                                    tmLog("[自动流程] 等待超时，继续执行", "warn");
                                }
                                resolve();
                            }
                        }, 500);
                    });

                    await new Promise(r => setTimeout(r, 2000));
                }

                // If this is cross-site button, wait for batchQueue to complete
                if (isCrossSiteBtn && typeof batchQueue !== 'undefined') {
                    tmLog("[自动流程] 检测到批量处理按钮，等待队列完成...", "info");

                    await new Promise((resolve) => {
                        const checkInterval = setInterval(() => {
                            if (!batchQueue.isRunning) {
                                clearInterval(checkInterval);
                                tmLog("[自动流程] 批量处理已完成", "success");
                                resolve();
                            }
                        }, 500);

                        setTimeout(() => {
                            clearInterval(checkInterval);
                            tmLog("[自动流程] 批量处理超时，继续下一步", "warn");
                            resolve();
                        }, 600000);
                    });
                }

            } else {
                tmLog(`[自动流程] 未找到按钮: ${btnId}`, "warn");
            }

            // 在每个按钮点击后都添加延迟
            await new Promise(r => setTimeout(r, delayMs));
        }

        // 所有按钮点击完成后，等待所有异步操作完成
        tmLog(`[自动流程] 配置 ${name} 执行完毕，等待异步操作完成...`, "info");

        if (typeof batchQueue !== 'undefined' && batchQueue.isRunning) {
            tmLog("[自动流程] 检测到批量处理仍在运行，等待完成...", "info");
            await new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!batchQueue.isRunning) {
                        clearInterval(checkInterval);
                        tmLog("[自动流程] 批量处理已完成", "success");
                        resolve();
                    }
                }, 500);

                setTimeout(() => {
                    clearInterval(checkInterval);
                    tmLog("[自动流程] 批量处理等待超时", "warn");
                    resolve();
                }, 600000);
            });
        }

        // 每个配置完成后额外等待（使用 profileInterval）
        tmLog(`[自动流程] 配置 ${name} 完成，等待 ${profileDelayMs}ms...`, "success");
        await new Promise(r => setTimeout(r, profileDelayMs));
    }

    tmLog("所有自动化流程执行完毕", "success");
    if (statusEl) statusEl.textContent = "所有实验执行完成";
}

/** ---------------------------
 *  Fill Service
 *  字典填充相关业务逻辑
 *  --------------------------- */

/**
 * 根据字典数据填充表单
 * @param {string} jsonData - JSON 字符串
 * @returns {number} - 填充的项数
 */
function fillFromDictionary(jsonData) {
    if (!jsonData || !jsonData.trim()) {
        throw new Error("请输入数据");
    }

    let data = null;
    try {
        data = JSON.parse(jsonData);
    } catch (e1) {
        // Try wrapping in array
        try {
            data = JSON.parse(`[${jsonData}]`);
        } catch (e2) {
            throw new Error("无法解析数据。请确保格式正确(JSON对象或数组)");
        }
    }

    let items = [];
    if (Array.isArray(data)) {
        items = data;
    } else if (typeof data === "object") {
        if (data.id && data.value !== undefined) {
            items = [data];
        } else {
            for (const [k, v] of Object.entries(data)) {
                items.push({ id: k, value: v });
            }
        }
    }

    let count = 0;
    items.forEach(item => {
        if (item && item.id && item.value !== undefined) {
            const el = document.getElementById(item.id);
            if (el) {
                el.value = item.value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                count++;
            }
        }
    });

    return count;
}

/** ---------------------------
 *  Data Service
 *  自定义数据管理服务
 *  --------------------------- */

/**
 * 获取自定义数据
 * @param {string} key - 键
 * @returns {*} - 值
 */
function getCustomData(key) {
    if (!state.custom) return undefined;
    return state.custom[key];
}

/**
 * 设置自定义数据
 * @param {string} key - 键
 * @param {*} value - 值
 */
function setCustomData(key, value) {
    if (!state.custom) state.custom = {};
    state.custom[key] = value;
}

/**
 * 删除自定义数据
 * @param {string} key - 键
 * @returns {boolean} - 是否删除成功
 */
function deleteCustomData(key) {
    if (!state.custom || !state.custom[key]) return false;
    delete state.custom[key];
    return true;
}

/**
 * 获取所有自定义数据
 * @returns {Object} - 所有数据
 */
function getAllCustomData() {
    return state.custom || {};
}

/** ---------------------------
 *  Auth Service
 *  认证相关服务
 *  --------------------------- */

/**
 * 执行手动登录
 * @param {string} studentId - 学号
 */
async function performManualLogin(studentId) {
    const userInp = document.getElementById("userName");
    const passInp = document.getElementById("userPass");
    const codeInp = document.getElementById("checkCode");
    const loginBtn = document.querySelector(".loginBut");

    if (!userInp || !passInp) {
        throw new Error("未检测到登录表单，请确认您在登录页面");
    }

    if (!studentId || !studentId.trim()) {
        throw new Error("请输入学号");
    }

    // Fill username and password
    userInp.value = studentId;
    passInp.value = studentId;
    userInp.dispatchEvent(new Event("input", { bubbles: true }));
    passInp.dispatchEvent(new Event("input", { bubbles: true }));

    // AI Captcha recognition
    const img = document.getElementById("imgCheckCode");
    if (img && typeof aiRecognizeCaptcha === "function") {
        try {
            const code = await aiRecognizeCaptcha(img);
            if (code && codeInp) {
                codeInp.value = code;
                codeInp.dispatchEvent(new Event("input", { bubbles: true }));
                // Auto click login
                if (loginBtn) {
                    loginBtn.click();
                    return { success: true, autoLogin: true };
                }
            }
        } catch (e) {
            console.warn("[TM] Manual Login AI Error:", e);
            if (codeInp) codeInp.focus();
            return { success: false, error: e.message, needManualCaptcha: true };
        }
    } else if (codeInp) {
        codeInp.focus();
        return { success: true, autoLogin: false, needManualCaptcha: true };
    }

    return { success: true, autoLogin: false };
}

/** ---------------------------
 *  Validator Service
 *  验证相关业务逻辑
 *  --------------------------- */

/**
 * 验证填写状态
 * @param {Object} profile - 当前配置
 * @param {Array<string>} exclusions - 排除项选择器列表
 * @returns {Object} - { unfilled: Array<Element>, candidates: Array<Element> }
 */
function validateFillStatus(profile, exclusions = []) {
    const candidates = Array.from(document.querySelectorAll("input, textarea, select, .wysiwyg-editor"));

    const unfilled = candidates.filter(el => {
        // 1. Basic Filters for Input/Textarea/Select
        if (el.tagName === "INPUT") {
            const t = el.type.toLowerCase();
            if (t === "hidden" || t === "button" || t === "submit" || t === "image" || t === "file" || el.disabled) return false;
        }
        if ((el.tagName === "TEXTAREA" || el.tagName === "SELECT") && el.disabled) return false;

        // 2. Exclusion (ID or Selector)
        // Support exact ID match OR selector match
        if (el.id && exclusions.includes(el.id)) return false; // Legacy/Simple check

        // Advanced check: Iterate exclusions and see if element matches selector
        const isExcluded = exclusions.some(selector => {
            try {
                return el.matches(selector);
            } catch (e) {
                // selector might be a simple ID without #, check standard ID equality
                return el.id === selector;
            }
        });
        if (isExcluded) return false;

        // 3. Check Value
        let val = "";
        let hasContent = false;

        if (el.classList.contains("wysiwyg-editor")) {
            const text = el.textContent.trim();
            const html = el.innerHTML.trim();
            // Check if it has text OR images
            if (text) hasContent = true;
            if (html.includes("<img")) hasContent = true;
        } else {
            val = el.value.trim();
            if (val) hasContent = true;
        }

        if (!hasContent) {
            // Highlight
            el.classList.add("tm-unfilled-highlight");
            return true;
        } else {
            // Clear highlight
            el.classList.remove("tm-unfilled-highlight");
            return false;
        }
    });

    return { unfilled, candidates };
}

/** ---------------------------
 *  CrossSite Service
 *  跨站批量处理相关业务逻辑
 *  --------------------------- */

/**
 * 在目标网站执行操作
 * @param {Object} config - 跨站配置
 * @param {Array<string|Object>} strings - 字符串数组（至少2个），可以是字符串或包含 string 和 equationType 的对象
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 操作结果
 */
async function executeCrossSiteOperation(config, strings, onProgress) {
    if (!config || !config.targetUrl) {
        throw new Error("跨站配置无效：缺少 targetUrl");
    }

    if (!Array.isArray(strings) || strings.length < 2) {
        throw new Error("字符串数组至少需要2个元素");
    }

    // 处理字符串和方程类型
    const getStringAndType = (item, index) => {
        if (typeof item === "string") {
            return { string: item, equationType: config.equationType || "07" };
        } else if (typeof item === "object" && item !== null) {
            return {
                string: item.string || "",
                equationType: item.equationType || config.equationType || "07"
            };
        }
        return { string: String(item ?? ""), equationType: config.equationType || "07" };
    };

    const first = getStringAndType(strings[0], 0);
    const second = getStringAndType(strings[1], 1);

    // 使用第一个字符串的方程类型（同一批次使用相同的类型）
    const equationType = first.equationType;
    const xAxisString = first.string;
    const yAxisString = second.string;
    const delays = config.delays || {
        afterFill: 500,
        afterClick: 2000,
        imageLoad: 3000
    };

    return new Promise((resolve, reject) => {
        // 打开新窗口
        const targetWindow = window.open(config.targetUrl, "__tm_cross_site_" + Date.now(), "width=1200,height=800");
        if (!targetWindow) {
            reject(new Error("无法打开新窗口，请允许弹窗"));
            return;
        }

        onProgress?.("正在加载目标页面...");

        // 等待页面加载完成（固定延迟，避免跨域访问问题）
        setTimeout(() => {
            onProgress?.("页面加载完成，开始填写数据...");

            // 使用 try-catch 包装，避免跨域错误导致脚本中断
            try {
                // 构建要注入的脚本内容
                const scriptCode = `
(function() {
  try {
    function waitForElement(selector, callback, maxAttempts = 50) {
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(check);
          callback(el);
        } else if (attempts >= maxAttempts) {
          clearInterval(check);
          window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "元素未找到: " + selector }, "*");
        }
      }, 100);
    }
    
    // 1. 选择方程类型
    waitForElement("select#Select1", (select) => {
      select.value = "${equationType}";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      
      // 2. 填写X轴数据
      waitForElement("#TextArea1", (xInput) => {
        xInput.value = ${JSON.stringify(xAxisString)};
        xInput.dispatchEvent(new Event("input", { bubbles: true }));
        xInput.dispatchEvent(new Event("change", { bubbles: true }));
        
        // 3. 填写Y轴数据
        setTimeout(() => {
          waitForElement("#TextArea2", (yInput) => {
            yInput.value = ${JSON.stringify(yAxisString)};
            yInput.dispatchEvent(new Event("input", { bubbles: true }));
            yInput.dispatchEvent(new Event("change", { bubbles: true }));
            
            // 4. 点击拟合按钮
            setTimeout(() => {
              waitForElement("#Button1", (fitButton) => {
                fitButton.click();
                
                // 5. 等待图片加载并返回 DataURL
                setTimeout(() => {
                  waitForElement("#img1", (img) => {
                    try {
                      const sendImage = (dataUrl) => {
                         window.postMessage({ type: "TM_CROSS_SITE_DONE", success: true, data: dataUrl }, "*");
                      };

                      if (img.tagName === "CANVAS") {
                        sendImage(img.toDataURL("image/png"));
                      } else {
                        const processImg = () => {
                           if (img.naturalWidth > 0) {
                             const canvas = document.createElement("canvas");
                             canvas.width = img.naturalWidth;
                             canvas.height = img.naturalHeight;
                             const ctx = canvas.getContext("2d");
                             ctx.drawImage(img, 0, 0);
                             sendImage(canvas.toDataURL("image/png"));
                           } else {
                             window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片宽度为0" }, "*");
                           }
                        };

                        if (img.complete) {
                          processImg();
                        } else {
                          img.onload = processImg;
                          img.onerror = () => {
                            window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片加载失败" }, "*");
                          };
                        }
                      }
                    } catch (e) {
                      window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "获取图片数据出错: " + e.message }, "*");
                    }
                  }, ${delays.imageLoad});
                }, ${delays.afterClick});
              }, 1000);
            }, ${delays.afterFill});
          });
        }, 500);
      });
    });
  } catch (e) {
    window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: e.message }, "*");
  }
})();
          `.trim();

                // 使用 postMessage 发送操作指令（需要目标网站也运行此脚本）
                try {
                    // 等待目标窗口加载完成后再发送消息
                    targetWindow.postMessage({
                        type: "TM_CROSS_SITE_EXECUTE",
                        equationType: equationType,
                        xAxisString: xAxisString,
                        yAxisString: yAxisString,
                        delays: delays
                    }, "*");
                } catch (e) {
                    reject(new Error("无法发送消息到目标窗口：" + e.message));
                    targetWindow.close();
                    return;
                }

                // 监听完成消息
                let messageReceived = false;
                const messageHandler = (event) => {
                    // 放宽验证：只检查消息类型，不严格检查来源（Playwright 环境下 event.source 可能不匹配）
                    if (!event.data || event.data.type !== "TM_CROSS_SITE_DONE") return;

                    console.log('[CrossSite] 收到完成消息:', event.data);

                    messageReceived = true;
                    window.removeEventListener("message", messageHandler);
                    clearTimeout(timeoutId);

                    if (event.data.success) {
                        onProgress?.("操作完成，已获取图片数据");
                        console.log('[CrossSite] 操作成功，准备关闭窗口');
                        setTimeout(() => {
                            if (!targetWindow.closed) {
                                targetWindow.close();
                            }
                            resolve({
                                ok: true,
                                strings: [xAxisString, yAxisString],
                                imageData: event.data.data,
                                r2: event.data.r2,
                                b: event.data.b
                            });
                        }, 1000);
                    } else {
                        console.error('[CrossSite] 操作失败:', event.data.error);
                        if (!targetWindow.closed) {
                            targetWindow.close();
                        }
                        reject(new Error(event.data.error || "操作失败"));
                    }
                };
                window.addEventListener("message", messageHandler);
                console.log('[CrossSite] 已设置消息监听器');

                // 添加超时处理，避免卡住（总超时时间 = 页面加载3秒 + 填写延迟 + 点击延迟 + 图片加载延迟 + 额外缓冲）
                const totalTimeout = 3000 + delays.afterFill + delays.afterClick + delays.imageLoad + 5000;
                const timeoutId = setTimeout(() => {
                    if (!messageReceived) {
                        console.error('[CrossSite] 操作超时，未收到完成消息');
                        window.removeEventListener("message", messageHandler);
                        if (!targetWindow.closed) {
                            targetWindow.close();
                        }
                        reject(new Error("操作超时：未收到完成消息，可能图片下载失败或页面响应超时"));
                    }
                }, totalTimeout);
                console.log(`[CrossSite] 设置超时: ${totalTimeout}ms`);

            } catch (e) {
                console.error('[CrossSite] 执行操作时出错:', e);
                targetWindow.close();
                reject(new Error("执行操作时出错：" + e.message));
            }
        }, 3000); // 等待3秒让页面加载完成
    });
}

async function insertImageToEditor(batchIndex, imageUrl, selector, editorIndexes) {
    if (!imageUrl) return;

    // 1. Determine target index
    let targetIndex = batchIndex;
    if (Array.isArray(editorIndexes) && editorIndexes[batchIndex] !== undefined) {
        targetIndex = parseInt(editorIndexes[batchIndex], 10);
    }

    if (isNaN(targetIndex)) {
        console.warn(`[TM] Invalid target index for batch ${batchIndex}`);
        return;
    }

    // 2. Find element
    if (selector) {
        const els = document.querySelectorAll(selector);
        const el = els[targetIndex];

        if (el) {
            // Convert base64 to File object
            const imageFile = await base64ToFile(imageUrl, `cross_site_${batchIndex}.png`);

            if ("value" in el) {
                // input/textarea: Append with newline (keep original behavior)
                el.value = (el.value ? el.value + "\n" : "") + imageUrl;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.classList.contains("wysiwyg-editor")) {
                // Use simulated upload method (same as imageUploadService.js)
                try {
                    await insertImageViaSimulatedUpload(imageFile, el);
                    tmLog(`批次 ${batchIndex} 图片已通过模拟上传插入`, "success");
                } catch (e) {
                    console.error(`[TM] 批次 ${batchIndex} 模拟上传失败:`, e);
                    tmLog(`批次 ${batchIndex} 模拟上传失败: ${e.message}`, "error");
                }
            } else {
                console.log("[TM] Target element is not input, cannot insert URL automatically:", el);
            }
        } else {
            console.warn(`[TM] Cannot find editor element at index ${targetIndex} with selector ${selector}`);
        }
        return;
    }

    console.warn("[TM] No 'editorSelector' configured. Image URL (Base64) not inserted.");
}

/**
 * Convert base64 data URL to File object
 */
async function base64ToFile(dataUrl, filename) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
}

/**
 * Insert image via simulated upload (same method as imageUploadService.js)
 */
async function insertImageViaSimulatedUpload(imageFile, targetNode) {
    if (targetNode.classList.contains("wysiwyg-editor") || targetNode.contentEditable === "true") {
        // 1. Locate the wrapper
        const wrapper = targetNode.closest(".wysiwyg-container") || targetNode.parentElement;
        if (!wrapper) throw new Error("无法找到编辑器容器 (.wysiwyg-container)");

        // 2. Find and Click the "Insert Image" toolbar button
        const insertBtn = wrapper.querySelector('a.wysiwyg-toolbar-icon[title="插入图片"]');
        if (!insertBtn) {
            throw new Error("未找到插入图片按钮 (title='插入图片')");
        }

        insertBtn.click();
        tmLog("已点击插入图片按钮", "info");

        // 3. Wait/Find the file input
        await new Promise(r => setTimeout(r, 100));

        const fileInput = wrapper.querySelector('input[type="file"]') || document.querySelector('input[type="file"][draggable="true"]');

        if (!fileInput) {
            throw new Error("点击按钮后未找到文件输入框 (input[type='file'])");
        }

        // 4. Assign File
        try {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);
            fileInput.files = dataTransfer.files;

            // 5. Dispatch Events
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input", { bubbles: true }));

            tmLog("已模拟文件上传操作", "success");
        } catch (e) {
            throw new Error("模拟上传失败: " + e.message);
        }

    } else {
        throw new Error("目标节点不是富文本编辑器，不支持图片上传模式。");
    }
}

/**
 * 批量队列处理器
 */
// Note: batchQueue definition is in vars.js, logic attached here.
Object.assign(batchQueue, {
    start(strings, config, onProgress, onComplete) {
        if (this.isRunning) {
            throw new Error("批量处理已在运行中");
        }

        // 按 batchSize 分组
        const batchSize = config.batchSize || 2;
        this.queue = [];
        const equationTypes = Array.isArray(config.equationTypes) ? config.equationTypes : [];
        const defaultEquationType = config.equationType || "07";

        for (let i = 0; i < strings.length; i += batchSize) {
            const batch = strings.slice(i, i + batchSize);
            const batchIndex = Math.floor(i / batchSize);
            // 获取该批次对应的 equationType（equationTypes 按批次索引）
            const batchEquationType = equationTypes[batchIndex] != null
                ? String(equationTypes[batchIndex])
                : defaultEquationType;

            // 为批次中的每个字符串设置相同的 equationType
            const batchWithType = batch.map(item => {
                if (typeof item === "object" && item !== null) {
                    return { ...item, equationType: item.equationType || batchEquationType };
                }
                return { string: String(item), equationType: batchEquationType };
            });

            this.queue.push(batchWithType);
        }

        this.config = config;
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        this.isRunning = true;
        this.isPaused = false;
        this.currentIndex = 0;

        this.processNext();
    },

    async processNext() {
        if (this.isPaused) return;

        if (this.currentIndex >= this.queue.length) {
            this.isRunning = false;

            // Compute crossSite.rSquared for specific profile
            const profile = getActiveProfile();
            if (profile && profile.expName === "电学元件伏安特性的测量") {
                // Get R² values from batches 1-3 (indices 1, 2, 3)
                const r2Values = [];
                for (let i = 1; i <= 3; i++) {
                    const result = state.store.crossSiteResults && state.store.crossSiteResults[i];
                    if (result && result.r2 !== undefined && result.r2 !== null) {
                        const r2Num = parseFloat(result.r2);
                        if (!isNaN(r2Num)) {
                            r2Values.push(r2Num);
                        }
                    }
                }

                if (r2Values.length > 0) {
                    const maxR2 = Math.max(...r2Values);
                    if (!state.store.computed) state.store.computed = {};
                    state.store.computed['crossSite.rSquared'] = maxR2;
                    saveJSON(LS_KEY_STORE, state.store);
                    tmLog(`已计算 crossSite.rSquared = ${maxR2} (从第2-4组中最大值)`, "success");
                } else {
                    tmLog("警告: 未找到有效的 R² 值 (批次 2-4)", "warn");
                }
            }

            this.onComplete?.({ ok: true, total: this.queue.length });
            return;
        }

        const batch = this.queue[this.currentIndex];
        const progress = {
            current: this.currentIndex + 1,
            total: this.queue.length,
            strings: batch
        };

        this.onProgress?.(`处理第 ${progress.current}/${progress.total} 组...`, progress);

        try {
            const result = await executeCrossSiteOperation(this.config, batch, (msg) => {
                this.onProgress?.(msg, progress);
            });

            if (result.imageData) {
                this.onProgress?.(`正在插入图片...`, progress);

                // 读取 upload 配置
                const uploadCfg = this.config.upload || {};
                const editorSelector = uploadCfg.editorSelector || this.config.editorSelector;
                const editorIndexes = uploadCfg.editorIndexes || this.config.editorIndexes;

                // DIRECT INSERTION: Skip upload, use DataURL directly
                if (editorSelector) {
                    await insertImageToEditor(this.currentIndex, result.imageData, editorSelector, editorIndexes);
                    this.onProgress?.(`图片插入成功`, progress);
                } else {
                    this.onProgress?.(`跳过插入（未配置 editorSelector）`, progress);
                }
            }

            // Save R2 result
            if (!state.store.crossSiteResults) state.store.crossSiteResults = {};
            // Key by batch index (or should we strictly use currentIndex?)
            // currentIndex is the iteration index (0, 1, 2...) which corresponds to batch index
            state.store.crossSiteResults[this.currentIndex] = {
                r2: result.r2,
                b: result.b,
                timestamp: new Date().toISOString()
            };
            // Optionally persist immediately if critical, but we usually save on extract. 
            // Let's create a dedicated save key or merge into generic store?
            // User requested display in preview string function.
            // We'll save to main LS_KEY_STORE so it persists across reloads?
            // Actually, `state.store` IS saved to LS_KEY_STORE.
            saveJSON(LS_KEY_STORE, state.store);


            this.currentIndex++;
            // 延迟一下再处理下一组
            setTimeout(() => {
                this.processNext();
            }, 1000);
        } catch (e) {
            this.isRunning = false;
            this.onComplete?.({ ok: false, error: e.message, progress });
        }
    },

    pause() {
        this.isPaused = true;
    },

    resume() {
        if (this.isPaused && this.isRunning) {
            this.isPaused = false;
            this.processNext();
        }
    },

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        this.currentIndex = 0;
        this.queue = [];
    }
});

/**
 * 生成字符串预览
 * @param {Object} profile - 当前配置
 * @returns {string} - 预览文本
 */
function generateStringPreview(profile) {
    if (!profile) {
        throw new Error("未选择配置或配置为空");
    }

    const crossSiteConfig = profile.crossSite;
    if (!crossSiteConfig || !Array.isArray(crossSiteConfig.extractIds)) {
        throw new Error("配置中缺少 crossSite.extractIds 字段");
    }

    const results = generateStringsFromExtract(
        crossSiteConfig.extractIds,
        crossSiteConfig.equationTypes,
        crossSiteConfig.equationType || "07"
    );

    if (results.length === 0) {
        throw new Error("未生成任何字符串，请先运行\"提取 + 计算 + 保存\"以获取数据");
    }

    // Group results by batch
    const batchSize = crossSiteConfig.batchSize || 2;
    const grouped = [];

    for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize);

        // Retrieve stored R2 & b
        const stored = state.store.crossSiteResults && state.store.crossSiteResults[batchIndex];
        let info = "未生成";
        if (stored) {
            info = `R²: ${stored.r2} | b: ${stored.b !== undefined ? stored.b : "未生成"}`;
        }

        const batchLines = batch.map((r, subIndex) =>
            `字符串 ${i + subIndex + 1} (类型: ${r.equationType}): ${r.string}`
        ).join("\n");

        grouped.push(`【第 ${batchIndex + 1} 组】 ${info}\n${batchLines}`);
    }

    return {
        totalStrings: results.length,
        totalBatches: grouped.length,
        previewText: `共生成 ${results.length} 个字符串，分 ${grouped.length} 组：\n\n${grouped.join("\n\n")}`
    };
}

/**
 * 开始批量跨站处理
 * @param {Object} profile - 当前配置
 * @param {Function} updateCallback - 进度更新回调 (message, progress)
 * @param {Function} completeCallback - 完成回调 (result)
 */
function startBatchCrossSite(profile, updateCallback, completeCallback) {
    if (!profile) {
        throw new Error("未选择配置或配置为空");
    }

    const crossSiteConfig = profile.crossSite;
    if (!crossSiteConfig) {
        throw new Error("配置中缺少 crossSite 字段");
    }

    if (!crossSiteConfig.extractIds || !Array.isArray(crossSiteConfig.extractIds)) {
        throw new Error("配置中缺少 crossSite.extractIds 字段");
    }

    if (batchQueue.isRunning) {
        throw new Error("批量处理正在运行中，请先暂停或等待完成");
    }

    const results = generateStringsFromExtract(
        crossSiteConfig.extractIds,
        crossSiteConfig.equationTypes,
        crossSiteConfig.equationType || "07"
    );

    if (results.length === 0) {
        throw new Error("未生成任何字符串，请先运行\"提取 + 计算 + 保存\"以获取数据");
    }

    const batchSize = crossSiteConfig.batchSize || 2;
    if (results.length < batchSize) {
        throw new Error(`字符串数量（${results.length}）少于批次大小（${batchSize}）`);
    }

    batchQueue.start(results, crossSiteConfig, updateCallback, completeCallback);
}

/**
 * 暂停批量处理
 */
function pauseBatchCrossSite() {
    if (batchQueue.isRunning && !batchQueue.isPaused) {
        batchQueue.pause();
        return true;
    }
    return false;
}

/**
 * 恢复批量处理
 */
function resumeBatchCrossSite() {
    if (batchQueue.isPaused) {
        batchQueue.resume();
        return true;
    }
    return false;
}

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

/** ---------------------------
 *  UI Actions
 *  UI 事件触发的业务动作，连接 UI 层和服务层
 *  --------------------------- */

/**
 * 识别实验数据动作
 */
async function recognizeDataAction() {
    try {
        const profile = getActiveProfile();
        const studentId = state.userInfo.studentId;

        tmLog("开始识别实验数据...", "info");
        const fillData = await recognizeExperimentData(profile, studentId);

        // Fill data into page
        let count = 0;
        for (const item of fillData) {
            // Use writeValue to support advanced selectors and consistency
            const r = writeValue(item.id, item.value);
            if (r.ok) {
                count++;
                tmLog(`已填充: ${item.id} = ${item.value}`, "success");
            } else {
                tmLog(`未找到节点: ${item.id}`, "warn");
            }
        }

        tmLog(`实验数据识别完成，已填写 ${count} 项`, "success");
        alert(`实验数据识别并填写完成！已填写 ${count} 项`);
    } catch (e) {
        tmLog("识别失败: " + e.message, "error");
        alert("识别失败: " + e.message);
    }
}

/**
 * 生成答案动作
 */
async function generateAnswerAction() {
    try {
        const profile = getActiveProfile();

        tmLog("开始生成答案...", "info");
        const results = await generateExperimentAnswer(profile);

        for (const result of results) {
            if (result.type === 'multiple') {
                // Fill multiple editors
                const editors = document.querySelectorAll(".wysiwyg-editor");
                const count = result.data.length;

                result.data.forEach((answer, index) => {
                    // Fill from the end: if count=2, fill last 2 editors
                    // index 0 -> total - 2
                    // index 1 -> total - 1
                    const targetIndex = editors.length - count + index;

                    if (targetIndex >= 0 && editors[targetIndex]) {
                        editors[targetIndex].innerHTML = answer;
                        editors[targetIndex].dispatchEvent(new Event("input", { bubbles: true }));
                    }
                });
                tmLog(`已填写 ${result.data.length} 个答案`, "success");
            } else if (result.type === 'single') {
                if (result.toFillNode) {
                    const targetEditor = document.querySelector(result.toFillNode);
                    if (targetEditor) {
                        targetEditor.innerHTML = result.data;
                        targetEditor.dispatchEvent(new Event("input", { bubbles: true }));
                        tmLog("答案已填写", "success");
                    } else {
                        tmLog("未找到目标编辑器: " + result.toFillNode, "error");
                    }
                } else {
                    // Fallback: fill the LAST editor
                    const editors = document.querySelectorAll(".wysiwyg-editor");
                    if (editors.length > 0) {
                        const targetEditor = editors[editors.length - 1];
                        targetEditor.innerHTML = result.data;
                        targetEditor.dispatchEvent(new Event("input", { bubbles: true }));
                        tmLog("答案已自动填入最后一个编辑器", "success");
                    } else {
                        tmLog("未找到任何编辑器", "warn");
                    }
                }
            }
        }

        alert("答案生成并填写完成！");
    } catch (e) {
        tmLog("生成答案失败: " + e.message, "error");
        alert("生成答案失败: " + e.message);
    }
}

/**
 * 上传实验图片动作
 */
async function uploadExpImageAction() {
    try {
        const profile = getActiveProfile();
        const studentId = state.userInfo.studentId;

        tmLog("开始上传实验图片...", "info");

        // [NEW] Support for Array Source (Sequential Mapping)
        if (profile.uploadExpImage && Array.isArray(profile.uploadExpImage.source)) {
            const { toFillNode, source } = profile.uploadExpImage;
            const targets = document.querySelectorAll(toFillNode);

            if (targets.length === 0) {
                throw new Error(`未找到目标节点 (Array Mode): ${toFillNode}`);
            }

            tmLog(`检测到多图片映射模式 (${source.length} 图片 -> ${targets.length} 节点)`, "info");

            for (let i = 0; i < source.length; i++) {
                if (i >= targets.length) {
                    tmLog(`警告: 图片数量 (${source.length}) 超过节点数量 (${targets.length})，忽略剩余图片`, "warn");
                    break;
                }

                const item = source[i];
                const target = targets[i];

                // 支持嵌套数组: ["A", "B"] 表示往同一个节点传两张图; "C" 表示传一张
                const imageList = Array.isArray(item) ? item : [item];

                for (let j = 0; j < imageList.length; j++) {
                    const filename = imageList[j];

                    // Fetch file logic (Local or Server)
                    let file = null;

                    // 1. Try Local Files
                    if (state.configFiles && state.configFiles.length > 0) {
                        file = state.configFiles.find(f =>
                            f.name === filename ||
                            (f.webkitRelativePath && f.webkitRelativePath.endsWith('/' + filename)) ||
                            (f.webkitRelativePath && f.webkitRelativePath === filename)
                        );
                    }

                    // 2. Try Server
                    if (!file && window.__tm_file_server_url) {
                        try {
                            const sid = window.__tm_student_id || state.userInfo.studentId;
                            tmLog(`[调试] 请求图片: 学号=${sid}, 文件=${filename}`, "info");
                            const url = sid
                                ? `${window.__tm_file_server_url}/personalData/${sid}/${filename}`
                                : `${window.__tm_file_server_url}/${filename}`;

                            const resp = await fetch(url);
                            if (resp.ok) {
                                const blob = await resp.blob();
                                file = new File([blob], filename, { type: blob.type });
                            }
                        } catch (e) {
                            console.warn("Fetch failed for " + filename);
                        }
                    }

                    if (file) {
                        // 稍微等待一下确保顺序(如果是多图上传)
                        if (j > 0) await new Promise(r => setTimeout(r, 500));

                        await insertImageToNode(null, target, file);
                        tmLog(`[映射 ${i}${imageList.length > 1 ? `-${j}` : ''}] 上传成功: ${filename}`, "success");
                    } else {
                        tmLog(`[映射 ${i}] 未找到图片文件: ${filename}`, "error");
                    }
                }
            }

            tmLog("多图片处理完成", "success");
            return; // Exit function
        }

        // 1. Get Primary Image (Validates config)
        const primaryImage = await getExperimentImage(profile, studentId);

        const targetElement = document.querySelector(primaryImage.targetNode);
        if (!targetElement) {
            throw new Error(`未找到目标节点: ${primaryImage.targetNode}`);
        }

        // Upload Primary
        await insertImageToNode(primaryImage.base64, targetElement, primaryImage.file);
        tmLog(`上传成功: ${primaryImage.file.name}`, "success");

        // 2. Find and Upload Related Images (Prefix Match)
        if (window.__tm_file_server_url && profile.custom && profile.custom.image) {
            try {
                const sid = window.__tm_student_id || state.userInfo.studentId;
                const listUrl = sid
                    ? `${window.__tm_file_server_url}/__tm_list_files?student_id=${sid}`
                    : `${window.__tm_file_server_url}/__tm_list_files`;

                const resp = await fetch(listUrl);
                if (resp.ok) {
                    const allFiles = await resp.json();
                    const cfgImageName = profile.custom.image;

                    // Extract base name: "2.jpg" -> "2"
                    const lastDot = cfgImageName.lastIndexOf('.');
                    const baseName = lastDot > 0 ? cfgImageName.substring(0, lastDot) : cfgImageName;

                    if (baseName) {
                        // Filter: starts with "2." AND is NOT the primary image
                        // This matches "2.1.jpg", "2.2.png", etc. provided they start with "2."
                        const matches = allFiles.filter(f =>
                            f.startsWith(baseName + '.') && f !== cfgImageName
                        );

                        if (matches.length > 0) {
                            tmLog(`发现 ${matches.length} 张关联图片，准备上传...`, "info");

                            for (const filename of matches) {
                                try {
                                    // Fetch file
                                    const sid = window.__tm_student_id || state.userInfo.studentId;
                                    const fileUrl = sid
                                        ? `${window.__tm_file_server_url}/personalData/${sid}/${filename}`
                                        : `${window.__tm_file_server_url}/${filename}`;

                                    const fResp = await fetch(fileUrl);
                                    if (!fResp.ok) throw new Error("Fetch failed");

                                    const blob = await fResp.blob();
                                    const file = new File([blob], filename, { type: blob.type });

                                    // Upload with small delay
                                    await new Promise(r => setTimeout(r, 800));
                                    await insertImageToNode(null, targetElement, file);
                                    tmLog(`上传成功: ${filename}`, "success");

                                } catch (err) {
                                    tmLog(`关联图片 ${filename} 上传失败: ${err.message}`, "warn");
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("[Upload] Checking related images failed", e);
            }
        }

        tmLog("所有图片处理完成", "success");
    } catch (e) {
        tmLog("图片上传失败: " + e.message, "error");
        // alert("图片上传失败: " + e.message); // Suppress alert to avoid blocking automation
    }
}

/**
 * 预览实验图片动作
 */
async function previewExperimentImageAction() {
    try {
        const profile = getActiveProfile();
        const studentId = state.userInfo.studentId;

        // Reuse existing logic to get base64
        const { base64 } = await getExperimentImage(profile, studentId);

        showImagePreview(base64);
        tmLog("预览窗口已打开", "success");
    } catch (e) {
        tmLog("预览失败: " + e.message, "error");
        alert("预览失败: " + e.message);
    }
}

/**
 * 生成字符串预览动作
 */
function generateStringPreviewAction() {
    const profile = getActiveProfile();
    try {
        const { totalStrings, totalBatches, previewText } = generateStringPreview(profile);

        // 创建预览窗口
        const w = window.open("", "__tm_strings_preview", "width=800,height=600");
        if (w) {
            w.document.open();
            w.document.write(`
            <!doctype html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>字符串预览</title>
              <style>
                body { font-family: monospace; padding: 20px; background: #0b0f14; color: #e6edf3; }
                pre { background: #0f1720; padding: 15px; border-radius: 8px; overflow: auto; }
                button { background: #132235; border: 1px solid rgba(60,110,180,.9); color: #e6edf3; padding: 8px 16px; border-radius: 8px; cursor: pointer; margin-top: 10px; }
              </style>
            </head>
            <body>
              <h2>生成的字符串预览</h2>
              <p>共生成 ${totalStrings} 个字符串，分 ${totalBatches} 组</p>
              <pre>${String(previewText).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
              <button onclick="navigator.clipboard.writeText(document.querySelector('pre').innerText)">复制全部</button>
            </body>
            </html>
          `);
            w.document.close();
        } else {
            alert("预览窗口被拦截，请允许弹窗。\n\n" + previewText);
        }
        return `已生成 ${totalStrings} 个字符串`;
    } catch (e) {
        alert("生成字符串失败：" + e.message);
        throw e;
    }
}

/**
 * 运行跨站批量处理动作
 * @param {Object} uiRefs - UI 引用 { pauseBtn, resumeBtn, batchStatus, status }
 */
function runCrossSiteBatchAction(uiRefs) {
    const { pauseBtn, resumeBtn, batchStatus, status } = uiRefs;
    const profile = getActiveProfile();

    try {
        // UI Init
        pauseBtn.style.display = "block";
        resumeBtn.style.display = "none";
        batchStatus.style.display = "block";

        startBatchCrossSite(
            profile,
            (message, progress) => {
                if (progress) {
                    batchStatus.textContent = `${message} (${progress.current}/${progress.total})`;
                } else {
                    batchStatus.textContent = message;
                }
                status.textContent = message;
            },
            (result) => {
                pauseBtn.style.display = "none";
                resumeBtn.style.display = "none";
                if (result.ok) {
                    batchStatus.textContent = `批量处理完成！共处理 ${result.total} 组。`;
                    status.textContent = `批量处理完成！共处理 ${result.total} 组。`;
                } else {
                    batchStatus.textContent = `批量处理失败：${result.error}`;
                    status.textContent = `批量处理失败：${result.error}`;
                }
                setTimeout(() => {
                    batchStatus.style.display = "none";
                }, 5000);
            }
        );
    } catch (e) {
        alert("启动批量处理失败：" + e.message);
    }
}

/**
 * 切换到对应实验动作
 */
async function switchExperimentAction(statusRef) {
    const profile = getActiveProfile();
    const setStatus = (msg) => {
        if (statusRef && statusRef.textContent) statusRef.textContent = msg;
        console.log("[TM] " + msg);
        tmLog(msg, "info");
    };

    if (!profile || !profile.expName) {
        alert("[切换到对应实验] 配置中未找到 expName，无法切换实验");
        return;
    }

    const expName = profile.expName.trim();
    setStatus(`[切换到对应实验] 准备切换至实验: ${expName}...`);

    // 1. Try to close current modal if open
    clickClose(); // from pageActions

    setStatus("[切换到对应实验] 正在尝试关闭当前页面...");
    await new Promise(r => setTimeout(r, 800));

    // 2. Search for the experiment row
    setStatus(`[切换到对应实验] 查找实验: ${expName}...`);
    const rows = document.querySelectorAll("tr");
    let targetBtn = null;

    for (const row of rows) {
        if (row.textContent.includes(expName)) {
            // Find button with value="完成报告"
            const btn = row.querySelector("input[value='完成报告']");
            if (btn) {
                targetBtn = btn;
                break;
            }
        }
    }

    if (targetBtn) {
        tmLog(`[切换到对应实验] 找到实验 "${expName}"，点击进入...`, "success");
        setStatus(`[切换到对应实验] 正在进入实验: ${expName}`);
        targetBtn.click();
    } else {
        alert(`[切换到对应实验] 未在列表中找到名为 "${expName}" 的实验，或无法点击 "完成报告" 按钮。\n请确认您在实验列表页面，且实验名称匹配。`);
        setStatus("[切换到对应实验] 未找到对应实验");
    }
}

/**
 * 提交并继续下一实验动作
 */
async function submitAndContinueAction(statusRef) {
    // 1. Submit
    tmLog("[提交并继续] 开始正式提交流程...", "info");
    const result = await clickSubmit(); // from pageActions

    if (!result.ok) {
        alert("[提交并继续] 提交失败: " + result.error);
        return;
    }

    tmLog("[提交并继续] 提交请求已发送，准备切换...", "info");

    // No waiting or re-confirming as per user request (logic handled in clickSubmit)

    // 3. Switch to Next Profile
    const profiles = getProfiles(); // Returns object: { "profile1": {...}, "profile2": {...} }
    const profileNames = Object.keys(profiles);

    if (profileNames.length === 0) {
        tmLog("[提交并继续] 配置列表为空，无法切换", "warn");
        return;
    }

    // Find current index in the profile names array
    const currentName = state.activeProfileName;
    const currentIndex = profileNames.indexOf(currentName);

    if (currentIndex === -1) {
        tmLog(`[提交并继续] 当前配置 "${currentName}" 未在列表中找到，无法自动切换`, "warn");
        return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < profileNames.length) {
        const nextProfileName = profileNames[nextIndex];
        state.activeProfileName = nextProfileName;
        localStorage.setItem(LS_KEY_PROFILE, nextProfileName);

        // Update UI selector
        const sel = document.getElementById("__tm_profile");
        if (sel) {
            sel.value = nextProfileName;
            sel.dispatchEvent(new Event("change"));
        }

        tmLog(`[提交并继续] 已切换到下一配置: ${nextProfileName}`, "success");
        if (statusRef) statusRef.textContent = `已切换配置：${nextProfileName}`;

        // 4. Execute Switch Experiment Logic
        await new Promise(r => setTimeout(r, 1000)); // Brief pause
        await switchExperimentAction(statusRef);
    } else {
        tmLog("[提交并继续] 已是最后一个配置，无需切换", "info");
        alert("[提交并继续] 所有配置已完成！");
    }
}

/** ---------------------------
 *  Fill Actions
 *  填写相关动作
 *  --------------------------- */

/**
 * 检查填写状态动作
 */
function checkFillStatusAction() {
    const profile = getActiveProfile();
    const exclusions = profile && profile.excludedNodesList ? profile.excludedNodesList : [];

    const { unfilled, candidates } = validateFillStatus(profile, exclusions);

    if (unfilled.length > 0) {
        // 有未填项，弹窗提示
        // Scroll to first
        unfilled[0].scrollIntoView({ behavior: "smooth", block: "center" });

        const msg = `发现 ${unfilled.length} 个未填项，已高亮显示（黄色）。`;
        tmLog(msg, "warn");

        const details = unfilled.map((el, i) => {
            let desc = `${i + 1}. ${el.tagName.toLowerCase()}`;
            if (el.id) desc += `#${el.id}`;
            else if (el.name) desc += `[name="${el.name}"]`;
            else if (el.className) desc += `.${Array.from(el.classList).join(".")}`;
            return desc;
        }).join("\n");

        tmLog("未填详情:\n" + details, "warn");
        console.warn("[TM] Unfilled nodes details:\n" + details);
        console.warn("[TM] Unfilled nodes objects:", unfilled);

        alert(msg + "\n页面已自动滚动到第一个未填项。\n\n详情:\n" + details);
    } else {
        // 全部填写完成，不弹窗，只记录日志
        const msg = "检查通过：所有必填项均已填写。";
        tmLog(msg, "success");
        // 不再弹出alert
        // Clear all highlights
        candidates.forEach(el => {
            el.classList.remove("tm-unfilled-highlight");
        });
    }
}

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

/** ---------------------------
 *  Event Handlers (Lightweight Wrappers)
 *  事件处理器 - 轻量包装，转发到 actions 层
 *  --------------------------- */

// Handle: Recognize Experiment Data
async function handleRecognizeData() {
    await recognizeDataAction();
}

// Handle: Generate Answer
async function handleGenerateAnswer() {
    await generateAnswerAction();
}

// Handle: Upload Experiment Image
async function handleUploadExpImage() {
    await uploadExpImageAction();
}

/** ---------------------------
 *  Main UI Panel
 *  --------------------------- */

/** ---------------------------
 *  GUI panel
 *  --------------------------- */
function injectPanel() {
    if (document.getElementById("__tm_cfg_panel")) return;

    const root = document.createElement("div");
    root.id = "__tm_cfg_panel";
    root.style.cssText = `
      position: fixed; right: 14px; bottom: 14px; width: 340px; height: 500px;
      z-index: 999999; border-radius: 14px;
      background: rgba(10,14,20,.96);
      border: 1px solid rgba(40,60,90,.9);
      box-shadow: 0 8px 30px rgba(0,0,0,.45);
      color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial;
      overflow: hidden; display: flex; flex-direction: column;
    `;

    // CSS for Tabs
    const style = document.createElement("style");
    style.textContent = `
        .tm-tab-header { display: flex; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(40,60,90,0.4); }
        .tm-tab-btn { flex: 1; padding: 8px 0; text-align: center; cursor: pointer; color: #9fb3c8; font-size: 12px; border-bottom: 2px solid transparent; }
        .tm-tab-btn.active { color: #e6edf3; border-bottom-color: #58a6ff; font-weight: 500; background: rgba(40,60,90,0.1); }
        .tm-tab-btn:hover:not(.active) { background: rgba(40,60,90,0.2); }
        .tm-tab-content { flex: 1; display: none; overflow-y: auto; padding: 12px; flex-direction: column; gap: 10px; }
        .tm-tab-content.active { display: flex; }
        .tm-btn { padding: 10px; border-radius: 12px; cursor: pointer; width: 100%; border: 1px solid rgba(40,60,90,.9); color: #e6edf3; background: #0f1720; margin-bottom: 8px; }
        .tm-btn:hover { background: #16202a; }
        .tm-btn-primary { background: #1f6feb; border-color: rgba(240,246,252,0.1); }
        .tm-btn-primary:hover { background: #388bfd; }
        .tm-btn-green { background: #1a2f1a; border-color: rgba(60,150,60,.9); }
        .tm-btn-green:hover { background: #233b23; }
        .tm-input { background: #0b0f14; border: 1px solid rgba(40,60,90,.9); color: #e6edf3; padding: 8px; border-radius: 10px; width: 100%; box-sizing: border-box; }
    `;
    root.appendChild(style);

    root.innerHTML += `
      <!-- Header -->
      <div id="__tm_head" style="display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid rgba(40,60,90,.8); flex-shrink: 0;">
        <div style="font-weight:700; font-size: 15px; flex:1;">CFG Toolkit</div>
        <button id="__tm_hide" style="background:#0f1720;border:1px solid rgba(40,60,90,.9);color:#e6edf3;padding:6px 8px;border-radius:10px;cursor:pointer;">隐藏</button>
      </div>
      
      <!-- Info Bar -->
      <div id="__tm_user_info" style="padding: 8px 12px; font-size: 15px; color: #9fb3c8; background: rgba(40,60,90,.2); border-bottom: 1px solid rgba(40,60,90,0.4); display: flex; gap: 15px; align-items: center; flex-shrink: 0;">
        <span style="display:flex;align-items:center;gap:4px;">👤 <span id="__tm_user_name" style="color:#e6edf3;">...</span></span>
        <span style="display:flex;align-items:center;gap:4px;">🆔 <span id="__tm_student_id" style="color:#e6edf3;">...</span></span>
      </div>

      <!-- Tab Navigation -->
      <div class="tm-tab-header">
        <div class="tm-tab-btn active" data-tab="tab1">准备</div>
        <div class="tm-tab-btn" data-tab="tab2">识别</div>
        <div class="tm-tab-btn" data-tab="tab3">计算</div>
        <div class="tm-tab-btn" data-tab="tab4">回填</div>
        <div class="tm-tab-btn" data-tab="tab5">日志</div>
      </div>

      <!-- Content Area -->
      <div id="__tm_body" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
        
        <!-- Tab 1: 实验准备 -->
        <div id="tab1" class="tm-tab-content active">
            <div style="background:rgba(40,60,90,0.2); padding:10px; border-radius:8px; margin-bottom:8px;">
                <div style="font-size:12px; color:#cea; margin-bottom:6px;">切换用户</div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <input id="__tm_input_switch_id" placeholder="点击输入学号" readonly class="tm-input" style="padding:6px; font-size:13px; cursor:pointer;" />
                    <div style="display:flex; gap:8px;">
                        <button id="__tm_btn_logout" style="flex:1; background:#203040; border:1px solid rgba(70,120,190,.9); color:#e6edf3; padding:6px 12px; border-radius:8px; cursor:pointer;">切换</button>
                        <button id="__tm_btn_login_manual" style="flex:1; background:#1a2f1a; border:1px solid rgba(60,150,60,.9); color:#e6edf3; padding:6px 12px; border-radius:8px; cursor:pointer;">登录</button>
                        <button id="__tm_btn_reset_apikey" style="width:40px; background:#3a2a1a; border:1px solid rgba(150,100,60,.9); color:#e6edf3; padding:6px; border-radius:8px; cursor:pointer;" title="重置 API Key">🔑</button>
                    </div>
                </div>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <select id="__tm_profile" class="tm-input" style="padding:8px;"></select>
                <button id="__tm_load" style="background:#0f1720;border:1px solid rgba(40,60,90,.9);color:#e6edf3;padding:8px 10px;border-radius:10px;cursor:pointer;white-space:nowrap;">加载配置</button>
                <input id="__tm_file" type="file" webkitdirectory directory multiple style="display:none" />
            </div>
            <button id="__tm_btn_switch_exp" class="tm-btn tm-btn-primary">切换到对应实验</button>
            <button id="__tm_btn_batch_pre_recognize" class="tm-btn" style="background:#5a2a5a; border-color:rgba(180,90,180,.9);">（豆包API）批量预识别所有数据</button>
            <button id="__tm_btn_run_automation" class="tm-btn" style="background:#555; border-color:rgba(150,150,150,.9);">执行此配置的所有自动化流程</button>
        </div>

        <!-- Tab 2: 数据识别 -->
        <div id="tab2" class="tm-tab-content">
            <button id="__tm_btn_upload_exp_image" class="tm-btn tm-btn-green">插入实验数据图片</button>
            <button id="__tm_btn_fill_from_pre_rec" class="tm-btn" style="background:#4a3a2a;border-color:rgba(180,140,80,.9);">从预识别文件填写</button>
            <button id="__tm_btn_preview_exp_image" class="tm-btn" style="background:#203040;border-color:rgba(70,120,190,.9);">预览实验图片</button>
            <button id="__tm_btn_recognize_data" class="tm-btn" style="background:#2a1a3a;border-color:rgba(120,60,180,.9);">（豆包API）识别实验数据并填写</button>
            <button id="__tm_btn_copy_prompt_rec" class="tm-btn" style="background:#202530;border-color:rgba(80,90,100,.5)">查看识别prompt</button>
            <button id="__tm_btn_fill_dict" class="tm-btn" style="background:#1a2a3a;border-color:rgba(60,120,180,.9);">根据自定义字典填写数据</button>
            <button id="__tm_btn_custom" class="tm-btn">管理自定义数据</button>
        </div>

        <!-- Tab 3: 计算与预览 -->
        <div id="tab3" class="tm-tab-content">
            <button id="__tm_btn_extract" class="tm-btn tm-btn-primary">读取并计算数据</button>
            
            <div style="display:flex; gap:8px;">
                <button id="__tm_btn_preview" class="tm-btn" style="flex:1;">预览待填数据</button>
                <button id="__tm_btn_generate_strings" class="tm-btn" style="flex:1;">预览曲线参数</button>
            </div>
            
            <button id="__tm_btn_cross_site" class="tm-btn" style="background:#1a2f3f;border-color:rgba(60,150,200,.9);">生成曲线图图片</button>

            <!-- Hidden btns -->
            <button id="__tm_btn_pause" style="display:none;">暂停</button>
            <button id="__tm_btn_resume" style="display:none;">继续</button>
        </div>

        <!-- Tab 4: 回填与导出 -->
        <div id="tab4" class="tm-tab-content">

            <button id="__tm_btn_apply_const" class="tm-btn tm-btn-primary">回填常量</button>
            <button id="__tm_btn_apply_var" class="tm-btn tm-btn-primary">回填变量</button>
            
            <button id="__tm_btn_generate_answer" class="tm-btn" style="background:#2a1a3a;border-color:rgba(120,60,180,.9);">（豆包API）生成实验问题答案并填写</button>
            <button id="__tm_btn_check_fill" class="tm-btn" style="background:#b8741a;border-color:rgba(180,90,60,.9);">检查填写状态</button>
            <div style="display:flex; gap:8px;">
                <button id="__tm_btn_submit" class="tm-btn" style="flex:1; background:#203040; border-color:rgba(70,120,190,.9);">正式提交</button>
                <button id="__tm_btn_close" class="tm-btn" style="flex:1; background:#302020; border-color:rgba(190,70,70,.9);">关闭当前页面</button>
            </div>

            <button id="__tm_btn_export_page" class="tm-btn">导出页面已填数据 (JSON)</button>
        </div>

        <!-- Tab 5: 日志 -->
        <div id="tab5" class="tm-tab-content" style="padding:0; display:none; flex-direction:column;">
            <div id="__tm_status" style="padding:8px; font-size:12px; color:#eee; background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(40,60,90,0.2);">状态: 就绪</div>
            <div id="__tm_batch_status" style="display:none;"></div>
            <div id="__tm_log_panel" style="flex:1; overflow-y:auto; padding:8px; font-family:'Consolas',monospace; font-size:12px; color:#9fb3c8;">
                <div id="__tm_log_content">
                    <div style="color: #58a6ff;">系统日志已就绪</div>
                </div>
            </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);

    // --- Tab Switching Logic ---
    const tabBtns = root.querySelectorAll(".tm-tab-btn");
    const tabContents = root.querySelectorAll(".tm-tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => {
                c.classList.remove("active");
                c.style.display = "none";
            });

            // Set active
            btn.classList.add("active");
            const tabId = btn.dataset.tab;
            const content = root.querySelector("#" + tabId);
            content.classList.add("active");

            // Special display handling for flex
            if (tabId === "tab5") {
                content.style.display = "flex";
            } else {
                content.style.display = "flex";
            }
        });
    });

    const head = root.querySelector("#__tm_head");
    const body = root.querySelector("#__tm_body");
    // const status was here, now in tab 5 but querySelector searches result-wide
    const status = root.querySelector("#__tm_status");

    // hide / show logic needs update as body is now different
    let collapsed = false;
    root.querySelector("#__tm_hide").addEventListener("click", () => {
        collapsed = !collapsed;
        const h = collapsed ? "44px" : "500px";
        root.style.height = h;
        root.querySelector("#__tm_hide").textContent = collapsed ? "展开" : "隐藏";
    });

    // drag panel by header
    enableDrag(root, head);

    // Prompt for switch id
    root.querySelector("#__tm_input_switch_id").addEventListener("click", function () {
        const val = prompt("请输入学号", this.value);
        if (val !== null) {
            this.value = val;
            this.dispatchEvent(new Event("input"));
        }
    });

    // Switch Experiment Logic
    root.querySelector("#__tm_btn_switch_exp").addEventListener("click", async () => {
        await switchExperimentAction(status);
    });

    // load config from file
    const fileInput = root.querySelector("#__tm_file");
    root.querySelector("#__tm_load").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) return;

        try {
            // Search for data.json in the selected directory
            let dataFile = null;
            for (let i = 0; i < files.length; i++) {
                if (files[i].name === "data.json") {
                    dataFile = files[i];
                    break;
                }
            }

            if (!dataFile) {
                throw new Error("未在选定目录中找到 data.json 文件");
            }

            const text = await dataFile.text();
            const cfg = JSON.parse(text);
            if (!cfg || !cfg.profiles) throw new Error("配置缺少 profiles 字段");

            // Store all files from the directory for later use (e.g., images)
            state.configFiles = Array.from(files);

            state.config = cfg;
            saveJSON(LS_KEY_CONFIG, cfg);
            refreshProfileSelect();
            status.textContent = "配置已加载（从 data.json）。";
            tmLog("配置已从目录加载: " + dataFile.webkitRelativePath, "success");
        } catch (e) {
            alert("配置加载失败：" + String(e?.message || e));
        } finally {
            fileInput.value = "";
        }
    });

    // Batch Pre-recognition
    root.querySelector("#__tm_btn_batch_pre_recognize").addEventListener("click", () => {
        const studentId = root.querySelector("#__tm_student_id").textContent.trim();
        runBatchPreRecognition(studentId); // from preRecognitionService.js
    });

    // Run Automation
    root.querySelector("#__tm_btn_run_automation").addEventListener("click", () => {
        runAutomationAction(); // from automationService.js
    });

    // Fill from Pre-recognition
    root.querySelector("#__tm_btn_fill_from_pre_rec").addEventListener("click", () => {
        const studentId = root.querySelector("#__tm_student_id").textContent.trim();
        fillFromPreRecognizedData(studentId); // from preRecognitionService.js
    });

    // Upload experiment image
    root.querySelector("#__tm_btn_upload_exp_image").addEventListener("click", handleUploadExpImage);

    // Preview experiment image
    root.querySelector("#__tm_btn_preview_exp_image").addEventListener("click", () => {
        previewExperimentImageAction();
    });

    // Recognize experiment data and fill
    root.querySelector("#__tm_btn_recognize_data").addEventListener("click", handleRecognizeData);


    // Copy Recognition Prompt
    root.querySelector("#__tm_btn_copy_prompt_rec").addEventListener("click", () => {
        const profile = getActiveProfile();
        if (!profile || !profile.prompts) {
            alert("无 Prompt 配置");
            tmLog("无 Prompt 配置", "warn");
            return;
        }

        const p = profile.prompts.find(x => x.type === "textRecognition");
        if (p && p.value) {
            // Manual copy
            tmLog("已显示 Prompt 供复制", "info");
            window.prompt("请复制以下识别 Prompt (Ctrl+C):", p.value);
        } else {
            tmLog("未找到 textRecognition 类型的 Prompt", "warn");
            alert("当前配置没有 textRecognition Prompt");
        }
    });

    // Inject Custom Styles (Yellow Highlight)
    const styleId = "__tm_highlight_styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.innerHTML = `
            @keyframes tm-pulse-yellow {
                0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.7); }
                70% { box-shadow: 0 0 0 6px rgba(255, 193, 7, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
            }
            .tm-unfilled-highlight {
                border: 2px solid #ffc107 !important;
                background-color: rgba(255, 193, 7, 0.1) !important;
                animation: tm-pulse-yellow 1.5s infinite !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Check Fill Status
    root.querySelector("#__tm_btn_check_fill").addEventListener("click", () => {
        checkFillStatusAction(); // from fillActions.js
    });

    // Generate answer and fill
    root.querySelector("#__tm_btn_generate_answer").addEventListener("click", () => {
        generateAnswerAction(); // from uiActions.js
    });

    // profile switch
    const sel = root.querySelector("#__tm_profile");
    sel.addEventListener("change", () => {
        state.activeProfileName = sel.value;
        localStorage.setItem(LS_KEY_PROFILE, state.activeProfileName);
        status.textContent = `已切换配置：${state.activeProfileName}`;
    });

    // export profile
    root.querySelector("#__tm_btn_export_page").addEventListener("click", () => {
        const choice = prompt(
            "导出范围：输入 1 或 2\n" +
            "1) 仅导出当前配置涉及字段（extract + fill）【推荐】\n" +
            "2) 导出页面所有带 id 的表单字段（可能很多）",
            "1"
        );

        const mode = (choice || "1").trim() === "2" ? "all" : "configured";
        const r = exportPageFilledDataAsJSON({ mode });
        if (r) status.textContent = `已导出：${r.exported} 项（缺失 ${r.missing}），文件：${r.filename}`;
    });

    // buttons
    root.querySelector("#__tm_btn_extract").addEventListener("click", () => {
        const r = runExtractAndCompute();
        if (!r.ok) return alert("运行失败：" + r.error);

        const parts = [];
        parts.push(`已运行：${state.activeProfileName}`);
        if (r.missing?.length) parts.push(`缺失节点：${r.missing.join(", ")}`);
        parts.push(`extract=${Object.keys(state.store.extract).length} 项`);
        status.textContent = parts.join(" | ");

        if (r.computeErrors?.length) console.warn("[TM] computeErrors", r.computeErrors);
    });

    root.querySelector("#__tm_btn_preview").addEventListener("click", () => openPreview());

    // Custom Data Manager
    root.querySelector("#__tm_btn_custom").addEventListener("click", () => {
        showCustomDataModal(); // from modalHelper.js
    });

    root.querySelector("#__tm_btn_fill_dict").addEventListener("click", () => {
        showDictFillModal(); // from modalHelper.js
    });

    // Helper for applying fill
    const doApply = (filterFn, label) => {
        const r = applyFill(filterFn);
        if (!r.ok) return alert(label + "失败：" + r.error);

        const fail = r.results.filter(x => !x.ok);
        const count = r.results.length;
        status.textContent = fail.length
            ? `${label}完成(${count}项)，但有 ${fail.length} 项失败（看 console）`
            : `${label}完成(${count}项)。`;
        if (fail.length) console.warn("[TM] apply failures", fail);
    };

    root.querySelector("#__tm_btn_apply_const").addEventListener("click", () => {
        // Constants: Has value, no dynamic source
        doApply(item => item.value !== undefined && !item.valueFromFn && !item.valueFrom, "常量回填");
    });

    root.querySelector("#__tm_btn_apply_var").addEventListener("click", () => {
        // Variables: Has dynamic source
        doApply(item => !!item.valueFromFn || !!item.valueFrom, "变量回填");
    });

    root.querySelector("#__tm_btn_submit").textContent = "正式提交并继续";
    root.querySelector("#__tm_btn_submit").addEventListener("click", () => {
        submitAndContinueAction(status);
    });

    root.querySelector("#__tm_btn_close").addEventListener("click", () => {
        const r = clickClose();
        if (r.ok) {
            status.textContent = "已点击关闭";
        } else {
            alert("操作失败：" + r.error);
        }
    });

    root.querySelector("#__tm_btn_logout").addEventListener("click", () => {
        const r = clickLogout();
        if (!r.ok && r.error !== "用户取消了登出") {
            alert("切换失败：" + r.error);
        }
    });

    root.querySelector("#__tm_btn_login_manual").addEventListener("click", async () => {
        const inputId = root.querySelector("#__tm_input_switch_id").value.trim();
        try {
            await performManualLogin(inputId);
        } catch (e) {
            alert(e.message);
        }
    });

    // Reset API Key
    root.querySelector("#__tm_btn_reset_apikey").addEventListener("click", () => {
        if (confirm("确定要清除并重新设置豆包 API Key 吗？")) {
            resetApiKey(); // from ai.js
            alert("API Key 已清除，下次登录时会提示重新输入");
        }
    });

    // 生成字符串预览
    const batchStatus = root.querySelector("#__tm_batch_status");
    root.querySelector("#__tm_btn_generate_strings").addEventListener("click", () => {
        try {
            const msg = generateStringPreviewAction();
            if (msg) status.textContent = msg;
        } catch (e) {
            // handled in action
        }
    });

    // 跨站批量处理
    const pauseBtn = root.querySelector("#__tm_btn_pause");
    const resumeBtn = root.querySelector("#__tm_btn_resume");

    root.querySelector("#__tm_btn_cross_site").addEventListener("click", () => {
        runCrossSiteBatchAction({ pauseBtn, resumeBtn, batchStatus, status });
    });

    pauseBtn.addEventListener("click", () => {
        if (pauseBatchCrossSite()) { // from crossSiteService
            pauseBtn.style.display = "none";
            resumeBtn.style.display = "block";
            status.textContent = "已暂停";
        }
    });

    resumeBtn.addEventListener("click", () => {
        if (resumeBatchCrossSite()) { // from crossSiteService
            pauseBtn.style.display = "block";
            resumeBtn.style.display = "none";
            status.textContent = "已继续";
        }
    });

    function refreshProfileSelect() {
        const profiles = getProfiles();
        sel.innerHTML = "";
        for (const name of Object.keys(profiles)) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        }
        // set active
        const profile = getActiveProfile();
        sel.value = state.activeProfileName || (profile ? state.activeProfileName : "");
    }

    refreshProfileSelect();
    status.textContent = state.config ? "已读取本地配置。可直接操作。" : "未加载配置。点击“加载配置”选择 JSON 文件。";

    // Initial UI update
    updateUserInfoUI();
}

function updateUserInfoUI() {
    const nameEl = document.getElementById("__tm_user_name");
    const idEl = document.getElementById("__tm_student_id");
    if (nameEl) nameEl.textContent = state.userInfo.name || "未知";
    if (idEl) idEl.textContent = state.userInfo.studentId || "未知";
}

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

    document.addEventListener("mouseup", () => dragging = false);
}

/**
 * 显示测试模式提交确认框 (Non-blocking UI with Promise)
 */
function showSubmitConfirmationUI() {
    return new Promise((resolve, reject) => {
        // Create overlay
        const overlay = document.createElement("div");
        overlay.id = "__tm_test_confirm_overlay";
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 1000100;
            display: flex; align-items: center; justify-content: center;
        `;

        const card = document.createElement("div");
        card.style.cssText = `
            background: #0f1720; border: 1px solid rgba(40,60,90,.9);
            padding: 24px; border-radius: 12px;
            color: #e6edf3; font-family: system-ui;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            width: 320px;
        `;

        card.innerHTML = `
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px; display:flex; align-items:center gap:8px;">
                <span>🚧 测试模式</span>
            </div>
            <div style="font-size: 14px; color: #8b949e; margin-bottom: 24px; line-height: 1.5;">
                自动化脚本已完成所有操作，准备执行提交。<br>
                由于处于测试模式，提交操作已被拦截。
            </div>
            <div style="display: flex; gap: 12px;">
                <button id="__tm_btn_cancel_submit" style="
                    flex: 1; padding: 10px; border: 1px solid rgba(248,81,73,0.4);
                    background: rgba(248,81,73,0.1); color: #ff7b72;
                    border-radius: 6px; cursor: pointer; font-weight: 500;
                ">终止</button>
                <button id="__tm_btn_confirm_submit" style="
                    flex: 1; padding: 10px; border: 1px solid rgba(238,238,238,0.1);
                    background: #238636; color: #fff;
                    border-radius: 6px; cursor: pointer; font-weight: 500;
                ">继续提交</button>
            </div>
        `;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const close = () => {
            if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
        };

        document.getElementById("__tm_btn_confirm_submit").onclick = () => {
            close();
            tmLog("[测试模式] 用户确认提交", "success");
            resolve(true);
        };

        document.getElementById("__tm_btn_cancel_submit").onclick = () => {
            close();
            tmLog("[测试模式] 用户终止流程", "warn");
            reject(new Error("用户在测试模式下取消了提交"));
        };
    });
}

// --- Main Init ---

/** ---------------------------
 *  跨站消息监听（在目标网站运行）
 *  --------------------------- */
// 如果当前页面是目标网站，监听来自父窗口的消息
if (window.location.href.includes("qinms.com/webapp/curvefit")) {
    window.addEventListener("message", (event) => {
        // 只处理来自可信源的消息
        if (event.data && event.data.type === "TM_CROSS_SITE_EXECUTE") {
            const { equationType, xAxisString, yAxisString, delays } = event.data;

            try {
                function waitForElement(selector, callback, maxAttempts = 50) {
                    let attempts = 0;
                    const check = setInterval(() => {
                        attempts++;
                        const el = document.querySelector(selector);
                        if (el) {
                            clearInterval(check);
                            callback(el);
                        } else if (attempts >= maxAttempts) {
                            clearInterval(check);
                            window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "元素未找到: " + selector }, "*");
                        }
                    }, 100);
                }

                // 1. 选择方程类型
                waitForElement("select#Select1", (select) => {
                    select.value = equationType;
                    select.dispatchEvent(new Event("change", { bubbles: true }));

                    // 2. 填写X轴数据
                    waitForElement("#TextArea1", (xInput) => {
                        xInput.value = xAxisString;
                        xInput.dispatchEvent(new Event("input", { bubbles: true }));
                        xInput.dispatchEvent(new Event("change", { bubbles: true }));

                        // 3. 填写Y轴数据
                        setTimeout(() => {
                            waitForElement("#TextArea2", (yInput) => {
                                yInput.value = yAxisString;
                                yInput.dispatchEvent(new Event("input", { bubbles: true }));
                                yInput.dispatchEvent(new Event("change", { bubbles: true }));

                                // 4. 点击拟合按钮
                                setTimeout(() => {
                                    waitForElement("#Button1", (fitButton) => {
                                        fitButton.click();

                                        // 5. 等待图片加载并返回 DataURL
                                        setTimeout(() => {
                                            waitForElement("#img1", (img) => {
                                                try {
                                                    const sendImage = (dataUrl) => {
                                                        // Extract R2 & b
                                                        let r2 = "未生成";
                                                        let bVal = "未生成";
                                                        try {
                                                            const ps = document.querySelectorAll("p");
                                                            for (const p of ps) {
                                                                const txt = p.textContent || "";
                                                                if (txt.includes("相关系数")) {
                                                                    const parts = txt.split("：");
                                                                    if (parts.length > 1) r2 = parts[1].trim();
                                                                }
                                                                // <p><strong>b =</strong> 0.01362</p>
                                                                // txt usually: "b = 0.01362" (tags stripped by textContent)
                                                                if (txt.includes("b =")) {
                                                                    const parts = txt.split("=");
                                                                    if (parts.length > 1) bVal = parts[1].trim();
                                                                }
                                                            }
                                                        } catch (e) {
                                                            console.warn("R2/b extract failed", e);
                                                        }

                                                        if (event.source) {
                                                            event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: true, data: dataUrl, r2: r2, b: bVal }, "*");
                                                        } else {
                                                            window.opener && window.opener.postMessage({ type: "TM_CROSS_SITE_DONE", success: true, data: dataUrl, r2: r2, b: bVal }, "*");
                                                        }
                                                    };

                                                    if (img.tagName === "CANVAS") {
                                                        sendImage(img.toDataURL("image/png"));
                                                    } else {
                                                        const processImg = () => {
                                                            if (img.naturalWidth > 0) {
                                                                const canvas = document.createElement("canvas");
                                                                canvas.width = img.naturalWidth;
                                                                canvas.height = img.naturalHeight;
                                                                const ctx = canvas.getContext("2d");
                                                                ctx.drawImage(img, 0, 0);
                                                                sendImage(canvas.toDataURL("image/png"));
                                                            } else {
                                                                event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片宽度为0" }, "*");
                                                            }
                                                        };

                                                        if (img.complete) {
                                                            processImg();
                                                        } else {
                                                            img.onload = processImg;
                                                            img.onerror = () => {
                                                                event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片加载失败" }, "*");
                                                            };
                                                        }
                                                    }
                                                } catch (e) {
                                                    event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "获取图片数据出错: " + e.message }, "*");
                                                }
                                            }, delays.imageLoad);
                                        }, delays.afterClick);
                                    }, 1000);
                                }, delays.afterFill);
                            });
                        }, 500);
                    });
                });
            } catch (e) {
                window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: e.message }, "*");
            }
        }
    });
}

// init
console.log("[TM] 脚本初始化，当前 URL:", window.location.href);
if (window.location.href.includes("doubao.com")) {
    console.log("[TM] 检测到豆包页面，调用 runDoubaoGuestLogic");
    runDoubaoGuestLogic();
} else if (!window.location.href.includes("qinms.com/webapp/curvefit")) {
    console.log("[TM] 主页面初始化");
    initState(); // Ensure state is ready
    initUserInfoCapture();
    injectPanel();
    checkAutoLogin();
}

async function checkAutoLogin() {
    const targetId = localStorage.getItem("__tm_auto_login_id");
    if (!targetId) return;

    // 检查是否在登录页面 (根据用户名输入框判断)
    const userInp = document.getElementById("userName");
    const passInp = document.getElementById("userPass");
    const codeInp = document.getElementById("checkCode");
    const loginBtn = document.querySelector(".loginBut");

    if (userInp && passInp) {
        // 自动填入学号作为用户名和密码
        userInp.value = targetId;
        passInp.value = targetId;

        // 触发 input 事件确保 UI 响应
        userInp.dispatchEvent(new Event("input", { bubbles: true }));
        passInp.dispatchEvent(new Event("input", { bubbles: true }));

        // 填完后从缓存清除，防止下次打开还是这个
        localStorage.removeItem("__tm_auto_login_id");

        // 如果有验证码图片且提供了识别逻辑
        const img = document.getElementById("imgCheckCode");
        if (img && typeof aiRecognizeCaptcha === "function") {
            try {
                console.log("[TM] 正在通过 AI 识别验证码...");
                const code = await aiRecognizeCaptcha(img);
                if (code && codeInp) {
                    codeInp.value = code;
                    codeInp.dispatchEvent(new Event("input", { bubbles: true }));
                    console.log("[TM] AI 识别成功:", code);
                    // 尝试自动登录
                    if (loginBtn) loginBtn.click();
                }
            } catch (e) {
                console.error("[TM] AI 识别失败:", e);
                if (codeInp) codeInp.focus();
            }
        } else if (codeInp) {
            codeInp.focus();
        }
    }
}

function initUserInfoCapture() {
    // 1. Capture Name
    const captureName = () => {
        const el = document.getElementById("LoginUserName");
        if (el && el.textContent.trim()) {
            state.userInfo.name = el.textContent.trim();
            if (typeof updateUserInfoUI === "function") updateUserInfoUI();
            return true;
        }
        return false;
    };
    captureName();
    // Maybe name updates later (e.g. async login)
    const nameObserver = new MutationObserver(() => {
        if (captureName()) nameObserver.disconnect();
    });
    nameObserver.observe(document.documentElement, { childList: true, subtree: true });

    // 2. Capture Student ID from Network
    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function () {
            return originalFetch.apply(this, arguments).then(async (response) => {
                const url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
                if (url && url.includes("GetStudentReportScore")) {
                    try {
                        const clone = response.clone();
                        const data = await clone.json();
                        const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                        if (sid) {
                            state.userInfo.studentId = sid;
                            if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                        }
                    } catch (e) { }
                }
                return response;
            });
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string' && url.includes("GetStudentReportScore")) {
            this.addEventListener("load", function () {
                try {
                    const data = JSON.parse(this.responseText);
                    const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                    if (sid) {
                        state.userInfo.studentId = sid;
                        if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                    }
                } catch (e) { }
            });
        }
        return originalOpen.apply(this, arguments);
    };

    // 4. Capture from XDR (if exists)
    const OriginalXDR = window.XDomainRequest;
    if (OriginalXDR) {
        window.XDomainRequest = function () {
            const xdr = new OriginalXDR();
            const originalOpenXDR = xdr.open;
            xdr.open = function (method, url) {
                if (typeof url === "string" && url.includes("GetStudentReportScore")) {
                    const originalOnload = xdr.onload;
                    xdr.onload = function () {
                        try {
                            const data = JSON.parse(xdr.responseText);
                            const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                            if (sid) {
                                state.userInfo.studentId = sid;
                                if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                            }
                        } catch (e) { }
                        if (originalOnload) originalOnload.apply(this, arguments);
                    };
                }
                return originalOpenXDR.apply(this, arguments);
            };
            return xdr;
        };
    }
}



})();
