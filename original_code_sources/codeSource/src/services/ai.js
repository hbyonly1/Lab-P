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
