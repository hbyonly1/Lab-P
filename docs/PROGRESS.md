# Progress

## 2026-07-07

### 填写页自动草稿保存

- 新增 `submission_drafts` 表和 Alembic migration `c3d4e5f6a7b8_add_submission_drafts.py`，用独立当前草稿承接填写页 autosave，避免污染 `submissions.corrected_json` 和 `submission_versions` 提交历史。
- 新增 `GET/PATCH /api/v1/submissions/{submission_id}/draft`：学生只能保存自己的 submission，reviewer/admin 按审核任务权限保存；接口只覆盖草稿，不写提交历史、不触发学校系统 job。
- 前端新增 `useSubmissionDraftAutosave`：本地草稿即时写入 `localStorage`，后端 2 秒防抖同步；页面隐藏/跳转前尽力 flush，重新进入时恢复本地或后端较新的未提交草稿。
- 学生和 reviewer 共用的 `ExperimentDetailView` 已接入 autosave，普通填空、表格、实验回答、图片上传、AI 识别/填空/回答和公式计算回填都会排队保存；Admin 实验预览仅本地保存，不写业务 submission。
- 验证：`python3 -m py_compile backend/models/core.py backend/api/v1/submissions.py backend/tests/test_e2e_flow.py` 通过；`frontend/ npm run build` 通过；`alembic upgrade head` 已应用到 `c3d4e5f6a7b8`；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py::test_submission_draft_autosave_does_not_create_submit_history backend/tests/test_e2e_flow.py::test_save_correction_syncs_image_slots_to_target_node -q` 两项通过。

### 图片预览放大交互增强

- `ExperimentImageUploader` 的图片预览放大上限从保守小倍率提升到 6 倍，放大/缩小步进改为 0.5。
- 图片预览区支持鼠标滚轮缩放，放大后仍可拖拽平移查看局部细节；默认预览画布高度同步增大，内嵌图片节点使用较小但更可读的高度。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### AI 异步任务运行态统一

- 新增 `ai_task_runs` 表，以 Celery `task_id` 为主键统一记录一键填空、AI 图像识别和实验思考题生成的运行态、target、experiment/submission 诊断字段、started/finished audit 关联和错误诊断；`submission_id` 不做外键约束，避免任务日志因业务记录清理而丢失。
- `services.ai_task_audit` 扩展为异步 AI 任务唯一状态入口：API 入队调用 `start_ai_task_run`，worker 成功/失败调用 `complete_ai_task_run` / `fail_ai_task_run`；完成或失败时同步更新原 started audit 状态，避免日志列表长期显示“执行中”。
- Celery `task_failure` signal 兜底处理参数绑定失败等未进入业务函数体的异常；`GET /api/v1/ai/task/{task_id}` 只读取 Celery result backend，不再扫描或修补 `audit_logs.details`。
- 当前 `recognize_images_task` 代码签名已包含 `submission_id=None`；若仍出现 `takes 4 positional arguments but 5 were given`，说明运行中的 Celery worker 仍是旧进程，需要重启 worker 加载新代码。
- 验证：`py_compile backend/models/core.py backend/services/ai_task_audit.py backend/api/v1/ai.py backend/worker/ai_tasks.py backend/tests/test_e2e_flow.py` 通过；`alembic upgrade head` 已应用到 `b2c3d4e5f6a7`；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py::test_ai_assist_task_start_logs_submission_target backend/tests/test_e2e_flow.py::test_ai_assist_worker_completion_logs_canonical_action backend/tests/test_e2e_flow.py::test_ai_task_status_treats_started_as_pending backend/tests/test_e2e_flow.py::test_ai_task_failure_signal_reconciles_pre_run_failure_audit -q` 通过 4 项；`git diff --check` 通过。

### Prompt 附加说明改为实验 JSON 来源

- 图像识别和实验思考题生成的附加说明不再读取或写入 `ai_prompt_templates`，后端只从实验 JSON 的 `ai.recognition.extraPrompt` / `ai.generation.extraPrompt` 拼入用户指令末尾；system prompt 仍保留 `AiPromptTemplate -> Python 默认模板` 优先级。
- 新增 migration `f6a7b8c9d0e1_drop_ai_prompt_extra_columns.py`，删除 `ai_prompt_templates.recognition_extra_prompt` 和 `generation_extra_prompt`。
- Admin 实验 Prompt 页的附加说明输入框可编辑，保存时直接写回实验 JSON 并同步 `experiments.config_json`；预览会使用当前输入框内容临时生成 Prompt。
- 验证：`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过 12 项；`py_compile` 通过；`frontend/ npm run build` 通过；`alembic upgrade head` 已应用到 `f6a7b8c9d0e1`；数据库 `ai_prompt_templates` 仅剩 `experiment_id`、`recognition_system_prompt`、`generation_system_prompt`、`updated_at`；`git diff --check` 通过。

### 前端 AI 异步任务进度文案收拢

- 新增 `frontend/src/hooks/asyncTaskProgressProfiles.js`，集中维护一键填空、一键识别、生成回答和公式计算的分段式进度文案与进度百分比。
- `useAsyncTaskRunner` 支持 `progressProfile`，轮询 Celery 任务时根据已用时统一更新浮动任务面板，页面不再散落 `onProgress` 文案判断。
- 学生实验详情页和 reviewer 复用的 `ExperimentDetailView` 已改为引用公共 profile，因此两侧一键识别、填空、回答生成共享同一套长耗时提示。
- 验证：在 `frontend/` 执行 `npm run build` 通过；仓库执行 `git diff --check` 通过。

## 2026-06-04

- 完成 student 仪表盘原型改造：服务计划卡、实验完成环形进度、右侧指标卡、快捷提交入口和最近任务表。
- 仪表盘仍使用前端 mock 数据，字段命名向后续 `submissions` / `orders` 接口靠拢，但尚未声明为正式 API。
- 验证：在 `frontend/` 执行 `npm run build` 通过。
- 遗留风险：当前页面数据未接后端鉴权接口；Vite 构建提示主 chunk 超过 500 kB，后续可按路由做 code splitting。

### Student 仪表盘视觉修订

- 调整 student dashboard 背景和侧栏选中态为浅蓝灰体系，减少黑色块和旧背景残留。
- 快捷提交入口改为顶部横向大卡；主面板改为服务计划、实验进度、指标组三列，收紧网格以避免横向溢出。
- 服务计划卡去掉有效期，权益项改为逐行展示，管理计划按钮改为白底；移除奇怪的圆形渐变点。
- 指标卡将“成功率”改为“人工审核”；最近任务表去掉“实验类型”和“截止日期”列。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘紧凑化修订

- 去掉顶部任务通知按钮和服务计划“当前”标签。
- 修正实验完成进度圆心文字定位，改为绑定环形图容器居中。
- 收紧服务计划、实验完成进度和右侧四个指标卡的 padding、gap、tab 高度和卡片高度，减少首屏纵向占用。
- 服务计划标题改为单行展示，避免侧栏展开/收起时文字换行乱跳。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘交互修订

- 服务计划 Basic / Plus / Pro 切换按钮改为前端可点击状态，点击后同步切换计划名称、描述和权益列表。
- 当前计划按钮改为更明显的蓝色圆角胶囊样式。
- 实验完成进度标题与圆环增加间距，圆环和中心文案作为整体下移。
- 右侧指标卡去掉“较上周 +20%”“较上周 -25%”趋势文案。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘计划预览修订

- 修正服务计划按钮语义：当前计划固定显示为 Pro，点击 Basic / Plus / Pro 仅用于查看不同计划差异。
- 计划按钮圆角从大胶囊收敛为较小圆角，减少突兀感。
- 服务计划卡固定高度，权益项区域改为内部滚动列表，避免不同计划切换导致卡片高度变化或竖向溢出。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘卡片对齐修订

- 将“管理计划”按钮移动到“当前服务计划：Pro”标题行右侧。
- 统一服务计划卡、实验进度卡和右侧指标组的主面板高度，修正横向卡片不对齐的问题。
- 小屏下标题区自动纵向排列，避免按钮挤压标题文字。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘计划权益状态

- 服务计划权益从纯文本扩展为 `{ text, available }`，支持同一列表中展示可用和不可用能力。
- 可用能力显示蓝色对勾，不可用能力显示红色叉号。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘指标区修订

- 将四个指标卡移动到“快速提交实验报告”下方，并改为横向排列。
- “完成状态”指标根据实验进度自动显示“未完成”或“全部完成”；未完成使用黄色背景，全部完成使用绿色背景。
- 快速提交卡新增黄色感叹号提示文案。
- 最近任务操作统一为“查看”和“编辑”。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘提示位置修正

- 移除快速提交卡中的黄色提示文案。
- 将黄色感叹号提示改到 Plus 计划的“部分结构化内容辅助：根据公式计算数据与主观题生成式回答”权益项上。
- 四个指标卡进一步压缩高度，减少纵向占用。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

### Student 仪表盘计划描述修复

- 服务计划描述改为独立横跨整张卡片的一行，避免被“管理计划”按钮挤窄后提前换行或截断。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

## 2026-06-22

### 前端 UI 规范层起步

- 新增 `frontend/src/styles/theme.css` 和 `frontend/src/styles/ui.css`，沉淀 LabFlow 前端通用 token、黄金强调按钮、图标按钮、四项指标卡、状态标签、表格容器和规范页布局。
- 新增 `frontend/src/components/ui/` 下的 `GoldButton`、`PageHeading`、`StatCard`、`StatusBadge`、`TablePanel`、`UiPanel`，用于后续页面复用。
- 新增 admin 内部规范页 `/workspace/admin/design-system`，展示按钮、状态、四项指标卡和表格容器示例。
- 将 student 实验列表、实验详情和仪表盘中的部分按钮、状态标签、指标卡、最近任务表格切换到公共 UI 组件。
- 验证：在 `frontend/` 执行 `npm run build` 通过；启动 Vite dev server 后访问 `http://127.0.0.1:5173/workspace/admin/design-system` 返回 200。
- 遗留风险：旧 `workspace.css` 中仍有未清理的旧业务样式和重复样式；Vite 仍提示主 JS chunk 超过 500 kB，后续可按路由做 lazy loading。

### Workspace 旧样式清理

- 删除未挂载路由且仍使用 IgniteNow 短剧/剧集/高光语义的 `AnalyzePage.jsx`、`JobsPage.jsx`、`DashboardPage.jsx`。
- 清理 `workspace.css` 中已由 `ui.css` 接管的旧按钮、状态标签、指标卡、最近任务表格样式，以及旧内容管理、AI 生产、审核高光相关样式残留。
- `workspace.css` 从约 2955 行降至约 1946 行，前端 CSS 构建产物从约 70.63KB 降至约 56.24KB。
- 验证：在 `frontend/` 执行 `npm run build` 通过。
- 遗留风险：`LandingPage.jsx`、`landing.css` 和 `SettingsPage.jsx` 仍有旧 IgniteNow 文案或配置语义，后续需要单独替换为 LabFlow 语义。

### 控件规范补充

- 将 AntD 全局 `borderRadius` 调整为 8，并在 `ui.css` 中统一按钮、图标按钮、输入框、密码框、数字输入、Select、Picker、Upload Dragger 等控件的圆角、边框、hover 和 focus 样式。
- 将登录页、工作台侧栏、实验详情返回按钮、landing 页可点击按钮等处的圆形/胶囊按钮改为 8px 圆角矩形。
- 在 `/workspace/admin/design-system` 增加输入控件规范示例：文本输入、密码输入、数字输入、Select 和文本域。
- 验证：在 `frontend/` 执行 `npm run build` 通过。

## 2026-06-29

### 实验配置 V2 架构设计与前端详情页重构

- 确立“前端零业务逻辑、后端 DAG (有向无环图) 解析”的 V2 JSON 配置架构（解耦为 meta, inputs, ui, ai, automation 五大模块）。解决了跨域、连环推导和重复 DOM 定位的历史痛点。
- 重构 `StudentExperimentDetailPage.jsx`，按 V2 配置规范实现三大区域的严格映射：1. 基础参数填空区；2. 实验数据表格与逻辑图片插槽区 (Image Slots)；3. 思考题长文本区。同时结合 DebugRole 实现了严格的 Pro 权限按钮锁定。
- 更新 `workspace.css`，为不同数据来源的填空组件增加视觉状态区分（`is-computed` 绿色、`is-async` 紫色、`is-fixed` 灰色），并完善多图上传插槽样式。
- 新建 `experimentConfigStore.js`，移除了旧版的本地 `labCalculations.js` 物理推导逻辑，全面改写为调用后端通用接口获取更新字典（当前使用 Mock API）。
- 验证：重构组件编译通过；V2 配置模型下 UI 区域划分准确，图片插槽与表单联动正常；权限鉴权逻辑符合产品定义。
- 遗留风险：由于核心逻辑整体后移，FastAPI 后端针对该配置的统一 DAG 推导计算接口 (`POST /compute`) 及真正的 AI 图片识别接口尚未实现；Playwright 配合高级 Locator 的提交 Worker 也需进一步开发。

### 实验配置 V2 彻底迁移与 UI 规范收拢

