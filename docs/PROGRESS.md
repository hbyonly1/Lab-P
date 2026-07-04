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
- 验证码流程已预留 AI API：`--captcha-source ai` 会将验证码图片通过 OpenAI-compatible Chat Completions 发送给视觉模型，默认读取 `ARK_API_KEY`，不会把 API Key、学校密码或验证码文本写入报告。
- 使用调试验证码完成一次真实登录验证，登录成功落点为 `/ReportStudent/CompleteReport/`，页面标题为“完成报告”；脚本会等待登录后 loading 遮罩消失再截图。
- 采集产物示例：`backend/tmp/school_portal_probe/20260702_111636_26A****0207/`，包含登录页、验证码、登录后完成报告列表截图和 DOM 摘要。
- 验证：`backend/venv/bin/python -m py_compile backend/tools/school_portal_probe.py` 通过；真实页面采集成功；未触发报告进入、临时提交或正式提交。
- 遗留风险：当前环境未配置 `ARK_API_KEY`，因此 AI 验证码识别路径仅验证了缺 key 时会安全停止；后续需配置 key 后测试自动识别准确率和重试策略。

### 自动化配置生效化与轻量列表同步

- 将默认自动化配置改为真实学校系统配置，并使用 `_comment` 字段承载 JSON 注释；标准 JSON 不使用 `//` 注释。
- 自动化配置不兼容旧结构，当前以 `schema_version=1.1` 为准；如果数据库里的 `default` 仍是旧版本或缺少当前必填顶层键，GET 时直接替换为当前默认结构。
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
- 生成配置只写入 `backend/configs`；新增 `backend/services/experiment_seed.py`，FastAPI 启动或实验 API 请求时 upsert 到 `experiments.config_json`。
- 前端实验列表、学生/审核员/管理员实验详情和 Prompt 节点选择均改为通过 `GET /api/v1/experiments`、`GET /api/v1/experiments/{id}` 从后端读取配置；`frontend/src/assets/configs` 不再保存实验 JSON。
- 新增 `PATCH /api/v1/submissions/{submission_id}/correction`，学生可保存自己的页面填空、表格值、实验回答和图片路径到 `submissions.corrected_json`，并写入审计日志。
- 学生实验详情页的“临时提交/正式提交”已接入后端保存；若当前实验尚无 submission，会先创建挂起付款的 submission 再保存。
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
