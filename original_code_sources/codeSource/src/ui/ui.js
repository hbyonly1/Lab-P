/** ---------------------------
 *  Main UI Panel
 *  --------------------------- */

/** ---------------------------
 *  GUI panel
 *  --------------------------- */
function injectPanel() {
    if (document.getElementById("__tm_cfg_panel")) return;

    const root = document.createElement("div");
    root.id = "__tm_cfg_panel";
    root.style.cssText = `
      position: fixed; right: 14px; bottom: 14px; width: 340px; height: 500px;
      z-index: 999999; border-radius: 14px;
      background: rgba(10,14,20,.96);
      border: 1px solid rgba(40,60,90,.9);
      box-shadow: 0 8px 30px rgba(0,0,0,.45);
      color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial;
      overflow: hidden; display: flex; flex-direction: column;
    `;

    // CSS for Tabs
    const style = document.createElement("style");
    style.textContent = `
        .tm-tab-header { display: flex; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(40,60,90,0.4); }
        .tm-tab-btn { flex: 1; padding: 8px 0; text-align: center; cursor: pointer; color: #9fb3c8; font-size: 12px; border-bottom: 2px solid transparent; }
        .tm-tab-btn.active { color: #e6edf3; border-bottom-color: #58a6ff; font-weight: 500; background: rgba(40,60,90,0.1); }
        .tm-tab-btn:hover:not(.active) { background: rgba(40,60,90,0.2); }
        .tm-tab-content { flex: 1; display: none; overflow-y: auto; padding: 12px; flex-direction: column; gap: 10px; }
        .tm-tab-content.active { display: flex; }
        .tm-btn { padding: 10px; border-radius: 12px; cursor: pointer; width: 100%; border: 1px solid rgba(40,60,90,.9); color: #e6edf3; background: #0f1720; margin-bottom: 8px; }
        .tm-btn:hover { background: #16202a; }
        .tm-btn-primary { background: #1f6feb; border-color: rgba(240,246,252,0.1); }
        .tm-btn-primary:hover { background: #388bfd; }
        .tm-btn-green { background: #1a2f1a; border-color: rgba(60,150,60,.9); }
        .tm-btn-green:hover { background: #233b23; }
        .tm-input { background: #0b0f14; border: 1px solid rgba(40,60,90,.9); color: #e6edf3; padding: 8px; border-radius: 10px; width: 100%; box-sizing: border-box; }
    `;
    root.appendChild(style);

    root.innerHTML += `
      <!-- Header -->
      <div id="__tm_head" style="display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid rgba(40,60,90,.8); flex-shrink: 0;">
        <div style="font-weight:700; font-size: 15px; flex:1;">CFG Toolkit</div>
        <button id="__tm_hide" style="background:#0f1720;border:1px solid rgba(40,60,90,.9);color:#e6edf3;padding:6px 8px;border-radius:10px;cursor:pointer;">隐藏</button>
      </div>
      
      <!-- Info Bar -->
      <div id="__tm_user_info" style="padding: 8px 12px; font-size: 15px; color: #9fb3c8; background: rgba(40,60,90,.2); border-bottom: 1px solid rgba(40,60,90,0.4); display: flex; gap: 15px; align-items: center; flex-shrink: 0;">
        <span style="display:flex;align-items:center;gap:4px;">👤 <span id="__tm_user_name" style="color:#e6edf3;">...</span></span>
        <span style="display:flex;align-items:center;gap:4px;">🆔 <span id="__tm_student_id" style="color:#e6edf3;">...</span></span>
      </div>

      <!-- Tab Navigation -->
      <div class="tm-tab-header">
        <div class="tm-tab-btn active" data-tab="tab1">准备</div>
        <div class="tm-tab-btn" data-tab="tab2">识别</div>
        <div class="tm-tab-btn" data-tab="tab3">计算</div>
        <div class="tm-tab-btn" data-tab="tab4">回填</div>
        <div class="tm-tab-btn" data-tab="tab5">日志</div>
      </div>

      <!-- Content Area -->
      <div id="__tm_body" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
        
        <!-- Tab 1: 实验准备 -->
        <div id="tab1" class="tm-tab-content active">
            <div style="background:rgba(40,60,90,0.2); padding:10px; border-radius:8px; margin-bottom:8px;">
                <div style="font-size:12px; color:#cea; margin-bottom:6px;">切换用户</div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <input id="__tm_input_switch_id" placeholder="点击输入学号" readonly class="tm-input" style="padding:6px; font-size:13px; cursor:pointer;" />
                    <div style="display:flex; gap:8px;">
                        <button id="__tm_btn_logout" style="flex:1; background:#203040; border:1px solid rgba(70,120,190,.9); color:#e6edf3; padding:6px 12px; border-radius:8px; cursor:pointer;">切换</button>
                        <button id="__tm_btn_login_manual" style="flex:1; background:#1a2f1a; border:1px solid rgba(60,150,60,.9); color:#e6edf3; padding:6px 12px; border-radius:8px; cursor:pointer;">登录</button>
                        <button id="__tm_btn_reset_apikey" style="width:40px; background:#3a2a1a; border:1px solid rgba(150,100,60,.9); color:#e6edf3; padding:6px; border-radius:8px; cursor:pointer;" title="重置 API Key">🔑</button>
                    </div>
                </div>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <select id="__tm_profile" class="tm-input" style="padding:8px;"></select>
                <button id="__tm_load" style="background:#0f1720;border:1px solid rgba(40,60,90,.9);color:#e6edf3;padding:8px 10px;border-radius:10px;cursor:pointer;white-space:nowrap;">加载配置</button>
                <input id="__tm_file" type="file" webkitdirectory directory multiple style="display:none" />
            </div>
            <button id="__tm_btn_switch_exp" class="tm-btn tm-btn-primary">切换到对应实验</button>
            <button id="__tm_btn_batch_pre_recognize" class="tm-btn" style="background:#5a2a5a; border-color:rgba(180,90,180,.9);">（豆包API）批量预识别所有数据</button>
            <button id="__tm_btn_run_automation" class="tm-btn" style="background:#555; border-color:rgba(150,150,150,.9);">执行此配置的所有自动化流程</button>
        </div>

        <!-- Tab 2: 数据识别 -->
        <div id="tab2" class="tm-tab-content">
            <button id="__tm_btn_upload_exp_image" class="tm-btn tm-btn-green">插入实验数据图片</button>
            <button id="__tm_btn_fill_from_pre_rec" class="tm-btn" style="background:#4a3a2a;border-color:rgba(180,140,80,.9);">从预识别文件填写</button>
            <button id="__tm_btn_preview_exp_image" class="tm-btn" style="background:#203040;border-color:rgba(70,120,190,.9);">预览实验图片</button>
            <button id="__tm_btn_recognize_data" class="tm-btn" style="background:#2a1a3a;border-color:rgba(120,60,180,.9);">（豆包API）识别实验数据并填写</button>
            <button id="__tm_btn_copy_prompt_rec" class="tm-btn" style="background:#202530;border-color:rgba(80,90,100,.5)">查看识别prompt</button>
            <button id="__tm_btn_fill_dict" class="tm-btn" style="background:#1a2a3a;border-color:rgba(60,120,180,.9);">根据自定义字典填写数据</button>
            <button id="__tm_btn_custom" class="tm-btn">管理自定义数据</button>
        </div>

        <!-- Tab 3: 计算与预览 -->
        <div id="tab3" class="tm-tab-content">
            <button id="__tm_btn_extract" class="tm-btn tm-btn-primary">读取并计算数据</button>
            
            <div style="display:flex; gap:8px;">
                <button id="__tm_btn_preview" class="tm-btn" style="flex:1;">预览待填数据</button>
                <button id="__tm_btn_generate_strings" class="tm-btn" style="flex:1;">预览曲线参数</button>
            </div>
            
            <button id="__tm_btn_cross_site" class="tm-btn" style="background:#1a2f3f;border-color:rgba(60,150,200,.9);">生成曲线图图片</button>

            <!-- Hidden btns -->
            <button id="__tm_btn_pause" style="display:none;">暂停</button>
            <button id="__tm_btn_resume" style="display:none;">继续</button>
        </div>

        <!-- Tab 4: 回填与导出 -->
        <div id="tab4" class="tm-tab-content">

            <button id="__tm_btn_apply_const" class="tm-btn tm-btn-primary">回填常量</button>
            <button id="__tm_btn_apply_var" class="tm-btn tm-btn-primary">回填变量</button>
            
            <button id="__tm_btn_generate_answer" class="tm-btn" style="background:#2a1a3a;border-color:rgba(120,60,180,.9);">（豆包API）生成实验问题答案并填写</button>
            <button id="__tm_btn_check_fill" class="tm-btn" style="background:#b8741a;border-color:rgba(180,90,60,.9);">检查填写状态</button>
            <div style="display:flex; gap:8px;">
                <button id="__tm_btn_submit" class="tm-btn" style="flex:1; background:#203040; border-color:rgba(70,120,190,.9);">正式提交</button>
                <button id="__tm_btn_close" class="tm-btn" style="flex:1; background:#302020; border-color:rgba(190,70,70,.9);">关闭当前页面</button>
            </div>

            <button id="__tm_btn_export_page" class="tm-btn">导出页面已填数据 (JSON)</button>
        </div>

        <!-- Tab 5: 日志 -->
        <div id="tab5" class="tm-tab-content" style="padding:0; display:none; flex-direction:column;">
            <div id="__tm_status" style="padding:8px; font-size:12px; color:#eee; background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(40,60,90,0.2);">状态: 就绪</div>
            <div id="__tm_batch_status" style="display:none;"></div>
            <div id="__tm_log_panel" style="flex:1; overflow-y:auto; padding:8px; font-family:'Consolas',monospace; font-size:12px; color:#9fb3c8;">
                <div id="__tm_log_content">
                    <div style="color: #58a6ff;">系统日志已就绪</div>
                </div>
            </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);

    // --- Tab Switching Logic ---
    const tabBtns = root.querySelectorAll(".tm-tab-btn");
    const tabContents = root.querySelectorAll(".tm-tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => {
                c.classList.remove("active");
                c.style.display = "none";
            });

            // Set active
            btn.classList.add("active");
            const tabId = btn.dataset.tab;
            const content = root.querySelector("#" + tabId);
            content.classList.add("active");

            // Special display handling for flex
            if (tabId === "tab5") {
                content.style.display = "flex";
            } else {
                content.style.display = "flex";
            }
        });
    });

    const head = root.querySelector("#__tm_head");
    const body = root.querySelector("#__tm_body");
    // const status was here, now in tab 5 but querySelector searches result-wide
    const status = root.querySelector("#__tm_status");

    // hide / show logic needs update as body is now different
    let collapsed = false;
    root.querySelector("#__tm_hide").addEventListener("click", () => {
        collapsed = !collapsed;
        const h = collapsed ? "44px" : "500px";
        root.style.height = h;
        root.querySelector("#__tm_hide").textContent = collapsed ? "展开" : "隐藏";
    });

    // drag panel by header
    enableDrag(root, head);

    // Prompt for switch id
    root.querySelector("#__tm_input_switch_id").addEventListener("click", function () {
        const val = prompt("请输入学号", this.value);
        if (val !== null) {
            this.value = val;
            this.dispatchEvent(new Event("input"));
        }
    });

    // Switch Experiment Logic
    root.querySelector("#__tm_btn_switch_exp").addEventListener("click", async () => {
        await switchExperimentAction(status);
    });

    // load config from file
    const fileInput = root.querySelector("#__tm_file");
    root.querySelector("#__tm_load").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) return;

        try {
            // Search for data.json in the selected directory
            let dataFile = null;
            for (let i = 0; i < files.length; i++) {
                if (files[i].name === "data.json") {
                    dataFile = files[i];
                    break;
                }
            }

            if (!dataFile) {
                throw new Error("未在选定目录中找到 data.json 文件");
            }

            const text = await dataFile.text();
            const cfg = JSON.parse(text);
            if (!cfg || !cfg.profiles) throw new Error("配置缺少 profiles 字段");

            // Store all files from the directory for later use (e.g., images)
            state.configFiles = Array.from(files);

            state.config = cfg;
            saveJSON(LS_KEY_CONFIG, cfg);
            refreshProfileSelect();
            status.textContent = "配置已加载（从 data.json）。";
            tmLog("配置已从目录加载: " + dataFile.webkitRelativePath, "success");
        } catch (e) {
            alert("配置加载失败：" + String(e?.message || e));
        } finally {
            fileInput.value = "";
        }
    });

    // Batch Pre-recognition
    root.querySelector("#__tm_btn_batch_pre_recognize").addEventListener("click", () => {
        const studentId = root.querySelector("#__tm_student_id").textContent.trim();
        runBatchPreRecognition(studentId); // from preRecognitionService.js
    });

    // Run Automation
    root.querySelector("#__tm_btn_run_automation").addEventListener("click", () => {
        runAutomationAction(); // from automationService.js
    });

    // Fill from Pre-recognition
    root.querySelector("#__tm_btn_fill_from_pre_rec").addEventListener("click", () => {
        const studentId = root.querySelector("#__tm_student_id").textContent.trim();
        fillFromPreRecognizedData(studentId); // from preRecognitionService.js
    });

    // Upload experiment image
    root.querySelector("#__tm_btn_upload_exp_image").addEventListener("click", handleUploadExpImage);

    // Preview experiment image
    root.querySelector("#__tm_btn_preview_exp_image").addEventListener("click", () => {
        previewExperimentImageAction();
    });

    // Recognize experiment data and fill
    root.querySelector("#__tm_btn_recognize_data").addEventListener("click", handleRecognizeData);


    // Copy Recognition Prompt
    root.querySelector("#__tm_btn_copy_prompt_rec").addEventListener("click", () => {
        const profile = getActiveProfile();
        if (!profile || !profile.prompts) {
            alert("无 Prompt 配置");
            tmLog("无 Prompt 配置", "warn");
            return;
        }

        const p = profile.prompts.find(x => x.type === "textRecognition");
        if (p && p.value) {
            // Manual copy
            tmLog("已显示 Prompt 供复制", "info");
            window.prompt("请复制以下识别 Prompt (Ctrl+C):", p.value);
        } else {
            tmLog("未找到 textRecognition 类型的 Prompt", "warn");
            alert("当前配置没有 textRecognition Prompt");
        }
    });

    // Inject Custom Styles (Yellow Highlight)
    const styleId = "__tm_highlight_styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.innerHTML = `
            @keyframes tm-pulse-yellow {
                0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.7); }
                70% { box-shadow: 0 0 0 6px rgba(255, 193, 7, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
            }
            .tm-unfilled-highlight {
                border: 2px solid #ffc107 !important;
                background-color: rgba(255, 193, 7, 0.1) !important;
                animation: tm-pulse-yellow 1.5s infinite !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Check Fill Status
    root.querySelector("#__tm_btn_check_fill").addEventListener("click", () => {
        checkFillStatusAction(); // from fillActions.js
    });

    // Generate answer and fill
    root.querySelector("#__tm_btn_generate_answer").addEventListener("click", () => {
        generateAnswerAction(); // from uiActions.js
    });

    // profile switch
    const sel = root.querySelector("#__tm_profile");
    sel.addEventListener("change", () => {
        state.activeProfileName = sel.value;
        localStorage.setItem(LS_KEY_PROFILE, state.activeProfileName);
        status.textContent = `已切换配置：${state.activeProfileName}`;
    });

    // export profile
    root.querySelector("#__tm_btn_export_page").addEventListener("click", () => {
        const choice = prompt(
            "导出范围：输入 1 或 2\n" +
            "1) 仅导出当前配置涉及字段（extract + fill）【推荐】\n" +
            "2) 导出页面所有带 id 的表单字段（可能很多）",
            "1"
        );

        const mode = (choice || "1").trim() === "2" ? "all" : "configured";
        const r = exportPageFilledDataAsJSON({ mode });
        if (r) status.textContent = `已导出：${r.exported} 项（缺失 ${r.missing}），文件：${r.filename}`;
    });

    // buttons
    root.querySelector("#__tm_btn_extract").addEventListener("click", () => {
        const r = runExtractAndCompute();
        if (!r.ok) return alert("运行失败：" + r.error);

        const parts = [];
        parts.push(`已运行：${state.activeProfileName}`);
        if (r.missing?.length) parts.push(`缺失节点：${r.missing.join(", ")}`);
        parts.push(`extract=${Object.keys(state.store.extract).length} 项`);
        status.textContent = parts.join(" | ");

        if (r.computeErrors?.length) console.warn("[TM] computeErrors", r.computeErrors);
    });

    root.querySelector("#__tm_btn_preview").addEventListener("click", () => openPreview());

    // Custom Data Manager
    root.querySelector("#__tm_btn_custom").addEventListener("click", () => {
        showCustomDataModal(); // from modalHelper.js
    });

    root.querySelector("#__tm_btn_fill_dict").addEventListener("click", () => {
        showDictFillModal(); // from modalHelper.js
    });

    // Helper for applying fill
    const doApply = (filterFn, label) => {
        const r = applyFill(filterFn);
        if (!r.ok) return alert(label + "失败：" + r.error);

        const fail = r.results.filter(x => !x.ok);
        const count = r.results.length;
        status.textContent = fail.length
            ? `${label}完成(${count}项)，但有 ${fail.length} 项失败（看 console）`
            : `${label}完成(${count}项)。`;
        if (fail.length) console.warn("[TM] apply failures", fail);
    };

    root.querySelector("#__tm_btn_apply_const").addEventListener("click", () => {
        // Constants: Has value, no dynamic source
        doApply(item => item.value !== undefined && !item.valueFromFn && !item.valueFrom, "常量回填");
    });

    root.querySelector("#__tm_btn_apply_var").addEventListener("click", () => {
        // Variables: Has dynamic source
        doApply(item => !!item.valueFromFn || !!item.valueFrom, "变量回填");
    });

    root.querySelector("#__tm_btn_submit").textContent = "正式提交并继续";
    root.querySelector("#__tm_btn_submit").addEventListener("click", () => {
        submitAndContinueAction(status);
    });

    root.querySelector("#__tm_btn_close").addEventListener("click", () => {
        const r = clickClose();
        if (r.ok) {
            status.textContent = "已点击关闭";
        } else {
            alert("操作失败：" + r.error);
        }
    });

    root.querySelector("#__tm_btn_logout").addEventListener("click", () => {
        const r = clickLogout();
        if (!r.ok && r.error !== "用户取消了登出") {
            alert("切换失败：" + r.error);
        }
    });

    root.querySelector("#__tm_btn_login_manual").addEventListener("click", async () => {
        const inputId = root.querySelector("#__tm_input_switch_id").value.trim();
        try {
            await performManualLogin(inputId);
        } catch (e) {
            alert(e.message);
        }
    });

    // Reset API Key
    root.querySelector("#__tm_btn_reset_apikey").addEventListener("click", () => {
        if (confirm("确定要清除并重新设置豆包 API Key 吗？")) {
            resetApiKey(); // from ai.js
            alert("API Key 已清除，下次登录时会提示重新输入");
        }
    });

    // 生成字符串预览
    const batchStatus = root.querySelector("#__tm_batch_status");
    root.querySelector("#__tm_btn_generate_strings").addEventListener("click", () => {
        try {
            const msg = generateStringPreviewAction();
            if (msg) status.textContent = msg;
        } catch (e) {
            // handled in action
        }
    });

    // 跨站批量处理
    const pauseBtn = root.querySelector("#__tm_btn_pause");
    const resumeBtn = root.querySelector("#__tm_btn_resume");

    root.querySelector("#__tm_btn_cross_site").addEventListener("click", () => {
        runCrossSiteBatchAction({ pauseBtn, resumeBtn, batchStatus, status });
    });

    pauseBtn.addEventListener("click", () => {
        if (pauseBatchCrossSite()) { // from crossSiteService
            pauseBtn.style.display = "none";
            resumeBtn.style.display = "block";
            status.textContent = "已暂停";
        }
    });

    resumeBtn.addEventListener("click", () => {
        if (resumeBatchCrossSite()) { // from crossSiteService
            pauseBtn.style.display = "block";
            resumeBtn.style.display = "none";
            status.textContent = "已继续";
        }
    });

    function refreshProfileSelect() {
        const profiles = getProfiles();
        sel.innerHTML = "";
        for (const name of Object.keys(profiles)) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        }
        // set active
        const profile = getActiveProfile();
        sel.value = state.activeProfileName || (profile ? state.activeProfileName : "");
    }

    refreshProfileSelect();
    status.textContent = state.config ? "已读取本地配置。可直接操作。" : "未加载配置。点击“加载配置”选择 JSON 文件。";

    // Initial UI update
    updateUserInfoUI();
}