- 完全移除旧版向下兼容的 `buildExperimentPreviewConfig` 以及对应的旧配置数据。
- 新增《电表的改装》(`exp_meter_modification`) 作为系统中唯一真实的 V2 全景配置数据源，保存在 `assets/v2_configs`。
- 将 Admin 侧的 `ExperimentConfigPage.jsx` 与 `AdminExperimentPreviewPage.jsx` 强制迁移至新 V2 Store。实验详情预览已彻底同步学生侧页面，并支持设置中心里的角色切换实时鉴权。
- 确立界面 UI 规范化（进行中）：将“实验仪器与基础参数”（优化输入框视觉）、“数据表格”、“图片工作台”三大核心板块沉淀至 `DesignSystemPage.jsx` 中，作为未来的全局 Single Source of Truth。
- 验证：点击“预览”或“编辑”能调起 100% 同步的 V2 界面。

## 2026-07-02

### 真实学校系统接入实施计划补齐

- 完成 `docs/implementation_plan.md`，从原有草案扩展为分阶段实施计划，覆盖 Playwright 自动化配置、验证码节点截图识别、学号即学校系统密码、学校系统同步、版本冲突选择、AI 结果持久化、临时保存 / 正式提交流水线、后台监控和安全红线。
- 明确建议新增的数据模型：`automation_engine_configs`、`automation_jobs`、`submission_versions`、`school_sync_snapshots`，并要求后续通过 Alembic migration 落地。
- 明确需要补进 `API_CONTRACT.md` 的接口范围：自动化配置、学校系统同步、版本选择、临时保存、正式提交和自动化任务查询。
- 验证：文档层检查已对齐 `产品技术规划.md`、`TASK_BREAKDOWN.md`、`STATE_MACHINE.md`、`API_CONTRACT.md`、`DECISIONS.md` 中的角色、状态、审计和自动化约束；本次未改代码，未运行构建。
- 遗留风险：计划中的 API、migration、Celery Worker、Playwright 登录测试和前端页面尚未实现，需要按计划的阶段 0 开始收口接口契约。

### 自动化配置计划修订

- 根据最新确认，`automation_engine_configs` 第一版改为 `config_json` 统一保存学校系统选择器和 Playwright 运行参数，Admin 通过 JSON 文本维护，不为每个选择器单独设计设置栏。
- 当时计划曾写成 `users.username` 是学号、`users.name` 是真实姓名；该表述已在后续“用户身份字段语义修正”中按真实 SQL 表结构修正为 `username` / `student_no` / `real_name` 三层语义。
- 从近期接口范围中移除 `POST /api/v1/admin/automation-config/test-login`，后续如需要再以 `validate-login` 形式做受控连通性检查；当前阶段不提前写具体 Playwright 脚本。
- 补充 Admin 自动化配置页 UI 要求：复用现有 `PageHeading`、`UiPanel`、Ant Design `Modal/Form/Input.TextArea/Button` 和控件规范，不新增自造弹窗框架。
- 验证：文档层检查确认 `test-login` 仅作为暂不实现说明出现；本次未改代码，未运行构建。

### 用户身份字段语义修正

- 核对后端 SQLModel 与初始 migration 后确认，当前 `users` 表只有 `username`，没有 `name` 字段；前一版计划中把 `users.name` 当作真实姓名字段不符合现状。
- 修正 `implementation_plan.md`、`DECISIONS.md` 和 `产品技术规划.md`：`username` 定义为平台登录账号，后续新增 `student_no` 表达学号，新增 `real_name` 表达学校系统同步到的真实姓名。
- 明确学校系统登录账号只使用 `student_no`；当时密码策略曾按学号派生，已在 2026-07-06 改为解密 `users.encrypted_school_password`。不兼容旧数据，必要时直接清表或重建数据库。
- 验证：已检查 `backend/models/core.py` 与 `backend/alembic/versions/27ff1475f5fd_initial_schema.py` 的 `users` 表结构；本次未改代码，未运行构建。

### 身份字段与自动化配置后端底座落地

- 更新 `backend/models/core.py`：新增 `users.student_no`、`users.real_name`，并新增 `AutomationEngineConfig`、`AutomationJob`、`SubmissionVersion`、`SchoolSyncSnapshot` 模型。
- 新增 Alembic migration `9f2a7c6d4b10_add_identity_and_automation_foundation.py`，创建身份字段和自动化底座表；不做旧数据回填。
- 新增 `GET/PATCH /api/v1/admin/automation-config`，仅 Admin 可读写自动化 JSON 配置，保存时校验顶层结构、禁止脚本字段，并写入 `audit_logs`。
- 调整学生登录和 Admin/Reviewer 代交建档逻辑：学生学号进入 `student_no`；学校系统登录后续只使用 `student_no`。
- 同步 `API_CONTRACT.md` 的用户字段、自动化配置接口和无 `test-login` 约束。
- 验证：`python -m compileall backend/models backend/api backend/main.py` 通过；`alembic upgrade head` 已应用到本地 PostgreSQL，当前 revision 为 `9f2a7c6d4b10 (head)`；`pytest tests/test_e2e_flow.py` 通过 4 项测试，覆盖支付流、套餐升级、Pro 提交和 Admin 自动化配置 API。

### Admin 设置页自动化配置 Tab

- 在 `SettingsPage.jsx` 的现有设置页中新开“自动化配置”Tab，不新增独立路由。
- 新增 `frontend/src/services/automationConfigApi.js`，对接 `GET/PATCH /api/v1/admin/automation-config`。
- 自动化配置以单个 JSON 文本区维护，支持本地 JSON 格式化和保存前 JSON 校验；保存按钮直接提交，不再弹出 Ant Design `Modal.confirm` 二次确认；未增加每个选择器的独立设置栏，也未写 Playwright 脚本。
- 样式仅补充 JSON 编辑器和按钮行，复用现有 Ant Design 输入控件与设置页 Tabs 结构。
- 验证：在 `frontend/` 执行 `npm run build` 通过；Vite 仍提示主 JS chunk 超过 500 kB，为既有构建体积风险。

### 学校系统 Playwright 登录探测脚本

- 新增 `backend/tools/school_portal_probe.py`，用于抓取学校报告系统登录页截图、HTML、DOM 摘要、验证码小图和登录后页面证据。
- 真实登录页字段已确认：用户名 `#userName`、密码 `#userPass`、验证码输入 `#checkCode`、验证码图片 `#imgCheckCode`、登录按钮 `.loginBut`。
- 脚本默认不提交登录；传入 `--attempt-login` 后必须显式传入 `--password`，若未获得验证码识别结果则停在提交前并清空账号密码。
- 验证码流程已预留 AI API：`--captcha-source ai` 会将验证码图片通过 OpenAI-compatible Chat Completions 发送给视觉模型，默认读取本地 AI Key 环境配置，不会把 API Key、学校密码或验证码文本写入报告。
- 使用调试验证码完成一次真实登录验证，登录成功落点为 `/ReportStudent/CompleteReport/`，页面标题为“完成报告”；脚本会等待登录后 loading 遮罩消失再截图。
- 采集产物示例：`backend/tmp/school_portal_probe/20260702_111636_26A****0207/`，包含登录页、验证码、登录后完成报告列表截图和 DOM 摘要。
- 验证：`backend/venv/bin/python -m py_compile backend/tools/school_portal_probe.py` 通过；真实页面采集成功；未触发报告进入、临时提交或正式提交。
- 遗留风险：当时环境未配置验证码 AI Key，因此 AI 验证码识别路径仅验证了缺 key 时会安全停止；后续需配置 key 后测试自动识别准确率和重试策略。

### 自动化配置生效化与轻量列表同步

- 将默认自动化配置改为真实学校系统配置，并使用 `_comment` 字段承载 JSON 注释；标准 JSON 不使用 `//` 注释。
- 自动化配置不兼容旧结构，当时以 `schema_version=1.1` 为准；后续已升级到 `1.2`，详见 2026-07-05 自动化等待策略配置升级记录。
- 默认 `runtime.headless=false`，Playwright 调试时会打开可视浏览器窗口；命令行仍可通过 `--headless` 临时覆盖。
- 新增 `runtime.userSessionIdleTtlSeconds`：值为 `0` 表示平台不主动关闭该用户浏览器会话，直到学校登录态自行失效或人工停止；大于 0 表示空闲超时关闭。
- `school_portal_probe.py` 支持读取配置中的学校入口、登录选择器、验证码 AI 参数、超时参数和列表列索引。
- 登录后已能读取 `#LoginUserName` 得到学生真实姓名，并从“完成报告”列表抽取轻量实验状态，当前只保留 `{ experimentName, status }`。
- 可选 `--save-snapshot-user-id` 会把真实姓名写入 `users.real_name`，并把 `{ experimentName, status }` 列表保存到 `school_sync_snapshots`；不新增课程、成绩、截止时间等字段。
- 将“正式提交”列入 `safety.forbiddenActions.finalSubmit` 禁点规则；后续按需打开报告 modal 只允许读取、截图和受控草稿验证，绝不点击正式提交。
- 真实验证结果：学号 `26A****0207` 登录后读取到真实姓名和 10 个实验，当前 10 个状态均为“未提交”。
- 验证：`backend/venv/bin/python -m py_compile backend/api/v1/automation_config.py backend/tools/school_portal_probe.py` 通过；真实登录探测报告 `backend/tmp/school_portal_probe/20260702_113637_26A****0207/probe_report.json` 包含 `schoolReportList` 和 `schoolReportSummary`。

### 8 个学生端实验 V2 配置接入与后端保存

- 新增 `tools/extract_student_experiment_configs.mjs`，从 `assets/complete_saves_student` 的真实保存页抽取填空、表格、图片和实验回答区。
- 新增 8 个 V2 配置：三线摆和扭摆、光电效应和普朗克常量、声速、液晶电光效应0625、电位差计、示波器、空气比热容比、落球法测粘滞系数。
- 补齐 `assets/complete_saves_student/钢丝杨氏模量的测定.html` 对应的 `exp_steel_wire_young_modulus` 后端配置和 13 张配置图片资源，当前按 `sortOrder=7` 接入实验列表。
- 生成配置只写入 `backend/configs`；新增 `backend/services/experiment_seed.py`，FastAPI 启动或实验 API 请求时 upsert 到 `experiments.config_json`。
- 前端实验列表、学生/审核员/管理员实验详情和 Prompt 节点选择均改为通过 `GET /api/v1/experiments`、`GET /api/v1/experiments/{id}` 从后端读取配置；`frontend/src/assets/configs` 不再保存实验 JSON。
- 新增 `PATCH /api/v1/submissions/{submission_id}/correction`，学生可保存自己的页面填空、表格值、实验回答和图片路径到 `submissions.corrected_json`，并写入审计日志。
- 学生实验详情页的“临时提交/正式提交”已接入后端保存；若当前实验尚无自助 submission，会先创建 `payment_status=not_required` 的自助 submission 再保存，不创建待支付订单。
- 验证：`node tools/extract_student_experiment_configs.mjs` 成功生成后端配置；`npm run build` 通过；`py_compile` 通过；`pytest tests/test_e2e_flow.py` 通过 4 项。
- 浏览器验证限制：Vite dev server 已以可见调试方式启动在 `http://127.0.0.1:5173/`，但本次运行环境没有可控的 in-app browser 或 Chrome 插件实例，因此未能由 Codex 直接点击页面截图；未使用 headless。

### 本地联调端口与缺失迁移修复

- 本地 `8000` 端口被其他进程占用且未能响应 HTTP，当前联调后端改为 `http://localhost:8001`，前端通过 `frontend/.env.local` 指向该 API 地址。
- 确认前端必须访问 Vite 地址 `http://localhost:5173/`；裸 `http://localhost` 会进入 Chrome 错误页，Network 中出现 `chrome-error://chromewebdata/` 发起的 `data:image` 请求不代表实验配置图片本身失败。
- 修复模型与 migration 不一致问题：新增 Alembic migration `e4c2d9a8b731_add_submission_image_paths.py`，为 `submissions` 增加 `image_paths JSONB`，避免 `/api/v1/submissions/my` 与 `/api/v1/submissions/review-pool` 因缺列返回 500。
- 验证：`alembic upgrade head` 已应用到本地 PostgreSQL；`GET /api/v1/experiments` 返回 200；`GET /api/v1/submissions/my` 返回 200 空数组；`GET /api/v1/submissions/review-pool` 返回 200 空数组。

### Admin 实验原始配置编辑入口

- 修复后端配置读取：`backend/core/config.py` 现在会读取仓库根目录 `.env`，避免已配置 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 时仍生成临时管理员密码。
- 新增 `GET/PATCH /api/v1/experiments/{id}/raw-config`，仅 Admin 可读写实验原始配置；保存时校验 JSON object、校验 `meta.id` 与路径参数一致，并拒绝前端传入任意文件路径。
- 保存实验原始配置会同时写回 `backend/configs/{id}.json` 与 `experiments.config_json`，并写入 `audit_logs`，审计详情记录文件名和保存前后 hash。
- 新增公共 `JsonConfigEditor`，自动化配置和实验原始配置共用同一套 JSON 编辑、格式化和保存交互；配置保存不再弹出二次确认框。
- 在 `AdminExperimentPreviewPage` 现有 Tab 栏最左侧新增“原始配置”Tab，不在实验列表页另造入口；保存后会刷新当前实验预览使用的配置。
- 同步 `API_CONTRACT.md` 和 `DECISIONS.md` 的接口契约与配置源文件决策。

### 实验配置手动刷新与更新时间语义

