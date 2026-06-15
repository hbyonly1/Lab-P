/** ---------------------------
 *  Auth Service
 *  认证相关服务
 *  --------------------------- */

/**
 * 执行手动登录
 * @param {string} studentId - 学号
 */
async function performManualLogin(studentId) {
    const userInp = document.getElementById("userName");
    const passInp = document.getElementById("userPass");
    const codeInp = document.getElementById("checkCode");
    const loginBtn = document.querySelector(".loginBut");

    if (!userInp || !passInp) {
        throw new Error("未检测到登录表单，请确认您在登录页面");
    }

    if (!studentId || !studentId.trim()) {
        throw new Error("请输入学号");
    }

    // Fill username and password
    userInp.value = studentId;
    passInp.value = studentId;
    userInp.dispatchEvent(new Event("input", { bubbles: true }));
    passInp.dispatchEvent(new Event("input", { bubbles: true }));

    // AI Captcha recognition
    const img = document.getElementById("imgCheckCode");
    if (img && typeof aiRecognizeCaptcha === "function") {
        try {
            const code = await aiRecognizeCaptcha(img);
            if (code && codeInp) {
                codeInp.value = code;
                codeInp.dispatchEvent(new Event("input", { bubbles: true }));
                // Auto click login
                if (loginBtn) {
                    loginBtn.click();
                    return { success: true, autoLogin: true };
                }
            }
        } catch (e) {
            console.warn("[TM] Manual Login AI Error:", e);
            if (codeInp) codeInp.focus();
            return { success: false, error: e.message, needManualCaptcha: true };
        }
    } else if (codeInp) {
        codeInp.focus();
        return { success: true, autoLogin: false, needManualCaptcha: true };
    }

    return { success: true, autoLogin: false };
}
