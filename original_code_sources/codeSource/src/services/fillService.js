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