- 新增 `experiments.updated_at`、`experiments.config_file_mtime`、`experiments.config_hash`，区分配置内容变化时间和本地 JSON 文件修改时间。
- `seed_experiment_configs` 改为基于稳定 JSON hash 判断内容是否变化；hash 未变化时不更新 `updated_at`，只在需要时同步 `config_file_mtime`。
- 新增 `POST /api/v1/experiments/refresh-configs`，仅 Admin 可手动扫描 `backend/configs/*.json` 并同步数据库，返回 scanned/created/changed/unchanged/failed/changed_ids，并写入 `audit_logs(action=refresh_experiment_configs)`。
- 实验配置列表页右上角新增“刷新配置”按钮，复用规范页 `OutlineButton` 和刷新图标；点击前二次确认，成功后自动重载表格。
- 实验配置表格新增“配置更新时间”和“文件修改时间”两列，分别展示 `updated_at` 与 `config_file_mtime`。
- “计算规则配置”保存逻辑改为写回 `backend/configs/{id}.json` 的顶层 `formulas`，并同步 `experiments.config_json.formulas`，同时写入 `audit_logs(action=update_experiment_formulas)`。

### 实验顺序与学生端启用过滤

- 在 9 个 `backend/configs/*.json` 的 `meta` 中新增 `sortOrder` 和 `enabled`，当前默认全部启用，并按学生端预期顺序设置排序值。
- 删除 9 个实验配置中的 `meta.status`，避免把全局实验配置和学生个人提交状态混在一起；学生实验状态继续来自 `submissions`。
- 批量重排 9 个实验配置的顶层字段，保证 `meta` 位于文件最前面，并按 `id/name/version/sortOrder/enabled` 的顺序展示关键维护字段。
- `GET /api/v1/experiments` 改为按 `meta.sortOrder` 排序；学生角色只返回 `enabled !== false` 的实验，Admin / Reviewer 可看到全部实验。
- `GET /api/v1/experiments/{id}` 和实验计算接口对学生请求停用实验返回 `404`，避免学生绕过列表读取停用配置。
- 实验配置列表页新增“排序”和“状态”两列，复用 `StatusBadge` 展示启用/停用；学生实验页继续使用后端过滤后的实验列表，因此顺序和可见性与 Admin 配置一致。

### 公共 JSON 编辑器升级

- `JsonConfigEditor` 从 Ant Design 文本域升级为 Monaco Editor，支持 JSON 高亮、行号、折叠、括号配色、自动布局和更好的大文件阅读体验。
- `SettingsPage` 的自动化配置和 `AdminExperimentPreviewPage` 的实验原始配置继续共用同一个公共组件，因此两处 JSON 编辑体验同时生效。
- 新增持久化前端依赖 `@monaco-editor/react` 到 `frontend/package.json` 和 `frontend/package-lock.json`。
- Admin 实验预览页默认打开“原始配置”Tab；原始配置读取改为优先返回 `backend/configs/{id}.json` 文件内容，避免 PostgreSQL JSONB 打乱顶层 key 顺序导致 `meta` 不在最前面。

### 学生最近操作日志过滤

- `GET /api/v1/audit/my_logs` 改为只返回学生可理解的业务动作白名单；`save_submission_correction` 等内部审计动作仍写入 `audit_logs`，但不再返回给学生端。
- 学生仪表盘最近操作表对未知 action 做二次过滤和兜底展示，避免内部 action 名直接暴露到学生界面。

### 实验问题统一生成式回答

- 移除实验问题区每个问题旁边的单题生成按钮，改为在 `3. 实验分析与拓展` 标题栏右侧保留一个“一键生成并填入回答”按钮。
- `POST /api/v1/ai/generate-answer-direct` 的语义直接替换为批量生成：前端传入全部问题的 `index/nodeId/title` 和当前实验数据，后端一次性请求 AI，并按题号映射回对应 `nodeId`。
- 批量生成继续联动实验配置页的 Prompt 模板配置，后端按 `AiPromptTemplate -> 系统默认模板` 生成提示词；不再从前端传核心 prompt，实验 JSON 的 `ai` 只保留图片槽位和目标节点等结构绑定。
- Admin Prompt 模板配置页的“实验思考题生成 Prompt”预览改为直接使用当前实验配置里的真实问题列表，不再显示单题占位文本。
- 生成式回答 Prompt 中的“本次实验关键数据”改为只展示数据值，并以一行中文逗号分隔，不再暴露节点名。
- 生成式回答要求 AI 返回的原始 JSON 格式精简为 `{ "1": "...", "2": "..." }`，后端再转换为前端填表所需的 `index/nodeId/answer` 列表。
- 删除旧版 `{ "answers": [{ "index": 1, "answer": "" }] }` 数组格式兼容，避免后端继续接受过时结构。

### 实验配置详情节点可视化

- 在实验配置 adapter 中生成 `metaInfo.nodeMetaMap`，汇总节点名、类型、固定答案、公式、表格/段落/问题来源等信息。
- 新增后台配置详情专属节点提示层：Admin 实验配置详情的“实验预览”中，固定填空、实验数据表和实验分析问题可查看节点名、固定答案、公式和当前值。
- 节点提示只通过 `AdminExperimentPreviewPage -> ExperimentDetailView(showNodeInspector=true)` 启用，学生实验详情页和 reviewer 审核任务详情页不显示该后台配置辅助信息。
- 清理 `backend/configs/*.json` 中的 `label` 字段，节点元信息不再生成或 fallback 标签，后台节点浮层只展示节点名、类型、位置、固定答案、公式和当前值。
- 删除旧 `extract` 识别语义，后端识别、Prompt 预览和生成式回答附加数据节点统一只读取 `inputs.fields[].type = "ai_recognize"`。
- 电表改装配置中 `SYMD_Fill_0/1/2` 和 `SYYL_Fill_0` 改为 `fixed` 并临时填入固定答案，`DBGZ10-0` 到 `DBGZ10-7` 改为表格图像识别节点。
- 固定填空节点不再默认预填或设为只读；用户点击“一键填空”并通过套餐权限后，后端才下发 `fixed.value` 到输入框，且下发后仍可手动修改。
- 表格列显示文本改用 `text` 字段，不再复用已删除的节点 `label`；电表改装表头恢复为 `Rₓ（Ω）/200/400/.../8000`。
- 后端公式计算器新增线性拟合白名单函数；`exp_meter_modification.json` 的 `formulas` 已补齐 `DBGZ2/DBGZ3/DBGZ4` 的通用表达式。
- 电表改装拟合按 `Rₓ = k * (1/Iₓ) + b` 计算，`DBGZ2` 为斜率，`DBGZ3` 为 `-b`，`DBGZ4` 为 3 位有效数字的 `R²`。
- 将公式函数迁移到 `backend/services/experiment_formulas.py`；`experiments.py` 只注册通用函数。公式统一使用 `v()` 显式读取节点或常量，不再保留电表改装专用函数，也不从 `ui.dataTable.columns` 推断计算依赖。
- 公式计算不再静默吞掉缺失输入：后端对前置节点未填返回 `FORMULA_INPUT_INCOMPLETE` 和缺失节点列表，前端统一提示“填写不完整，无法计算”，并只高亮对应输入框，不向学生展示内部节点名或选择器。
- 公式计算缺失输入时，前端将对应输入框切换为红色错误态，并自动滚动到第一个缺失输入框，帮助学生快速补齐数据。

### 图片答案节点与落球法表格整理

- 新增 `image_upload` 节点渲染语义：实验配置可将某个 DOM 节点绑定到独立图片槽位，前端在段落位置显示专属上传卡，上传成功后把图片 URL 写回对应 `nodeId`。
- 学生详情页的主图片识别区只展示普通识别图片槽位；`purpose=answer_image` 或声明 `targetNodeId` 的槽位不再混入“一键识别并填表”的大图片区。
- 落球法测粘滞系数配置中，`L3Area` 改为“粘滞系数与温度关系曲线”的图片上传节点，并从生成式文本问题区移除。
- 落球法表格补齐 `温度（℃）/η（Pa·s）测量值` 表头和 30/33/36/39/40/42/44/46 行名，避免空 cell 导致页面左侧表格只剩输入框和截断节点标记。
- 抽出 `SingleImageUploadNode` 公共组件，后续单图片答案节点统一复用 `ExperimentImageUploader` 的上传、预览、缩放和删除能力。
- 液晶电光效应实验 `YSSJDrawingAreaArea`、`Y2Area` 改为图片上传节点，分别绑定签字原始数据照片和“平均透射率-电压”曲线截图；主识别图片区仍只使用 `IMG_RAW_DATA`。
- 液晶实验补齐 `Y1` 表格的电压行与透射率列名，并清理数据处理段落中的富文本工具栏乱码，避免预览页中图片上传节点被渲染成普通短输入框。
- 液晶实验新增 `Y5Area`、`Y7Area` 图片上传节点，分别绑定透光率下降/上升响应曲线照片，补齐学校系统后半段图片上传项的配置结构。

### 学校保存页抽取脚本数据处理区修复

- 重写 `tools/extract_student_experiment_configs.mjs` 的面板抽取逻辑，改为按成对 `div` 解析顶层 `panel` 和嵌套 `opAll/op` 数据处理区，避免富文本编辑器工具条、预览内容和真实节点混在一起。
- 抽取时会剥离 `wysiwyg-toolbar`、`wysiwyg-editor`、评分按钮和“请输入文本……”等学校编辑器噪声；`Area/DrawingArea/YSSJDrawing` 类 textarea 在数据处理区统一生成为 `image_upload` 节点和独立图片槽。
- `SYMD*`、`SYYL*` 节点统一生成 `fixed` 类型；脚本会保留已有配置里的非空 `formulas`、fixed 节点 `value` 和 `meta.enabled`，避免重生成时冲掉手工维护内容。
- 为保护已手工修好的前 4 个实验，脚本无参数时只生成序号 5 之后的实验；若显式传入前 4 个实验 ID 会拒绝执行，除非额外传入 `--allow-manual`。
- 已重生成序号 5 之后的实验配置：空气比热容比、三线摆和扭摆、钢丝杨氏模量、声速、电位差计、光电效应和普朗克常量。
- 验证：`node tools/extract_student_experiment_configs.mjs` 成功生成后半段配置；噪声扫描未发现富文本工具栏乱码；所有 `SYMD*` / `SYYL*` 节点均校验为 `fixed`。
- 示波器配置单独复核：`YSSJDrawingAreaArea` 改为绑定主识别图片槽 `IMG_RAW_DATA`，不再在数据处理区重复生成上传卡；数据处理区编号文本在编号前换行，保留 `（1.2）` 等小节号且不误切 `0、π/4`。
- 学生实验详情页左侧空表格文案改为“此实验无需填写表格。”；主识别图片区允许显示带 `targetNodeId` 的识别图片槽，上传后可回填到目标节点。
- 修复抽取脚本 token 正则误吞跨节点 HTML 的问题；示波器数据处理区已恢复 `S2Area/S6Area/S7Area/S8Area/S9Area/S10Area` 等图片上传节点，李萨如图形照片 1-5 的标题和节点映射重新生成到 `exp_oscilloscope.json`。
- 示波器图片上传节点标题进一步清理：控件标题只保留最近的小题标题，不再拼入大章节说明；上传卡空态改为通用上传提示，避免标题和卡片内部文案重复。
- 使用修复后的抽取脚本重新生成序号 5 之后的实验配置：空气比热容比、三线摆和扭摆、钢丝杨氏模量、声速、电位差计、光电效应和普朗克常量；后续配置通过 JSON 校验、富文本噪声扫描和 `SYMD/SYYL` fixed 类型校验。
- 修复后续实验表格抽取：生成器现在识别 `divtab*` 包裹表格和裸 `<table>`，避免空气比热容比等实验把整张表格抽成普通混排节点；已重新生成序号 5 之后配置并确认各实验 `ui.dataTables` 非空。
- 三线摆和扭摆实验数据处理区整理：生成器按 panel 标题合并同名 `postDataSections`，避免页面出现多个“数据处理”和多个“一键计算数据”按钮；选项题 `A/B/C/D` 与中文大标题自动换行，已仅重新生成序号 6 及之后配置。

### 学生实验列表固定视口布局

- 学生实验提交页在桌面端改为固定视口布局：标题和四个统计卡片固定在顶部占位，实验列表面板填满剩余屏幕高度，页面主体不滚动，只允许实验列表内部纵向滚动。
- 窄屏端保留自然页面滚动，避免手机上出现过小的内部滚动区域。

### 学校系统完整自动化流程计划