function updateUserInfoUI() {
    const nameEl = document.getElementById("__tm_user_name");
    const idEl = document.getElementById("__tm_student_id");
    if (nameEl) nameEl.textContent = state.userInfo.name || "未知";
    if (idEl) idEl.textContent = state.userInfo.studentId || "未知";
}

function enableDrag(panel, handle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e) => {
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;

        panel.style.left = `${startLeft}px`;
        panel.style.top = `${startTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = `${startLeft + dx}px`;
        panel.style.top = `${startTop + dy}px`;
    });

    document.addEventListener("mouseup", () => dragging = false);
}

/**
 * 显示测试模式提交确认框 (Non-blocking UI with Promise)
 */
function showSubmitConfirmationUI() {
    return new Promise((resolve, reject) => {
        // Create overlay
        const overlay = document.createElement("div");
        overlay.id = "__tm_test_confirm_overlay";
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 1000100;
            display: flex; align-items: center; justify-content: center;
        `;

        const card = document.createElement("div");
        card.style.cssText = `
            background: #0f1720; border: 1px solid rgba(40,60,90,.9);
            padding: 24px; border-radius: 12px;
            color: #e6edf3; font-family: system-ui;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            width: 320px;
        `;

        card.innerHTML = `
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px; display:flex; align-items:center gap:8px;">
                <span>🚧 测试模式</span>
            </div>
            <div style="font-size: 14px; color: #8b949e; margin-bottom: 24px; line-height: 1.5;">
                自动化脚本已完成所有操作，准备执行提交。<br>
                由于处于测试模式，提交操作已被拦截。
            </div>
            <div style="display: flex; gap: 12px;">
                <button id="__tm_btn_cancel_submit" style="
                    flex: 1; padding: 10px; border: 1px solid rgba(248,81,73,0.4);
                    background: rgba(248,81,73,0.1); color: #ff7b72;
                    border-radius: 6px; cursor: pointer; font-weight: 500;
                ">终止</button>
                <button id="__tm_btn_confirm_submit" style="
                    flex: 1; padding: 10px; border: 1px solid rgba(238,238,238,0.1);
                    background: #238636; color: #fff;
                    border-radius: 6px; cursor: pointer; font-weight: 500;
                ">继续提交</button>
            </div>
        `;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const close = () => {
            if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
        };

        document.getElementById("__tm_btn_confirm_submit").onclick = () => {
            close();
            tmLog("[测试模式] 用户确认提交", "success");
            resolve(true);
        };

        document.getElementById("__tm_btn_cancel_submit").onclick = () => {
            close();
            tmLog("[测试模式] 用户终止流程", "warn");
            reject(new Error("用户在测试模式下取消了提交"));
        };
    });
}
