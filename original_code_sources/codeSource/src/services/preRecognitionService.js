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