- 新增 `docs/SCHOOL_AUTOMATION_FLOW_PLAN.md`，整理平台登录后概览同步、单实验按需同步、临时/正式提交、自动化 job 状态机、前端进度弹窗、异常恢复和审计要求。
- 明确第一阶段只实现内网登录 `http://10.25.77.60:8001/Login`；校园 VPN、短信验证码、二维码和二次验证先记录为 `vpn_auth_required` / `manual_verification_required` 预留状态，不阻塞当前流程打通。
- 修正校园 VPN 认证语义：后续如启用 VPN 分支，应使用固定校园认证账号 `2410410114`，密码仅从安全配置或环境变量读取，不是学生账号，也不是当前平台操作者账号。
- 补充学校系统回填后的逐节点校验要求：所有平台侧有内容的文本、表格、图片节点都必须确认写入成功；若有遗漏或失败，停止提交、返回标准错误并写入自动化 job 和审计日志。
- 补充前后端标准化提示体系：后端使用稳定 `messageCode`，前端集中维护提示字典和通用同步/提交进度组件，避免提示文本散落在页面和 worker 中。
- 将校园 VPN 账号配置改为 `vpnUsernameEnv` / `vpnPasswordEnv`，账号和密码都从 `.env` 或部署环境变量读取，不在自动化配置 JSON 中硬编码具体账号。
- 补充学校系统操作等待策略：模拟点击、输入、上传和提交后优先等待 DOM/业务状态变化，固定等待只作为缓冲；新增 modal、字段、图片、提交反馈和列表刷新的超时错误码。
- 补充学校自动化后端安全边界：学生端只返回脱敏 public job 状态和标准提示码，不暴露选择器、脚本、验证码、密码、内部 payload、截图真实路径或排查 HTML。
- 补充重复提交和并发控制计划：后端通过幂等键、active job 查询、事务/唯一约束防止重复 automation；前端只做体验层防抖，刷新页面后应恢复已有 job 进度。
- 落地第一步自动化 job 安全查询底座：新增 `automation_jobs` public 字段迁移、后端标准消息码模块、`GET /api/v1/automation-jobs/{job_id}` 和 `GET /api/v1/automation-jobs/active`，学生端只返回脱敏状态和提示码。
- 新增 e2e 测试验证自动化 job 响应不会泄露 `request_payload`、`result_payload`、`sensitive_payload` 等内部信息；`backend/tests/test_e2e_flow.py` 全量通过。
- 前端新增 `automationMessages.js` 和 `automationJobsApi.js`，为后续 `AutomationProgressModal` 和同步提示组件提供统一文案渲染与 job 查询服务。
- 新增 `services/automation_job_service.py` 作为自动化 job 统一创建入口，提供幂等键生成、payload 指纹校验、active job 复用、同用户 active job 拦截和 public DTO 转换。
- 新增 active `idempotency_key` 的数据库 partial unique index，避免并发请求绕过后端检查创建重复 automation job；e2e 覆盖相同请求复用、payload 冲突和同用户重复任务拦截。
- 落地学校概览同步入口第一版：新增 `POST /api/v1/school-sync/overview`，当前仅创建或复用 `school_overview_sync` public job，不执行真实 Playwright 登录；同一学生重复点击复用运行中任务，已有其他 active automation job 时返回 `409 JOB_ALREADY_RUNNING`。
- 前端新增 `schoolSyncApi.js`，用于后续 Student 登录后自动同步和手动同步按钮复用；后端同步入口会记录创建、复用和拒绝审计日志，且不向前端暴露内部 payload。
- 修正学生详情页提交付费语义：临时保存 / 正式提交属于自助提交，创建 `payment_status=not_required` 的 self-managed submission，不再生成待支付订单；只有一键代写 / 一键提交图片交给后台处理时才走付费挂起订单。
- 接入临时 / 正式提交的学校自动化 job 壳：新增 `POST /api/v1/school-sync/experiments/{experiment_id}/submit`，前端保存平台数据后创建 `draft_submit` 或 `final_submit` job，并通过 `AutomationProgressModal` 阻塞展示标准步骤和轮询公开状态。
- 历史阶段为避免伪造学校提交结果，真实 Playwright 提交未接入时，submit job 曾保存 `platform_before_submit` 快照后以 `SCHOOL_SUBMIT_NOT_IMPLEMENTED` 失败退出；该占位壳已在后续“单实验读取与临时提交真实链路起步”中替换为真实临时提交 service。
- 落地第 4 节概览同步垂直切片：新增 `GET /api/v1/school-sync/overview/latest`，按 `syncPolicy.syncCooldownSeconds` 返回 `shouldSync`；学生仪表盘进入时自动检查并触发概览同步 stub，通知按钮左侧新增“同步状态”手动同步按钮，手动同步使用 `force=true` 忽略冷却。
- 补齐真实 Playwright 接入前的单实验同步壳：新增 `POST /api/v1/school-sync/experiments/{experiment_id}` 创建 `school_detail_sync` public job，当前写入空快照 stub；学生实验详情页进入时会触发该 job，并复用 `AutomationProgressModal` 展示同步步骤。
- 补齐刷新恢复和提交前快照：学生仪表盘 / 实验详情页会先查询 active automation job 并恢复进度弹窗；创建临时 / 正式提交 job 前写入 `submission_versions(source=platform_before_submit)`，便于学校系统失败后追踪平台侧提交数据。

### 学校概览同步真实 service 接入

- 新增 `backend/services/school_overview_sync.py`，将概览同步从 API 内部 stub 抽成后端 service：读取 Admin 自动化配置、探测内网登录 URL、使用 Playwright 打开学校登录页、按 `users.student_no` 填写账号、按当前密码策略填写学校密码、截图验证码并调用 OpenAI-compatible 视觉模型识别、读取右上角真实姓名和完成报告列表。
- `POST /api/v1/school-sync/overview` 已切换为调用真实概览同步 service；真实链路失败时 job 进入 `failed` 并写入 `error_code`、脱敏 public message 和 `school_overview_sync_failed` 审计日志，不再把概览同步伪装成 stub 成功。
- 同步成功时写入 `school_sync_snapshots.snapshot_json`，实验列表项统一保存 `experimentName`、`originalStatusText`、`schoolStatus`；`summary_json.source` 改为 `school_complete_report_list`，并统计未提交、临时提交、正常提交和未知状态。
- 后端 `core/messages.py` 补齐 `school.overview.connecting/openingLogin/recognizingCaptcha/loggingIn/readingList/savingSnapshot` 标准提示码，以及概览同步常见错误码到 `school.overview.failed` 的映射。
- 更新 e2e：概览同步测试通过 monkeypatch 注入快速成功 service，避免本地测试依赖校园网、Playwright 可视环境或验证码 AI Key，同时继续验证 public job 脱敏、快照和审计。
- 验证：`backend/venv/bin/python -m compileall backend/api/v1/school_sync.py backend/services/school_overview_sync.py backend/core/messages.py backend/tests/test_e2e_flow.py` 通过；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 13 项。
- 遗留风险：当前真实概览同步尚未在本机配置验证码 AI Key 与内网环境后跑通端到端；单实验按需同步、回填校验、临时 / 正式提交仍是 stub。

### 验证码 AI 配置通用化

- 将全站 AI 配置收敛为通用 OpenAI-compatible 命名：`.env` 仅保留 `AI_API_KEY` 真实密钥，以及 `AI_PROVIDER`、`AI_BASE_URL`、`AI_DEFAULT_MODEL`、`AI_IMAGE_RECOGNITION_MODEL`、`AI_ANSWER_GENERATION_MODEL`、`AI_CAPTCHA_MODEL` 作为首次建库种子。
- `.env` 和 `.env.example` 已移除温度、超时、最大图片数、自动识别开关和验证码 prompt 等运行期业务配置；这些字段以 `ai_config` 数据库记录为准，由 Admin 设置页读写。
- `default_automation_config()` 的 `captcha` 不再复制 AI 模型细节，只保留 `task=captcha`；`school_overview_sync.py` 通过统一 AI provider 读取 `AI_API_KEY` 和 DB profile，不保留旧 key 名兼容和 fallback model。
- 新增 `backend/services/ai_provider.py` 作为唯一 AI 运行边界，图片识别、实验问题生成和学校验证码识别均通过 task profile 调用，不再各自拼接 OpenAI-compatible 请求。
- Admin AI 设置页移除“降级备用模型”；`ai_config` 通过 migration 重建为非密钥 profile 表，后端模型和运行时均不再使用 fallback。
- AI 配置最终采用分层架构：`AI_API_KEY` 只从 `.env` / 进程环境变量读取；`ai_config` 表只保存 Base URL、模型、温度、超时、自动识别等非密钥业务配置，Admin 设置页可查看、修改并测试连通性。
- 新增 migration `7d8e9f101112_rework_ai_config_as_non_secret_profiles.py`，将旧 `ai_config` 重建为非密钥 profile 表，不再保存 `api_key_encrypted`。
- 验证：`backend/venv/bin/python -m compileall backend/core/config.py backend/api/v1/automation_config.py backend/api/v1/ai.py backend/models/core.py backend/services/ai_provider.py backend/services/ai_service.py backend/services/school_overview_sync.py backend/tools/school_portal_probe.py` 通过；`cd backend && venv/bin/alembic upgrade head` 已应用；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 14 项；`frontend/` 下 `npm run build` 通过。

### 硅基流动视觉模型配置

- `.env` 与 `.env.example` 的 `AI_BASE_URL` 切换为硅基流动 OpenAI-compatible 入口 `https://api.siliconflow.cn/v1`。
- `AI_IMAGE_RECOGNITION_MODEL` 改为 `deepseek-ai/DeepSeek-OCR`，用于实验报告图片 OCR；`AI_CAPTCHA_MODEL` 改为 `zai-org/GLM-4.5V`，用于学校验证码识别；`AI_DEFAULT_MODEL` 与 `AI_ANSWER_GENERATION_MODEL` 改为 `deepseek-ai/DeepSeek-V4-Flash`，用于默认文本能力和实验问题回答生成。
- 明确当前读取顺序：`AI_API_KEY` 始终来自 `.env` / 进程环境变量；非密钥运行配置优先来自 `ai_config`，只有数据库记录不存在时才使用 `.env` 中的模型种子创建初始记录。
- 已用 `HQUG` 验证码样本实测：`deepseek-ai/DeepSeek-OCR` 稳定误读为 `Hajig`，`zai-org/GLM-4.5V` 能正确识别为 `HQUG`；验证码 Prompt 更新为 `OCR this captcha. Return exactly one token: the 4-character uppercase code.`。

### 学校同步状态规则整理

- 概览同步冷却时间调整为 30 分钟：默认 `syncPolicy.syncCooldownSeconds=1800`，后端无配置时也按 1800 秒兜底。
- 提交后的状态确认以学校系统为最终事实来源：临时 / 正式提交 job 必须在同一浏览器会话内读取学校反馈或列表状态，保存 `school_sync_snapshots` 后再更新平台 `Submission.status`。
- 平台不能仅凭“已点击提交按钮”判断提交成功；真实 submit job 必须先等待学校提交反馈，再返回完成报告列表读取对应实验状态。例行概览同步负责刷新整体列表，但不替代提交 job 的即时学校状态确认。

### 学校登录验证码与错误弹窗处理

- 概览同步登录状态机补充分支：点击学校登录按钮后先进入 `school.overview.checkingLogin`，只有检测到真实姓名、实验列表或离开登录页后才进入 `school.overview.readingList`。
- 验证码 OCR 候选值必须匹配必填配置 `captcha.expectedLength`，当前配置为 4 位；AI 返回 3 位、5 位或无法提取 4 位候选值时，不再填入学校系统，直接刷新验证码并重试。
- 去掉验证码登录链路的兼容性保留：不再写旧的 `captcha_image` artifact 字段；缺少 `captcha.expectedLength` 或验证码 Prompt 时直接报 `CONFIG_INVALID`。
- 接入学校 Bootbox 错误弹窗识别：读取 `.bootbox.modal.in .bootbox-body` / `.bootbox-body` 等可见错误节点，遇到 `登录失败，验证码不正确!` 会保存失败截图、HTML 和错误文本，关闭弹窗后重试验证码。
- 验证码 AI 调用 `max_tokens` 从 16 调整为 64，用于排除输出被过短上限截断的可能；仍通过候选值解析确保只提交 4 位验证码。
- 新增前后端标准提示 `school.overview.retryingCaptcha`，文案为“验证码校验失败，正在重新识别并重试...”，避免验证码错误时前端误显示“正在读取完成报告列表”。
- 移除概览登录重试中的验证码图片点击刷新动作；失败重试只重新截图识别当前页面验证码，避免页面验证码被提前刷新导致 OCR 结果和实际提交验证码错位。
- 修复概览同步进度回跳：学生仪表盘的概览同步步骤表保留主流程步骤，`school.overview.retryingCaptcha` 通过 `stepAliases` 映射到 `school.overview.recognizingCaptcha`，只作为顶部当前提示展示，不再作为独立步骤占用步骤条。
- 修复概览同步成功后浏览器被关闭：`school_overview_sync.py` 现在显式读取必填 `runtime.keepBrowserOpenAfterLogin`；为 `true` 时成功同步后保留 Playwright 浏览器窗口，不执行 `context.close()` / `browser.close()`。
- 学生仪表盘同步按钮左侧新增绿色“上次同步时间”，格式固定为 `YYYY-MM-DD HH:mm:ss（北京时间 UTC+8）`；进入页面、同步成功和关闭同步弹窗时都会刷新 `overview/latest`。
- 学校概览同步成功后前端会重新拉取 `GET /api/v1/auth/me`，用 `users.real_name` 更新顶部问候；后端读取 `#LoginUserName` 时增加短等待，降低学校页面异步渲染导致姓名未写入数据库的概率。

### 单实验读取与临时提交真实链路起步

