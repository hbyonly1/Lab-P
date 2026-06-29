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
