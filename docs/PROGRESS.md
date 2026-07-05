# Progress

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
- 明确学校系统登录只使用 `student_no`，密码同 `student_no`；不兼容旧数据，必要时直接清表或重建数据库。
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
- 脚本默认不提交登录；传入 `--attempt-login` 后会填写学号和同值密码，若未获得验证码识别结果则停在提交前并清空账号密码。
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
- 落地第 4 节概览同步垂直切片：新增 `GET /api/v1/school-sync/overview/latest`，按 `syncCooldownSeconds` 返回 `shouldSync`；学生仪表盘进入时自动检查并触发概览同步 stub，通知按钮左侧新增“同步状态”手动同步按钮，手动同步使用 `force=true` 忽略冷却。
- 补齐真实 Playwright 接入前的单实验同步壳：新增 `POST /api/v1/school-sync/experiments/{experiment_id}` 创建 `school_detail_sync` public job，当前写入空快照 stub；学生实验详情页进入时会触发该 job，并复用 `AutomationProgressModal` 展示同步步骤。
- 补齐刷新恢复和提交前快照：学生仪表盘 / 实验详情页会先查询 active automation job 并恢复进度弹窗；创建临时 / 正式提交 job 前写入 `submission_versions(source=platform_before_submit)`，便于学校系统失败后追踪平台侧提交数据。

### 学校概览同步真实 service 接入

- 新增 `backend/services/school_overview_sync.py`，将概览同步从 API 内部 stub 抽成后端 service：读取 Admin 自动化配置、探测内网登录 URL、使用 Playwright 打开学校登录页、按 `users.student_no` 填写账号和同值密码、截图验证码并调用 OpenAI-compatible 视觉模型识别、读取右上角真实姓名和完成报告列表。
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

- 概览同步冷却时间调整为 10 分钟：默认 `syncCooldownSeconds=600`，后端无配置时也按 600 秒兜底。
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
- 验证：本次仅修改文档，未运行后端测试或前端构建。