- 将成功概览同步后的 Playwright 浏览器会话同时保存为用户级 key（`user:{user_id}`），后续单实验同步和提交可复用同一学校登录态；旧的 job key 仍作为后台 artifact 关联保留。
- 新增 `backend/services/school_report_sync.py`，把单实验 modal 打开、字段读取、平台数据回填、逐字段校验、临时提交、提交反馈等待、返回完成报告列表和状态回读从 API 路由中拆出为 service。
- `POST /api/v1/school-sync/experiments/{experiment_id}` 已从 `_run_detail_stub` 切换为真实 service：返回学校列表，按实验名点击“完成报告”，读取 `#ReportModal` 字段、保存 modal 截图和 HTML 到后台 artifact，并写入 `school_sync_snapshots(source=school_report_modal)`；失败时不再写 stub 快照。
- `POST /api/v1/school-sync/experiments/{experiment_id}/submit` 已从 `SCHOOL_SUBMIT_NOT_IMPLEMENTED` 壳切换为临时提交真实链路：保存 `platform_before_submit` 后打开学校 modal，按实验配置 `automation.mappings` 将 `corrected_json.values` 写入学校 DOM 并校验，校验失败返回 `FIELD_WRITE_VERIFY_FAILED` 且不点击提交。
- 临时提交会点击学校系统“临时提交”，等待学校反馈，关闭 modal / 返回完成报告主列表，读取对应实验状态；只有回读为 `school_draft_submitted` 才更新平台 `Submission.status=draft_submitted` 并保存 `school_sync_snapshots(source=school_submit_confirmed)`。
- 正式提交仍未开放，后端会以 `FINAL_SUBMIT_DISABLED` 失败退出，避免在未完成二次确认和真实状态验证前触发高风险动作。
- 更新 e2e：移除单实验同步 stub 成功断言，测试改为 monkeypatch 外部学校执行函数，验证 public job 脱敏、失败不写 stub snapshot、提交失败时保留 `platform_before_submit` 且不确认平台状态。
- 验证：`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m py_compile backend/services/school_report_sync.py backend/services/school_overview_sync.py backend/api/v1/school_sync.py backend/tests/test_e2e_flow.py` 通过；`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 16 项。
- 遗留风险：尚未在真实学校 modal 上逐实验验证所有 `automation.mappings`；当前回填覆盖普通 input / textarea / select / contenteditable 文本节点，图片上传、富文本编辑器特殊 API、表格组件异步写入仍需用真实页面 artifact 继续补齐。

### 学校概览失败诊断 payload

- 修复学校概览失败审计信息过少的问题：`school_overview_sync_failed.details` 现在写入脱敏 JSON 诊断 payload，包含 job、错误码、失败阶段、底层异常消息、请求来源、学校系统 URL 摘要、网络策略、运行超时、重试策略和验证码长度配置。
- `automation_jobs.result_payload.diagnosticPayload` 同步保存同一份诊断数据，方便后台排查 `NETWORK_UNREACHABLE`、选择器变化、登录超时等问题。
- 网络探测异常消息从单纯 `str(exc)` 改为 `ExceptionType: message`，例如 `TimeoutError: timed out` 或 `URLError: ...`，便于区分 DNS、拒绝连接、超时和沙箱/系统网络阻断。
- Admin 操作日志详情弹窗现在会自动 pretty print JSON details，非 JSON details 保持原样。
- 验证：`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m py_compile backend/services/school_overview_sync.py backend/tests/test_e2e_flow.py` 通过；`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 17 项。

### 学校浏览器会话管理器

- 新增 `backend/services/school_session_manager.py`，统一管理 `user_id -> SchoolBrowserSession`，记录 Playwright、browser、context、page、创建 job、创建时间、最后使用时间、状态和最近诊断。
- 概览同步成功后不再写散落的 `KEPT_BROWSER_SESSIONS` 字典，而是通过 session manager 注册用户级会话；保留 `get_kept_school_session()` 包装仅用于兼容已有调用。
- 单实验同步和临时提交改为通过 session manager 获取学校页面：如果仪表盘概览同步留下的窗口仍在且未回到登录页，就直接复用；复用前会尝试关闭残留 modal / bootbox 并恢复到完成报告主列表。
- 若窗口不存在、page 已关闭、停留在登录页或恢复主列表失败，后端会关闭旧会话并重新登录；重新登录后仍无法恢复主列表时失败为 `SCHOOL_SESSION_UNAVAILABLE`。
- detail / submit job 的后台 `automation_jobs.result_payload.sessionDiagnostic` 记录会话状态和决策，例如 `reused_existing_session`、`existing_session_recovery_failed`、`relogin_created_session`，用于排查是否复用了概览窗口。
- 验证：`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m py_compile backend/services/school_session_manager.py backend/services/school_overview_sync.py backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 18 项。

### 自动化任务终止与浏览器关闭恢复

- 新增 `POST /api/v1/automation-jobs/{job_id}/cancel`，仅 Admin 可主动终止 active automation job；后端将任务标记为 `failed`，`error_code=JOB_CANCELLED`，并在关联 submission 时将 submission 置为 `error`，避免页面长期显示提交中。
- 学生侧 `AutomationProgressModal` 不提供终止按钮；任务卡死时由管理员在后台调用 cancel 接口处理，防止学生误中断真实学校系统操作。
- `GET /api/v1/automation-jobs/{job_id}` 轮询学校自动化任务时会诊断用户学校浏览器会话；若检测到 page 已关闭，自动将 job 标记为 `failed`，错误码 `SCHOOL_BROWSER_CLOSED`，原因“学校系统浏览器窗口已关闭”。
- 后台任务写入成功状态前会再次检查 job 是否仍处于 active 状态；如果管理员已手动终止，不会被后续后台结果覆盖回 succeeded。
- 验证：`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m py_compile backend/api/v1/automation_jobs.py backend/services/school_overview_sync.py backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`env PYTHONPYCACHEPREFIX=/Users/baibai/vscode/Lab-P/.pycache_check backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 20 项；`frontend/` 下 `npm run build` 通过。

## 2026-07-05

### 概览同步后用户名刷新修复

- 修复学生首次登录并成功同步学校概览后，前端问候用户名可能仍显示登录账号的问题。
- `POST /api/v1/auth/login` 响应补齐 `username`、`student_no`、`real_name`，前端不再把登录输入框内容当作后端身份信息。
- 前端缓存拆分为真实姓名、学号和平台账号；姓名只使用 `real_name`，缺失时显示“姓名未同步”，不再用 `student_no` 或 `username` 兜底伪装成姓名。
- `StudentDashboardPage` 刷新 `/auth/me` 后同步更新真实姓名和学号；侧栏、仪表盘和 reviewer 任务列表严格区分姓名与学号。
- 更新 e2e 覆盖学生登录响应与 `/auth/me` 的同步身份字段。

### 学校 DOM 读写稳定层

- 新增 `backend/services/school_dom.py`，封装学校系统页面的通用等待与回读能力：等待选择器数量稳定、等待配置选择器文本非空、读取控件值、写入后持续回读直到匹配。
- 概览同步登录后新增 overview ready gate：先等网络 / loading 结束，再等待 `selectors.dashboard.realNameText` 非空和 `selectors.dashboard.reportTableRows` 行文本出现并稳定，之后才读取真实姓名和实验列表。
- 概览同步的 ready gate 与最终抽取合并为同一段 DOM evaluate，避免“等待逻辑看到数据、随后另一套提取逻辑又读空”的不一致；失败诊断现在记录配置 selector、姓名节点文本、行数和前三行文本。
- 概览同步不再允许仅凭 URL 离开 `/Login` 就标记成功；姓名或实验列表未稳定读取时进入失败诊断，不写入空成功快照。
- 临时提交回填字段改为写入后按 `waitPolicy.fieldWriteTimeoutMs` 持续回读校验，不再只在填完后立即读一次。
- 更新 `SCHOOL_AUTOMATION_FLOW_PLAN.md`：新增 DOM 读写稳定机制要求，明确不得靠固定 sleep 或页面文案猜测关键状态。

### 自动化配置测试污染修复

- 修复 `test_admin_automation_config` 将默认学校系统地址持久改成 `https://school.example.edu` 的问题；测试现在只修改运行参数并在 `finally` 中恢复 `default_automation_config()`。
- 已将本地数据库 `automation_engine_configs.default.config_json.schoolSystem` 恢复为内网地址：`baseUrl=http://10.25.77.60:8001`，`loginUrl=http://10.25.77.60:8001/Login`。
- 验证：`py_compile backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py::test_admin_automation_config -q` 通过；测试后再次查询数据库确认地址仍为内网地址。

### 自动化等待策略配置升级

- 将自动化配置 schema 升级到 `1.2`，`networkPolicy` 和 `waitPolicy` 改为必填顶层配置；默认配置补齐直连内网探测、网络静默等待、modal 打开、字段写入、提交反馈、列表刷新、概览稳定时间和轮询间隔。
- 概览同步读取姓名和实验列表时不再复用 `runtime.postLoginWaitMs` 作为数据稳定窗口，改为使用 `waitPolicy.listRefreshTimeoutMs`，并通过 `waitPolicy.overviewStableMs` / `waitPolicy.overviewPollMs` 控制 DOM 快照连续稳定时间和轮询间隔。
- 概览失败诊断 payload 和 artifact 现在输出 `waitPolicy`，便于从 job JSON 直接确认本次真实生效的等待参数。

### 学校 Playwright 会话事件循环复用修复

- 修复概览同步保留了 `user:{user_id}` 浏览器会话但单实验同步仍重新登录的问题：原实现用 `asyncio.run()` 执行每个后台任务，概览同步创建的 Playwright page 会被保存在已关闭的事件循环上，后续单实验同步在新事件循环中操作旧 page 会恢复失败并触发重登。
- `SchoolSessionManager` 新增专用常驻事件循环线程，概览同步、单实验读取和临时/正式提交都通过同一个 loop 执行学校页面操作；只有诊断确认没有有效 page、page 已关闭、停留在登录页或恢复完成报告列表失败时才重新登录。
- 轮询 automation job 时的学校浏览器关闭诊断也切换到同一会话 loop，避免诊断本身跨 loop 操作 Playwright 对象。
- 不再保留 job-id 到浏览器会话的旧兼容索引；学校浏览器会话统一以 `user_id` 为唯一运行期 key。替换同一用户会话时由 session manager 关闭旧 Playwright 资源。
- FastAPI lifespan 关闭时会调用 session manager shutdown，统一关闭学校浏览器、Playwright runtime 和常驻事件循环，避免 reload / 退出时遗留后台资源。
- 验证：`py_compile backend/services/school_session_manager.py backend/services/school_overview_sync.py backend/services/school_report_sync.py backend/api/v1/automation_jobs.py backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 24 项。

### 前端身份缓存即时刷新

- 修复学校概览同步成功后仪表盘大标题已显示真实姓名，但 Workspace 布局侧栏仍显示“姓名未同步”，必须刷新页面才更新的问题。
- `frontend/src/auth.js` 新增身份缓存变更事件；`WorkspaceLayout` 订阅该事件后在 `saveAdminUserName` / `saveAdminStudentNo` 更新 localStorage 时立即重渲染。
- 验证：`frontend/` 下 `npm run build` 通过。

### 学校会话状态识别与恢复

- `SchoolSessionManager` 新增学校页面状态识别：`missing`、`closed`、`login_page`、`report_list`、`report_modal`、`bootbox_dialog`、`loading`、`unknown`。
- 新增 `ensure_report_list()` 统一恢复入口：已有会话停在实验 modal / bootbox / loading / unknown 页面时，先关闭弹窗或跳回完成报告主列表，再继续概览同步、单实验读取或提交；只有缺会话、page 关闭、登录页或恢复失败时才重新登录。
- 概览同步现在优先复用现有学校会话并恢复到 `report_list` 后读取姓名和实验列表，不再因为当前打开实验 modal 就直接新开浏览器重新登录。
- 单实验读取和提交的 `get_or_login_school_page()` 改为走同一恢复入口，打开下一个实验前会先恢复主列表。
- 同一 `user_id` 的学校自动化操作新增用户级 async lock，概览同步、单实验读取和提交串行操作同一个 Playwright page，避免交叉操作互相打断。
- 增加 e2e 覆盖：会话停在 `#ReportModal` 时，session manager 能关闭 modal 并恢复到完成报告主列表。
- 验证：`py_compile backend/services/school_session_manager.py backend/services/school_overview_sync.py backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 25 项。

### 学校提交与状态拆分计划

- 新增 `docs/SCHOOL_SUBMIT_AND_STATUS_PLAN.md`，整理临时提交时复用当前报告 modal、识别学校 bootbox “提交成功!”反馈、按 `submitAccepted` 和 `statusConfirmation` 分层判定提交结果的后续实现规则。
- 明确学生实验列表后续应将单一“状态”拆为“学校提交状态”和“平台处理状态”：前者来自学校系统完成报告列表，后者来自平台 submission / automation job 流程，两者不互相覆盖。
- 在 `SCHOOL_AUTOMATION_FLOW_PLAN.md` 的提交章节增加引用，后续实现提交状态判定和前端列表展示时以该计划为补充约束。
- 补充现有学校状态映射来源：后端已有 `map_school_status(raw_status)`，当前映射为“未提交 / 临时提交 / 正常提交 / 未知文本”，后续文档和实现不得另起一套学校状态枚举；“未完成”属于平台 `STATUS_META.incomplete` 展示文案，不是学校系统状态。
- 调整临时提交目标流程：提交不再固定从重新登录开始，而是先获取用户级学校会话并识别 `report_modal` / `report_list` / `bootbox_dialog` / `loading` 等状态，只有会话缺失、关闭、登录页或恢复失败时才重新登录。
- 补充前端提交进度面板展示规则：`AutomationProgressModal` 只展示保存数据、准备学校会话、打开报告、回填、校验、提交、确认反馈、同步状态、更新平台状态等稳定业务步骤；后端内部的 modal 复用、bootbox 关闭、页面恢复和必要时登录不逐项暴露给用户。
- 同步 `SCHOOL_AUTOMATION_FLOW_PLAN.md` 的提交提示文案：`school.submit.connecting` 改为“正在准备学校系统会话...”，提交后列表恢复和状态读取在前端合并为“正在同步学校提交状态...”。
- 补充同步进度面板展示规则：概览同步面板展示准备会话、识别验证码、确认登录、读取完成报告列表、保存学校状态；单实验同步面板展示准备会话、打开实验报告、读取已有填写内容、保存实验填写快照。同步成功只表示读取完成，不表示写入或提交学校系统。
- 后端提交链路按计划落地第一步：打开报告前先识别并复用当前目标实验 modal；学校返回明确“提交成功!”时记录 `submitAccepted=true`，即使列表状态暂未确认也可按 `statusConfirmation=feedback_only` 成功落库。
- 学生端自动化进度文案和步骤按计划更新：同步和提交都展示“准备学校系统会话”，提交后列表恢复与状态读取合并为“同步学校提交状态”。
- `GET /api/v1/school-sync/overview/latest` 增加 `experiments` 学校状态数组，学生实验列表拆为“学校提交状态”和“平台处理状态”两列，学校状态不覆盖平台状态。
- 验证：`py_compile` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 26 项；`frontend/` 下 `npm run build` 通过。
- 正式提交后端链路改为复用临时提交的同一管线，只切换 `selectors.modal.submitFinal` 和 `school_final_submitted` 确认规则；成功后平台 submission 更新为 `completed`。
- 学生端正式提交按钮先进入二次确认弹窗，但确认按钮保持禁用，当前不会从前端触发真实正式提交。
- 验证：`py_compile backend/api/v1/automation_config.py backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；提交相关 3 个用例通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 27 项；`frontend/` 下 `npm run build` 通过；`git diff --check` 通过。
- 修正学校完成报告列表实验名列配置：`selectors.reportList.columns.experimentName` 从第 3 列 `LabName` 改为第 1 列 `PaperName`，避免 `液晶电光效应实验0625` 这类报告名因批次后缀只存在于 `PaperName` 而被前端显示为“未同步”。自动化配置 schema 升级为 `1.3`，运行时遇到旧 schema 时直接使用新版默认配置。
- 修复单实验同步成功后没有回填平台表单的问题：后端保存学校 modal 快照时新增按 `automation.mappings` 反向映射得到的 `formValues`，新增 `GET /api/v1/school-sync/experiments/{experiment_id}/latest` 返回当前学生自己的最新单实验快照；前端在 `school_detail_sync` 成功后拉取该快照并将非空 `formValues` 合并到当前页面。

