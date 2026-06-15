// --- Main Init ---

/** ---------------------------
 *  跨站消息监听（在目标网站运行）
 *  --------------------------- */
// 如果当前页面是目标网站，监听来自父窗口的消息
if (window.location.href.includes("qinms.com/webapp/curvefit")) {
    window.addEventListener("message", (event) => {
        // 只处理来自可信源的消息
        if (event.data && event.data.type === "TM_CROSS_SITE_EXECUTE") {
            const { equationType, xAxisString, yAxisString, delays } = event.data;

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
                    select.value = equationType;
                    select.dispatchEvent(new Event("change", { bubbles: true }));

                    // 2. 填写X轴数据
                    waitForElement("#TextArea1", (xInput) => {
                        xInput.value = xAxisString;
                        xInput.dispatchEvent(new Event("input", { bubbles: true }));
                        xInput.dispatchEvent(new Event("change", { bubbles: true }));

                        // 3. 填写Y轴数据
                        setTimeout(() => {
                            waitForElement("#TextArea2", (yInput) => {
                                yInput.value = yAxisString;
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
                                                        // Extract R2 & b
                                                        let r2 = "未生成";
                                                        let bVal = "未生成";
                                                        try {
                                                            const ps = document.querySelectorAll("p");
                                                            for (const p of ps) {
                                                                const txt = p.textContent || "";
                                                                if (txt.includes("相关系数")) {
                                                                    const parts = txt.split("：");
                                                                    if (parts.length > 1) r2 = parts[1].trim();
                                                                }
                                                                // <p><strong>b =</strong> 0.01362</p>
                                                                // txt usually: "b = 0.01362" (tags stripped by textContent)
                                                                if (txt.includes("b =")) {
                                                                    const parts = txt.split("=");
                                                                    if (parts.length > 1) bVal = parts[1].trim();
                                                                }
                                                            }
                                                        } catch (e) {
                                                            console.warn("R2/b extract failed", e);
                                                        }

                                                        if (event.source) {
                                                            event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: true, data: dataUrl, r2: r2, b: bVal }, "*");
                                                        } else {
                                                            window.opener && window.opener.postMessage({ type: "TM_CROSS_SITE_DONE", success: true, data: dataUrl, r2: r2, b: bVal }, "*");
                                                        }
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
                                                                event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片宽度为0" }, "*");
                                                            }
                                                        };

                                                        if (img.complete) {
                                                            processImg();
                                                        } else {
                                                            img.onload = processImg;
                                                            img.onerror = () => {
                                                                event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "图片加载失败" }, "*");
                                                            };
                                                        }
                                                    }
                                                } catch (e) {
                                                    event.source && event.source.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: "获取图片数据出错: " + e.message }, "*");
                                                }
                                            }, delays.imageLoad);
                                        }, delays.afterClick);
                                    }, 1000);
                                }, delays.afterFill);
                            });
                        }, 500);
                    });
                });
            } catch (e) {
                window.postMessage({ type: "TM_CROSS_SITE_DONE", success: false, error: e.message }, "*");
            }
        }
    });
}

// init
console.log("[TM] 脚本初始化，当前 URL:", window.location.href);
if (window.location.href.includes("doubao.com")) {
    console.log("[TM] 检测到豆包页面，调用 runDoubaoGuestLogic");
    runDoubaoGuestLogic();
} else if (!window.location.href.includes("qinms.com/webapp/curvefit")) {
    console.log("[TM] 主页面初始化");
    initState(); // Ensure state is ready
    initUserInfoCapture();
    injectPanel();
    checkAutoLogin();
}

async function checkAutoLogin() {
    const targetId = localStorage.getItem("__tm_auto_login_id");
    if (!targetId) return;

    // 检查是否在登录页面 (根据用户名输入框判断)
    const userInp = document.getElementById("userName");
    const passInp = document.getElementById("userPass");
    const codeInp = document.getElementById("checkCode");
    const loginBtn = document.querySelector(".loginBut");

    if (userInp && passInp) {
        // 自动填入学号作为用户名和密码
        userInp.value = targetId;
        passInp.value = targetId;

        // 触发 input 事件确保 UI 响应
        userInp.dispatchEvent(new Event("input", { bubbles: true }));
        passInp.dispatchEvent(new Event("input", { bubbles: true }));

        // 填完后从缓存清除，防止下次打开还是这个
        localStorage.removeItem("__tm_auto_login_id");

        // 如果有验证码图片且提供了识别逻辑
        const img = document.getElementById("imgCheckCode");
        if (img && typeof aiRecognizeCaptcha === "function") {
            try {
                console.log("[TM] 正在通过 AI 识别验证码...");
                const code = await aiRecognizeCaptcha(img);
                if (code && codeInp) {
                    codeInp.value = code;
                    codeInp.dispatchEvent(new Event("input", { bubbles: true }));
                    console.log("[TM] AI 识别成功:", code);
                    // 尝试自动登录
                    if (loginBtn) loginBtn.click();
                }
            } catch (e) {
                console.error("[TM] AI 识别失败:", e);
                if (codeInp) codeInp.focus();
            }
        } else if (codeInp) {
            codeInp.focus();
        }
    }
}

function initUserInfoCapture() {
    // 1. Capture Name
    const captureName = () => {
        const el = document.getElementById("LoginUserName");
        if (el && el.textContent.trim()) {
            state.userInfo.name = el.textContent.trim();
            if (typeof updateUserInfoUI === "function") updateUserInfoUI();
            return true;
        }
        return false;
    };
    captureName();
    // Maybe name updates later (e.g. async login)
    const nameObserver = new MutationObserver(() => {
        if (captureName()) nameObserver.disconnect();
    });
    nameObserver.observe(document.documentElement, { childList: true, subtree: true });

    // 2. Capture Student ID from Network
    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function () {
            return originalFetch.apply(this, arguments).then(async (response) => {
                const url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
                if (url && url.includes("GetStudentReportScore")) {
                    try {
                        const clone = response.clone();
                        const data = await clone.json();
                        const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                        if (sid) {
                            state.userInfo.studentId = sid;
                            if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                        }
                    } catch (e) { }
                }
                return response;
            });
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string' && url.includes("GetStudentReportScore")) {
            this.addEventListener("load", function () {
                try {
                    const data = JSON.parse(this.responseText);
                    const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                    if (sid) {
                        state.userInfo.studentId = sid;
                        if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                    }
                } catch (e) { }
            });
        }
        return originalOpen.apply(this, arguments);
    };

    // 4. Capture from XDR (if exists)
    const OriginalXDR = window.XDomainRequest;
    if (OriginalXDR) {
        window.XDomainRequest = function () {
            const xdr = new OriginalXDR();
            const originalOpenXDR = xdr.open;
            xdr.open = function (method, url) {
                if (typeof url === "string" && url.includes("GetStudentReportScore")) {
                    const originalOnload = xdr.onload;
                    xdr.onload = function () {
                        try {
                            const data = JSON.parse(xdr.responseText);
                            const sid = data.StudentID || (data.DataList && data.DataList[0] && data.DataList[0].StudentID);
                            if (sid) {
                                state.userInfo.studentId = sid;
                                if (typeof updateUserInfoUI === "function") updateUserInfoUI();
                            }
                        } catch (e) { }
                        if (originalOnload) originalOnload.apply(this, arguments);
                    };
                }
                return originalOpenXDR.apply(this, arguments);
            };
            return xdr;
        };
    }
}
