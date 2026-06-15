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