## 2026-07-06

### 学校字段 targetType 写入策略计划

- 根据真实提交失败诊断，确认实验问题节点 `#skt0Area` 是隐藏 textarea + 可见 WYSIWYG 编辑器结构，普通 `Locator.fill()` 会因元素不可见超时，不能再按普通 textarea 处理。
- 在 `docs/SCHOOL_SUBMIT_AND_STATUS_PLAN.md` 补充 `automation.mappings[].targetType` 计划：缺省为 `text`，只对特殊学校控件显式配置 `wysiwyg_text` 或 `wysiwyg_image`。
- 明确 `targetType` 是学校 DOM 写入策略，不是平台业务节点类型；平台仍可继续使用 `generated`、`image_upload` 等类型表达数据来源和表单语义。
- 明确 WYSIWYG 文本写入应定位同一富文本容器的 `.wysiwyg-editor`，写入安全 HTML，同步隐藏 textarea，并触发 `input/change/blur` 后回读校验。
- 明确 WYSIWYG 图片写入应点击学校工具栏“插入图片”，等待 popup 内 `input[type=file]`，通过 Playwright 上传平台图片对应的本地文件，并确认 editor 内出现图片；当前默认上传前清空旧图片。
- 同步 `docs/API_CONTRACT.md`：实验配置契约记录 `targetType=text | wysiwyg_text | wysiwyg_image`，提交接口要求提交前生成字段写入报告，遇到 `failedFields` 或 `unsupportedFields` 必须阻断学校提交。
- 新增 `docs/SCHOOL_WYSIWYG_FIELD_WRITE_PLAN.md`，基于截图中真实 DOM 记录图片工具栏、透明 file input、上传后 `img src="data:image/png;base64,..."`、文本 editor 写入形态，并拆出诊断、`wysiwyg_text`、`wysiwyg_image` 和真实提交验证顺序。
- 补充映射原则：提交主映射必须以 `automation.mappings[]` 为准，推荐 `sourceId` 对齐学校节点 id、`targetLocator=#节点id`；平台 `inputs.fields[].id` 或 `inputs.images[].targetNodeId` 只说明页面展示和图片槽绑定，不等于学校提交 mapping。后续先做 mapping audit，列出平台字段、提交 mapping 和学校 DOM 三列关系。
- 后端提交回填新增 `targetType` 分派：缺省 `text` 保持普通写入，`wysiwyg_text` 写入同字段 `.wysiwyg-editor` 并同步隐藏 textarea，`wysiwyg_image` 点击同 container 的“插入图片”按钮后通过 popup `input[type=file]` 上传本地图片。
- 提交前新增 mapping audit / field write report：记录平台字段、`automation.mappings`、学校 DOM 节点关系；平台有值但缺提交 mapping、隐藏 WYSIWYG textarea 仍按 `text`、WYSIWYG 写入失败都会在点击学校提交按钮前阻断。
- 失败落库改进：字段写入失败时 `automation_jobs.result_payload.fieldWriteReport` 保存脱敏报告，audit details 记录节点摘要，不再只能看到 `SCHOOL_SUBMIT_UNKNOWN_ERROR`。
- 单实验同步回读也按 `targetType` 读取；`wysiwyg_text` 回读 editor 可见文本，`wysiwyg_image` 回读当前 editor 图片 `src`。
- `exp_meter_modification` 的 `skt0Area` 提交 mapping 已标记为 `targetType=wysiwyg_text`。
- 验证：`py_compile backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 32 项。
- 遗留风险：`wysiwyg_image` 已实现上传路径，但尚未在真实学校页面验证；除电表实验外，大多数实验仍缺完整 `automation.mappings`，后续应先跑 mapping audit 再逐实验补配置，不能靠 class 或标题自动猜。
- 提交失败日志增强：`SUBMIT_REJECTED_BY_SCHOOL`、反馈超时和字段写入失败现在会把学校反馈文本、`fieldWriteReport`、提交前 / 失败时 artifact、打开报告摘要写入 `automation_jobs.result_payload`；`audit_logs.details` 改为结构化 JSON，包含错误码、阶段、反馈、字段写入摘要和 artifact 路径，便于后台直接排查。
- 验证：`py_compile backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 33 项。
- 根据真实成功节点截图修正计划：学校提交成功反馈应只读取新出现的 `.bootbox.modal.bootbox-alert.in .bootbox-body`，文本为 `提交成功!`；不得扫描 `#ReportModal .modal-body` 或整篇实验报告正文，否则会因为正文里的“连线错误”等教学文本误判为 `SUBMIT_REJECTED_BY_SCHOOL`。本条已写入 `docs/SCHOOL_SUBMIT_AND_STATUS_PLAN.md`，代码实现仍待跟进。
- 提交反馈误判修复已落地：`_click_submit_and_wait_feedback()` 现在只读取可见 bootbox alert 的 `.bootbox-body`，不再扫描 `.modal-body`、报告正文、上传弹窗或上传进度；新增测试覆盖“只读取 bootbox alert body”的行为。
- 验证：`py_compile backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 34 项。
- 根据最新 `SUBMIT_FEEDBACK_TIMEOUT` 现象补充计划：点击提交后应先短暂 settle，再轮询可见 `.bootbox .bootbox-body` 到文本稳定；超时时必须输出 bootbox 候选、可见 modal、上传 popup、上传进度、当前 URL 和 artifact，不再只给“未收到学校系统提交反馈”的笼统提示。
- 根据最新图片未上传现象补充计划：如果 `fieldWriteReport` 中没有任何 `wysiwyg_image` 字段，优先判定为平台图片槽、`inputs.fields`、提交值和 `automation.mappings` 没对上，writer 未执行；电表“签字原始数据上传”需要补 `image_upload` 节点、图片槽 `targetNodeId` 和 `targetType=wysiwyg_image` mapping，并在图片写入阶段记录本地文件解析、toolbar、popup、file input、上传 modal、进度和 editor img 前后数量。
- 修复电表实验图片节点配置缺口：`exp_meter_modification` 的 `IMG_RAW_DATA` 增加 `targetNodeId=YSSJDrawingAreaArea`，`inputs.fields` 增加 `YSSJDrawingAreaArea(image_upload)`，`automation.mappings` 增加 `YSSJDrawingAreaArea -> #YSSJDrawingAreaArea -> wysiwyg_image`；本地数据库 `experiments.config_json` 已确认包含该 mapping。
- 验证：`python3 -m json.tool backend/configs/exp_meter_modification.json` 通过；`pytest backend/tests/test_e2e_flow.py::test_mapping_audit_reports_meter_image_mapping -q` 通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 34 项。
- 修复提交后反馈读取不稳定：点击学校提交按钮前记录 bootbox / modal 基线，点击后按 `waitPolicy.afterClickMs` 短暂 settle，再轮询所有可见 `.bootbox .bootbox-body`，不再要求第一时间出现 `.bootbox-alert.in`；`SUBMIT_FEEDBACK_TIMEOUT` 会记录 `beforeClickDiagnostic` 和 `timeoutDiagnostic`，包含可见 bootbox、上传 modal、WYSIWYG popup、文件上传对话框、backdrop 和当前 URL。
- 验证：`py_compile backend/services/school_report_sync.py backend/tests/test_e2e_flow.py` 通过；提交反馈定向测试 2 项通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 35 项。
- 修复 Playwright `wait_for_function` 参数兼容问题：图片上传后等待 editor `<img>`、提交反馈等待、通用 DOM 等待均改为使用 `arg=` 传参，避免当前 Playwright Python 版本抛出 `wait_for_function() takes 2 positional arguments...`。
- 操作日志详情弹窗改为复用 Monaco JSON 编辑器只读展示完整 details，不再用普通文本块承载长 JSON；长字段可滚动、折叠和复制，暂不做摘要裁剪。
- 验证：`py_compile backend/services/school_report_sync.py backend/services/school_dom.py backend/tests/test_e2e_flow.py` 通过；提交反馈定向测试 2 项通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 35 项；`frontend/ npm run build` 通过。
- 新增独立脚本 `tools/complete_automation_mappings.mjs`，只基于现有 `backend/configs/*.json` 补齐 `automation.mappings`，不重新抽取、不重建 `inputs/ui/ai/formulas`，避免覆盖手动调整过的实验配置。
- 按电表已验证逻辑批量补齐其余实验配置：普通字段生成 `#sourceId` mapping，`ui.questions[].nodeId` 生成 `wysiwyg_text`，`image_upload` 生成 `wysiwyg_image`；已覆盖空气比热容比、落球法、液晶、示波器、光电效应、补偿法、声速、杨氏模量、三线摆等配置。
- 新增配置完整性测试，确保每个 `inputs.fields` / `ui.questions` 节点都有 automation mapping，图片节点 targetType 为 `wysiwyg_image`，问题节点 targetType 为 `wysiwyg_text`，mapping 不重复且 `targetLocator=#sourceId`。
- 验证：`node tools/complete_automation_mappings.mjs --check` 通过；所有 `backend/configs/*.json` 通过 `python3 -m json.tool`；配置完整性测试通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 36 项；本地数据库实验配置已执行 `seed_experiment_configs` 同步检查。
- 调整学生密码策略：平台登录密码与学校实验系统密码统一，学生首次登录创建账号时同时写入 `hashed_password` 和 `encrypted_school_password`；学校 Playwright 登录改为解密 `users.encrypted_school_password` 填入 `#userPass`，不再使用学号派生学校密码。
- 学号识别规则放宽为 `^26A\d{10}$`，不再硬编码 `26A25`；自动化配置 `identity.passwordPolicy` 更新为 `encrypted_user_password`，诊断脚本 `school_portal_probe.py` 改为 `--attempt-login` 时显式要求 `--password`。
- 新增 Alembic 迁移 `b9f1e2c3d4a5_add_encrypted_school_password.py`，本地数据库已执行 `alembic upgrade head`；不兼容旧用户数据，后续可按需要清库重建。
- 验证：`py_compile backend/core/school_password.py backend/api/v1/auth.py backend/services/school_overview_sync.py backend/tools/school_portal_probe.py backend/tests/test_e2e_flow.py` 通过；学生自定义密码加密保存测试通过；`pytest backend/tests/test_e2e_flow.py -q` 通过 37 项。

- 登录页新增首次学生账号创建确认：前端先调用 `POST /api/v1/auth/login-preview`，仅当后端判定该学号尚未创建且将写入学校系统凭据时，弹出账号/密码确认框；确认后才调用正式登录接口。已存在学生账号、admin、reviewer 不弹窗。

