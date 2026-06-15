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
