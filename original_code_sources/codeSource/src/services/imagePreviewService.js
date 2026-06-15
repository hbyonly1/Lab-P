/** ---------------------------
 *  Image Preview Service
 *  提供图片悬浮预览、缩放、拖拽功能
 *  --------------------------- */

let isPreviewOpen = false;

/**
 * 显示图片预览悬浮窗
 * @param {string} base64 - 图片 Base64 数据
 */
function showImagePreview(base64) {
    if (isPreviewOpen) {
        tmLog("预览窗口已打开", "warn");
        return;
    }

    // 1. Create Container
    const container = document.createElement("div");
    container.id = "__tm_preview_container";
    container.style.cssText = `
        position: fixed; top: 100px; left: 100px; width: 800px; height: 600px;
        background: rgba(0,0,0,0.8); border: 2px solid #58a6ff; border-radius: 8px;
        z-index: 1000000; overflow: hidden; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7); resize: both;
    `;

    // 2. Create Header (Drag Handler & Close)
    const header = document.createElement("div");
    header.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 30px;
        background: rgba(40,60,90,0.8); cursor: move; z-index: 2;
        display: flex; justify-content: flex-end; align-items: center; padding: 0 10px; box-sizing: border-box;
    `;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
        background: none; border: none; color: #fff; font-size: 18px; cursor: pointer;
    `;
    closeBtn.onclick = () => {
        document.body.removeChild(container);
        isPreviewOpen = false;
    };
    header.appendChild(closeBtn);
    container.appendChild(header);

    // 3. Create Image Wrapper
    const imgWrapper = document.createElement("div");
    imgWrapper.style.cssText = `
        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden;
    `;

    // 4. Create Image
    const img = document.createElement("img");
    img.src = base64;
    img.style.cssText = `
        max-width: 100%; max-height: 100%; transition: transform 0.1s; cursor: grab;
    `;
    imgWrapper.appendChild(img);
    container.appendChild(imgWrapper);
    document.body.appendChild(container);

    isPreviewOpen = true;

    // --- Window Drag Logic (Header) ---
    enableDrag(container, header);

    // --- Image Zoom & Pan Logic ---
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDraggingImg = false;
    let startX = 0, startY = 0;

    const updateTransform = () => {
        img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    };

    // Zoom
    container.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        scale *= delta;
        scale = Math.min(Math.max(0.1, scale), 10); // Limit scale
        updateTransform();
    });

    // Pan (Drag Image)
    img.addEventListener("mousedown", (e) => {
        isDraggingImg = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        img.style.cursor = "grabbing";
        e.preventDefault();
        e.stopPropagation(); // prevent window drag
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDraggingImg) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateTransform();
    });

    document.addEventListener("mouseup", () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            img.style.cursor = "grab";
        }
    });
}