- 移除学校系统登录前的 `urllib` 预探测：自动化配置 schema 升级到 `1.4`，默认配置和校验删除 `networkPolicy/probeTimeoutMs`；网络可达性只以 Playwright 实际打开 `schoolSystem.loginUrl` 的结果为准，打开失败时才报 `NETWORK_UNREACHABLE`。
- 一键批量提交上传弹窗调整为全屏视口高度：顶部固定展示“一键批量提交 - 上传数据”和上传说明，底部固定保留取消 / 下一步确认清单操作，中间上传内容作为唯一滚动区域；移动端改为单列布局并允许底部按钮换行。
- 验证：`frontend/ npm run build` 通过；本地 Vite 开发服务运行在 `http://localhost:5174/`，首页 `curl -I` 返回 200。
- 修正一键提交全屏 Modal 的 Ant Design 6 DOM 层级适配：真实内容容器为 `.ant-modal-container`，已将 flex 高度、`padding: 0` 和 `overflow: hidden` 应用到该层，同时禁止 `.ant-modal-wrap` 外层滚动，确保只有 `.ant-modal-body` 中间区域滚动、footer 固定在底部。
- 验证：`frontend/ npm run build` 通过；相关文件 `git diff --check` 通过。
- 细化一键批量提交上传弹窗布局：header padding 调整为 `10px 30px`；实验列表序号改为固定圆形；右侧上传面板标题去除 `1 / 10` 和 `x 张图片`；桌面上传步骤改为左侧实验列表独立滚动、右侧上传控件固定，确认步骤仍保留中间区域滚动。
- 验证：`frontend/ npm run build` 通过；相关文件 `git diff --check` 通过。
- 重做一键批量提交最终确认页样式：移除 inline 列表样式，改为标题栏、白底实验清单卡片、右侧状态胶囊和底部固定警告区；确认步骤禁止整体 body 滚动，仅实验清单区域可滚动；未加入参考图中的圆形实验 icon。
- 验证：`frontend/ npm run build` 通过；相关文件 `git diff --check` 通过。
- 修复一键批量提交只上传部分实验图片却创建全部待提交实验审核任务的问题：仪表盘和实验列表入口现在只提交有图片 URL 的实验；后端 `/api/v1/submissions/submit` 对空 `image_paths` 返回 `400`，且不创建订单或 submission。
- 验证：`py_compile backend/api/v1/submissions.py backend/tests/test_e2e_flow.py` 通过；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py::test_one_click_submission_requires_uploaded_images backend/tests/test_e2e_flow.py::test_student_payment_flow -q` 通过；`frontend/ npm run build` 通过。
- Admin 订单管理页新增单次代劳合并收款展示：同一学生在 10 秒内创建的多笔 `pay_per_use` 订单会聚合成一行显示合计金额，父行显示短批次号 `BATCH-xxxxxx`，展开后展示各实验的原始订单、plan、金额和状态；确认收款或驳回合并行时会依次处理全部子订单。
- 验证：`frontend/ npm run build` 通过。
- 审核任务列表的实验展开行移除“在系统里查看”按钮，保留编辑、识别和提交等审核处理动作。
- 验证：`frontend/ npm run build` 通过。
- 修复 Celery AI 任务拿不到 `AI_API_KEY` 的问题：`docker-compose.yml` 现在通过根目录 `.env` 为 `backend` 和 `celery_worker` 注入同一套 AI 环境变量；`ai_service` 的识别/生成异常会保留底层错误类型和信息，后台日志不再只剩泛化文案。
- 验证：`python3 -m py_compile backend/services/ai_service.py` 通过；`docker-compose config --quiet` 通过；已重建 `backend` / `celery_worker`；worker 内确认 `AI_API_KEY=present`、answer/image/captcha 三个 AI profile 均可加载；在 worker 内用 answer_generation profile 发起最小 JSON Chat Completions 请求成功返回 `{"1":"ok"}`。
- 验证码识别迁移到 Celery worker：学校同步流程仍负责 Playwright 截图和结果解析，但 AI 调用改为投递 `recognize_captcha_task`；任务参数传 base64，避免本机 8001 后端与 Docker worker 之间共享文件路径的问题。
- 验证：`py_compile backend/services/captcha_ai.py backend/worker/ai_tasks.py backend/services/school_overview_sync.py` 通过；已重建 `backend` / `celery_worker`；用历史验证码截图经 base64 投递 worker 成功返回 OCR 文本；直接调用 `recognize_captcha()` 成功解析出验证码 `87NM`。
- 自动同步冷却字段迁移到 `syncPolicy.syncCooldownSeconds`：自动化配置 schema 升级到 `1.5`，默认配置、校验、运行时读取、失败诊断和文档均移除 `retryPolicy.syncCooldownSeconds`；本地数据库当前 default 配置已确认是新结构。
- 验证：`python3 -m py_compile backend/api/v1/automation_config.py backend/api/v1/school_sync.py backend/services/school_overview_sync.py` 通过；`backend/venv/bin/pytest -q tests/test_e2e_flow.py -k "admin_automation_config or school_sync_cooldown_reads_sync_policy_only"` 通过。
- 修复管理员打开学生实验详情页时被学生套餐前端拦截的问题：`一键填空`、`一键生成并填入回答`、`一键提交` 现在对 `admin/reviewer` 按内部账号放行，只有 `student` 继续受 `capabilities.plan` 限制；内部账号也不再触发仅学生可用的学校实验详情自动同步。
- 验证：`frontend/ npm run build` 通过；相关文件 `git diff --check` 通过。
- 根据 `assets/pdf/电表的改装.pdf` 扫描课件补全 `exp_meter_modification` 配置：修正实验目的第 3 条为测量小灯泡电阻，补充仪器旋钮对应关系、欧姆表刻度与调零原理、课件实验步骤、注意事项，并将数据处理标题和说明纠正为拟合 `Rₓ` 与 `1/Iₓ` 的线性关系。
- 电表公式仍沿用后端通用 `formulas` 表达式：以 `1/Iₓ` 为横坐标、`Rₓ` 为纵坐标，`DBGZ2` 为斜率 `E/k`，`DBGZ3` 为 `-intercept` 得到的 `Rs`，`DBGZ4` 为 3 位有效数字 `R²`；未新增学校 DOM 不存在的提交节点。
- 验证：`python3 -m json.tool backend/configs/exp_meter_modification.json` 通过；用后端 venv、`simpleeval` 和 `experiment_formulas` 对 8 个样例电流点计算 `DBGZ2/DBGZ3/DBGZ4` 通过。
- AI 识别 Prompt 改为配置驱动生成表格轴映射：默认系统提示压缩为禁止推断计算、看不清留空和 JSON 输出规则；后端会从 `ui.dataTable` / `ui.dataTables[].rows[].cells[]` 推导 `target/by/cols/nodes` 或 `row_axis/rows/cols/node_matrix`。电表单行多列生成 `target=I, by=Rₓ, cols=[200,400...], nodes=[DBGZ10-0,DBGZ10-1...]`；多行多列生成 `row_axis=砝码, rows=[1], cols=[上行读数,下行读数], node_matrix=[[A1,A2]]`。显式 `inputs.fields[].recognitionHint` 或 `ai.recognition.nodeHints` 仍可覆盖特殊节点。
- 验证：`py_compile backend/core/ai_prompts.py backend/tests/test_ai_prompts.py` 通过；`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过。
- 图片结构化识别模型从 `deepseek-ai/DeepSeek-OCR` 切换为 `zai-org/GLM-4.5V`：`.env`、`.env.example`、AI 配置种子、API 契约和管理员 AI 配置测试均已同步；数据库中旧 `deepseek-ai/DeepSeek-OCR` 配置会在读取时归一化为 GLM。
- AI 返回清洗增强：GLM 这类不走 JSON mode 的视觉模型会跳过 `response_format`，后端解析会剥离 `<|begin_of_box|>` / `<|end_of_box|>` 和 markdown fence，并从混合文本中提取首个完整 JSON object；非 object JSON 会直接拒绝，识别结果只保留实验配置声明的 nodeId。
- 使用 `assets/11.JPG` 按电表改装实验真实调用后端 `recognize_images()` 验证，清洗后输出 `DBGZ10-0=83.0`、`DBGZ10-1=71.0`、`DBGZ10-2=62.0`、`DBGZ10-3=55.0`、`DBGZ10-4=33.0`、`DBGZ10-5=19.5`、`DBGZ10-6=14.0`、`DBGZ10-7=11.0`。
- 验证：`python3 -m py_compile backend/core/ai_prompts.py backend/services/ai_service.py backend/services/ai_provider.py backend/tests/test_ai_prompts.py` 通过；`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过 5 项；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py::test_admin_ai_config_uses_database_profiles_without_key_leak -q` 通过。
- 修复 Admin 实验 Prompt 设置页仍显示旧 System Prompt 的问题：`GET /api/v1/ai/admin/prompts/{experiment_id}` 现在在没有数据库模板时返回后端 `core.ai_prompts` 当前默认值，前端兜底常量也同步为新默认值，避免 Python 默认 Prompt 和 React 硬编码默认 Prompt 不一致。
- 注意：如果某个实验之前保存过旧 Prompt 模板，数据库 `ai_prompt_templates` 里的非空值仍会按设计覆盖系统默认值，需要在页面清空/重存或清理该实验模板后才会回到默认 Prompt。
- 修复 AI 图片识别向模型传递站内上传路径的问题：上传接口返回并保存的 `/uploads/yyyy-mm/file.JPG` 会在 worker 内解析为本地 `/app/uploads/...` 文件并转换为 `data:image/...;base64,...`，不再把外部模型无法访问的相对 URL 原样作为 `image_url` 发送。
- 验证：`python3 -m py_compile backend/services/ai_service.py backend/tests/test_ai_prompts.py` 通过；`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过 6 项；`git diff --check` 通过。

- 学生实验详情页新增非阻塞后台任务浮窗：一键填空、AI 图片识别、一键计算数据和一键生成回答触发后会在右下角持续显示任务状态、已用时、成功摘要或失败原因，用户仍可继续编辑页面。
- 现阶段 AI 辅助任务继续复用已有 Celery `task_id` 与 `/api/v1/ai/task/{task_id}` 轮询；公式计算仍为同步接口，但前端统一纳入浮窗反馈。学校系统同步/提交等高风险自动化任务继续使用原有 `AutomationProgressModal`。
- 同步 `docs/API_CONTRACT.md`：修正旧的“AI/计算强同步 Blocking”描述，记录 AI 辅助任务的 task 查询契约和非阻塞浮窗展示约束。
- 实验图片上传控件新增真实旋转能力：旋转按钮会将当前图片用 canvas 旋转为新文件、重新上传到后端，并替换当前图片 URL；学生实验详情页、内联图片节点和一键提交上传弹窗共用该能力。图片工具栏按钮尺寸同步收紧，避免四个按钮换行。
- 生成式回答附带数据节点改为实验配置唯一来源：`ai.generation.dataNodes` 可配置要传给 AI 的 `inputs.fields[].id`，支持识别节点、计算节点和固定节点；数据库 Prompt 模板中的 `generation_data_nodes` 已从模型、API、Admin Prompt 页和 migration 中移除。电表改装默认仅传入 `DBGZ2/DBGZ3/DBGZ4` 三个计算结果节点。
- 新增 `docs/REVIEW_BATCH_PREPROCESS_AND_SUBMIT_PLAN.md`，明确完整提交模式下一键批量上传后的审核批次聚合、管理员图片匹配弹窗、匹配后自动固定填空 / AI 识别 / 问题回答生成、审核页人工一键计算，以及 admin/reviewer 触发临时 / 正式提交时使用 submission 所属学生学校账号与加密学校密码的全链路方案。
- 更新审核批量预处理方案：明确 `AiConfig.auto_recognize` 默认保持关闭且不作为完整提交主入口；批量预处理只做编排，复用学生侧已有固定填空、图片识别、问题回答生成服务能力并写入 submission；设置页后续新增学生端和 admin/reviewer 端分别控制“打开实验详情时自动加载学校数据”的开关。
- 审核预处理后端第一阶段落地：`submissions` 新增 `submission_batch_id`、`image_slots`、`preprocess_status`、`preprocess_error`；一键托管提交创建后进入 `pending_image_assignment`，不再自动盲识别；新增保存图片匹配接口和批量 `prepare-review` 接口；worker 新增 `prepare_submission_for_review_task`，复用固定填空、图片识别、生成回答服务并写回 `recognition_json`。
- 学校详情自动加载配置落地：自动化配置 schema 升级到 `1.6`，`syncPolicy` 新增 `autoLoadDetailForStudent=true`、`autoLoadDetailForInternalUser=false`；设置页新增两个开关；实验详情页改为先读取 `GET /api/v1/school-sync/settings` 再决定是否自动触发学校详情同步。
- 文档同步：`docs/REVIEW_BATCH_PREPROCESS_AND_SUBMIT_PLAN.md`、`docs/API_CONTRACT.md`、`docs/DECISIONS.md` 已记录新字段、新接口、新状态和配置决策。
- 验证：`python3 -m py_compile backend/models/core.py backend/api/v1/submissions.py backend/api/v1/orders.py backend/worker/ai_tasks.py backend/api/v1/automation_config.py backend/api/v1/school_sync.py` 通过。
- 审核任务页第一版接入批次聚合和图片匹配弹窗：`GET /review-pool` 返回的任务按 `student + submission_batch_id` 聚合；批次操作可打开 `ReviewBatchImageAssignmentModal`，查看学生上传图片池，按实验配置图片槽保存 `image_slots`，并调用 `prepare-review` 启动预处理。
- 批量图片匹配弹窗增强：支持点击选图放入槽位、图片预览、移除、已使用标记；旋转复用上传控件中的真实旋转逻辑，旋转后重新上传并替换槽位 URL，不做纯 CSS 旋转。
- 审核详情页回填修正：复用学生 `ExperimentDetailView` 时传入 `initialSubmission` 和 `initialImageSlots`，优先从 `submission.image_slots` 回填图片控件；初始表单值从 `corrected_json.values` / `recognition_json` 解包，避免把 `_meta` 或包装对象塞进节点值。
- 学校详情手动加载补齐：实验详情页新增“加载学校数据”按钮；学生侧仍调用学生自用详情同步接口，审核详情页通过 `POST /api/v1/school-sync/experiments/{experiment_id}/submissions/{submission_id}` 触发同步并使用 submission 所属学生学校账号，完成后读取 submission 学生的详情快照回填。
- 一键批量提交批次号补齐：前端 `submitExperiment` 支持 `submission_batch_id`，仪表盘、实验列表和单实验详情提交入口会在同一轮提交中生成并传入同一个 `BATCH-*`，确保审核任务页能按真实提交批次聚合，而不是每个实验各自成批。
- 服务端图片节点同步补齐：保存审核 correction 时，后端会根据实验配置 `inputs.images[].targetNodeId` 把 `image_slots` 中的图片 URL 同步进 `corrected_json.values[targetNodeId]`，确保学校提交服务只读 `corrected_json.values` 也能写入图片节点。
- 测试补充：新增覆盖批次图片匹配 / 批量预处理排队、审核页按 submission 触发学校详情同步且使用 submission 学生账号、保存 correction 同步图片 target node 的 e2e 测试。
- 验证：`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py -q` 通过 43 项；`frontend/ npm run build` 通过；`git diff --check` 通过。
- 遗留：预处理进度当前通过 submission 字段表达，尚未升级为 public job；匹配弹窗后续可继续增强跨实验图片池、键盘操作和更完整的缩放平移预览体验。
- 审核图片匹配弹窗修正：页面文案统一使用“图片匹配”；弹窗改为复用一键批量提交的全屏 Modal 壳，标题和底部按钮固定，中间工作区滚动；右侧图片槽改为复用实验详情页同一个 `ExperimentImageUploader`，避免重复造槽位 UI；学生上传缩略图改为走统一上传 URL 解析，修复 `/uploads/...` 缩略图不显示；关闭弹窗时增加 `batch` 空值保护，避免点击叉号崩溃。
- 审核完成后续状态补齐：审核任务池保留 `draft_submitted` 和 `completed` 记录，前端状态文案将 `reviewing` 显示为“待人工审核”、`completed` 显示为“正式提交完成”；学生最近操作会展示 target 指向其 submission/order 的完成类日志。
- 学校提交 audit action 统一为 `school_draft_submit_started/completed/failed` 和 `school_final_submit_started/completed/failed`；提交类日志 `target_id` 统一指向 submission id，job id 仅保留在 details 诊断文本中，不再兼容旧的通用 submit action。
- 光电效应配置补齐：参照电表改装的配置驱动识别方式，`exp_photoelectric_planck` 删除逐节点 `nodeHints` 长说明，依赖 `ui.dataTables` 自动生成表格 `node_matrix`；仅用实验级 `ai.recognition.extraPrompt` 补充表1/表2电流单位系数换算和表3截止电压保留正负号。学校系统自带的电压行 `G11-*` 与频率行 `G60-*` 不再作为平台字段、识别字段或自动填报 mapping。
- 验证：`backend/venv/bin/python -m pytest tests/test_ai_prompts.py tests/test_experiment_formulas.py` 通过 12 项；光电识别 prompt 预览确认只包含表结构映射和实验级补充说明，不再输出 `G10-0:` 这类逐节点提示。

## 2026-07-07

### 学校系统 bootbox 错误收敛

- 单实验同步和提交打开报告前新增统一 bootbox guard：复用会话、点击“完成报告”前后、等待报告 modal 失败时都会检查可见 `.bootbox .bootbox-body`；若学校系统弹出 `error` 等提示，立即抛出 `SCHOOL_BOOTBOX_ERROR`，保存 bootbox 截图/HTML artifact，并将任务置为 `failed`。
- `GET /api/v1/automation-jobs/{job_id}` 增加窄范围兜底：仅当学校自动化 job 仍处于详情/提交的连接或打开报告阶段时，轮询会检查当前会话 bootbox 并把已卡住的 job 收敛为失败；提交确认阶段的 bootbox 反馈仍由提交链路处理。
- 修复详情同步失败落库：`school_detail_sync` 不再复用提交任务的 audit action 生成逻辑，失败审计记录写入 `school_detail_sync_failed`，target 指向 automation job id，避免错误处理时二次异常导致前端一直轮询 running。
- 验证：`backend/venv/bin/python -m pytest tests/test_e2e_flow.py -q` 通过 46 项。

### 学生一键提交支付计划透传修复

- 修复学生实验列表页“一键提交”在支付弹窗选择 Pro 后仍创建 `pay_per_use` 订单的问题：该页面原先把 `submitExperiment` 的 `plan` 参数写死为 `pay_per_use`，现在会接收并透传 Paywall 返回的 `planName`。
- 新增 `frontend/src/utils/oneClickSubmitUtils.js`，将实验列表页、仪表盘一键批量提交和单实验详情页的一键托管提交流程收口到同一套图片 URL 提取、空实验过滤、批次号生成和 `planName` 透传逻辑；详情页继续保留“弹窗无新图时复用页面已有图片”的 fallback 行为。
- 验证：`frontend/ npm run build` 通过。

### AI 识别单位提示增强

- 识别默认系统指令新增“注意单位”约束：要求按表头和行名单位换算成目标表格数值，返回值不带单位。
- 表格识别 prompt 在保留短标签 `rows` / `cols` 的同时，新增原始单位上下文：`row_axis_label`、`row_labels`、`col_labels`；光电效应实验的 `I（10⁻¹¹A）`、`I（10⁻¹⁰A）`、`截止电压U₀（V）` 会进入 AI 可见 prompt。
- 验证：`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过 10 项；`python3 -m json.tool backend/configs/exp_photoelectric_planck.json` 通过。

