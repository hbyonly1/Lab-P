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
