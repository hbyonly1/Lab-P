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