### AI 辅助任务公共化

- 新增后端 `services/ai_task_audit.py`，统一一键填空、AI 图片识别、AI 回答生成和公式计算的 started / completed / failed 审计 action；直接详情页触发的 AI 任务支持传入 `submission_id`，日志 target 优先指向 submission，便于 reviewer 任务详情排查。
- `/api/v1/ai/recognize-direct`、`/generate-answer-direct`、`/fixed-fill/{experiment_id}` 入队时写 started 日志并返回 `poll_timeout_seconds` / `poll_interval_ms`；前端不再固定 60 秒轮询，而是按后端 AI profile 超时加队列缓冲等待，避免模型仍在运行时误报 timeout。
- `GET /api/v1/ai/task/{task_id}` 改为只有 Celery `SUCCESS` 才返回 done，`PENDING` / `STARTED` / `RETRY` 等状态继续返回 pending，避免任务刚开始就被前端误判完成。
- 新增前端 `useAsyncTaskRunner`，将学生/审核详情页的一键填空、一键识别、生成回答、计算数据统一到公共浮窗任务、轮询、失败、重试逻辑；页面只保留各按钮的业务输入和成功回填逻辑。
- 学生可见日志白名单和前端日志枚举补齐 `ai_fixed_fill_*`、`ai_recognition_*`、`ai_answer_generation_*`、`formula_compute_*`。
- 验证：`py_compile backend/api/v1/ai.py backend/api/v1/experiments.py backend/worker/ai_tasks.py backend/services/ai_task_audit.py` 通过；`frontend/ npm run build` 通过；`backend/venv/bin/python -m pytest backend/tests/test_e2e_flow.py::test_ai_assist_task_start_logs_submission_target backend/tests/test_e2e_flow.py::test_ai_assist_worker_completion_logs_canonical_action backend/tests/test_e2e_flow.py::test_ai_task_status_treats_started_as_pending backend/tests/test_e2e_flow.py::test_student_audit_logs_hide_internal_actions -q` 通过 4 项。

### 光电普朗克常数结果改为识别项

- 根据 PPT “作 U0-v 直线，由图求出斜率 k 后求 h 和相对误差”的要求，`exp_photoelectric_planck` 中 `G7` 普朗克常数计算值和 `G8` 相对误差由 `computed` 改为 `ai_recognize`，让 AI 识别学生原始数据纸/作图记录里已经写出的结果。
- 原 `G7/G8` 后端公式保留到 `archivedFormulas`，不再放入可执行 `formulas`，避免一键计算用最小二乘自动覆盖学生按图得到的结果；`G3/G4/G5` 仍保持公式计算。
- 验证：`python3 -m json.tool backend/configs/exp_photoelectric_planck.json` 通过；`backend/tests/test_ai_prompts.py` 已补充 prompt schema 与公式执行范围断言。

### 实验 AI Prompt 配置指南

- 新增 `docs/EXPERIMENT_AI_PROMPT_CONFIG_GUIDE.md`，沉淀实验 JSON 中 `ai_recognize`、`recognitionHint`、`ai.recognition.extraPrompt`、`ai.generation`、`formulas` 和 `archivedFormulas` 的分工、读取顺序、推荐写法和反例。
- 同步 `docs/EXPERIMENT_JSON_SCHEMA_AND_FRONTEND_GUIDE.md`，增加 AI 提示边界入口，明确表格单位优先放 `ui.dataTables`、非表格特殊节点才写 `recognitionHint`、实验级 `extraPrompt` 只放少量通用特殊规则。

### 分段表格识别映射修正

- 修复 `ui.dataTables` 中“表头行 + 数据行 + 第二段表头行 + 第二段数据行”的 AI 字段映射：后端现在会把无 `nodeId` 的多文本行识别为局部坐标轴，并拆成多段 `table` 映射，避免光电效应表 1 的第二排 `G12-*` 因缺少 `6,8,10...30` 列坐标而被模型当成重复行漏填。
- 光电效应识别 prompt 现在分别输出 `G10-*` 对应 `cols=[-1.5,...,5]` 和 `G12-*` 对应 `cols=[6,8,10,13,16,19,22,26,30]`；表 3 的波长/频率双行坐标也会合并为 `365/8.214` 等列标签。
- 验证：`backend/venv/bin/python -m pytest backend/tests/test_ai_prompts.py -q` 通过 12 项；`python3 -m py_compile backend/core/ai_prompts.py backend/tests/test_ai_prompts.py` 通过；`git diff --check` 通过。

### 审核任务审核状态筛选

- 审核任务页将原“总进度”改为“审核状态”，避免和后续学生维度“所有实验是否全部提交”的总览混淆；批次和单实验均基于现有 `submission.status` 派生审核状态，不新增数据库字段。
- `draft_submitted` 和 `completed` 均视为审核完成，其余状态视为未完成；审核状态筛选支持完成 / 未完成，选择未完成时展开行只显示未完成单实验。
- 新增 `docs/STUDENT_ACCOUNT_EXPERIMENT_STATUS_OVERVIEW_PLAN.md`，记录后续 admin 学生账户与实验提交状态总览页方案，用于查看所有同学账户状态、学校同步状态和是否全部提交。

### 学校提交确认状态接入学生实验列表

- `GET /api/v1/school-sync/overview/latest` 现在会在最近学校总览快照基础上合并已回读确认的单实验提交快照：只有 `school_submit_confirmed` 且 `statusConfirmation=list_confirmed`、学校状态与提交模式匹配的记录才会覆盖对应实验的学校状态。
- 学生实验列表的“学校提交状态”仍只使用学校状态数据源，不使用平台 `Submission.status` 兜底；临时提交成功后，即使未重新跑总览同步，也能显示提交链路回读确认到的 `school_draft_submitted`。
- 平台状态文案修正：`completed` 显示为“正式提交完成”，学校 `school_final_submitted` 显示为“正式提交”。

### 声速测量配置按 PPT 修正

- 参照 `assets/pdf/声速测量.pdf` 和实验 AI Prompt 配置指南，`exp_sound_velocity` 重新划分字段来源：相位法/驻波法的位置读数和谐振频率由 AI 识别，PPT 中固定的 `i+5=6..10`、`i+4=5..8`、仪器名称和思考题固定答案由配置固定填入。
- 按 PPT 数据处理要求新增声速公式：相位法 `λi=(li+5-li)/5`、`λ平均=Σλi/5`、`v=fλ`；驻波法 `λi=(li+4-li)/2`、`λ平均=Σλi/4`、`v=fλ`。均值和声速公式直接引用原始读数，避免被单元格显示格式字符串影响。
- 相位法和驻波法表格中的单项 `λi` 结果按学校表格展示需求保留三位小数，平均 λ 仍保留两位小数。
- AI 识别 prompt 已通过 `ui.dataTables` 自动携带表格坐标，只包含原始位置读数和频率节点，不把固定索引行、λ、平均值、声速发给模型识别。
- 验证：`python3 -m json.tool backend/configs/exp_sound_velocity.json` 通过；`backend/venv/bin/python -m pytest backend/tests/test_experiment_formulas.py backend/tests/test_ai_prompts.py -q` 通过 16 项；执行实验配置 seed 后数据库中 `exp_sound_velocity` 关键字段与公式已抽查确认。
