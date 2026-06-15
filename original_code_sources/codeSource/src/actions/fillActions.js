/** ---------------------------
 *  Fill Actions
 *  填写相关动作
 *  --------------------------- */

/**
 * 检查填写状态动作
 */
function checkFillStatusAction() {
    const profile = getActiveProfile();
    const exclusions = profile && profile.excludedNodesList ? profile.excludedNodesList : [];

    const { unfilled, candidates } = validateFillStatus(profile, exclusions);

    if (unfilled.length > 0) {
        // 有未填项，弹窗提示
        // Scroll to first
        unfilled[0].scrollIntoView({ behavior: "smooth", block: "center" });

        const msg = `发现 ${unfilled.length} 个未填项，已高亮显示（黄色）。`;
        tmLog(msg, "warn");

        const details = unfilled.map((el, i) => {
            let desc = `${i + 1}. ${el.tagName.toLowerCase()}`;
            if (el.id) desc += `#${el.id}`;
            else if (el.name) desc += `[name="${el.name}"]`;
            else if (el.className) desc += `.${Array.from(el.classList).join(".")}`;
            return desc;
        }).join("\n");

        tmLog("未填详情:\n" + details, "warn");
        console.warn("[TM] Unfilled nodes details:\n" + details);
        console.warn("[TM] Unfilled nodes objects:", unfilled);

        alert(msg + "\n页面已自动滚动到第一个未填项。\n\n详情:\n" + details);
    } else {
        // 全部填写完成，不弹窗，只记录日志
        const msg = "检查通过：所有必填项均已填写。";
        tmLog(msg, "success");
        // 不再弹出alert
        // Clear all highlights
        candidates.forEach(el => {
            el.classList.remove("tm-unfilled-highlight");
        });
    }
}
