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
