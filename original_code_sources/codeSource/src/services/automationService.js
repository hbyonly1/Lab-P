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
