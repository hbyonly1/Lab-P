/** ---------------------------
 *  Validator Service
 *  验证相关业务逻辑
 *  --------------------------- */

/**
 * 验证填写状态
 * @param {Object} profile - 当前配置
 * @param {Array<string>} exclusions - 排除项选择器列表
 * @returns {Object} - { unfilled: Array<Element>, candidates: Array<Element> }
 */
function validateFillStatus(profile, exclusions = []) {
    const candidates = Array.from(document.querySelectorAll("input, textarea, select, .wysiwyg-editor"));

    const unfilled = candidates.filter(el => {
        // 1. Basic Filters for Input/Textarea/Select
        if (el.tagName === "INPUT") {
            const t = el.type.toLowerCase();
            if (t === "hidden" || t === "button" || t === "submit" || t === "image" || t === "file" || el.disabled) return false;
        }
        if ((el.tagName === "TEXTAREA" || el.tagName === "SELECT") && el.disabled) return false;

        // 2. Exclusion (ID or Selector)
        // Support exact ID match OR selector match
        if (el.id && exclusions.includes(el.id)) return false; // Legacy/Simple check

        // Advanced check: Iterate exclusions and see if element matches selector
        const isExcluded = exclusions.some(selector => {
            try {
                return el.matches(selector);
            } catch (e) {
                // selector might be a simple ID without #, check standard ID equality
                return el.id === selector;
            }
        });
        if (isExcluded) return false;

        // 3. Check Value
        let val = "";
        let hasContent = false;

        if (el.classList.contains("wysiwyg-editor")) {
            const text = el.textContent.trim();
            const html = el.innerHTML.trim();
            // Check if it has text OR images
            if (text) hasContent = true;
            if (html.includes("<img")) hasContent = true;
        } else {
            val = el.value.trim();
            if (val) hasContent = true;
        }

        if (!hasContent) {
            // Highlight
            el.classList.add("tm-unfilled-highlight");
            return true;
        } else {
            // Clear highlight
            el.classList.remove("tm-unfilled-highlight");
            return false;
        }
    });

    return { unfilled, candidates };
}
