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
