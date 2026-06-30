# Decisions

## 2026-06-30

### 支付与订单防重复提交流程 (Duplicate Submission Prevention)

针对学生侧可能产生的并发提交、网络延迟重试以及恶意刷单请求，在后台订单验证流和核心自动填报流程确立以下防御与锁止策略：

1. **针对“套餐升级”的互斥锁 (Upgrade Lock)**：
   如果用户存在一条状态为 `pending_payment`（待核实付款）的升级订单（Pro/Plus），后端必须全局拦截该用户的任何二次升级请求，抛出 `409 Conflict` 冲突。前端在拦截响应后，弹窗提示“您有一笔待确认的升级订单，请勿重复提交”。
2. **针对“单次代劳”的实验级锁定 (Submission Lock)**：
   锁定粒度下沉到“单个实验提交记录 (submission_id)”。只要某实验生成了任何未取消的单次代劳订单（`pending_payment`、`paid` 等状态），系统通过数据库级唯一约束 `UNIQUE(submission_id, user_id)`，拒绝用户对同一份实验报告进行二次发起单次付费请求。
3. **前后端幂等性防刷 (Idempotency)**：
   - **前端拦截**：所有关键触发节点（“一键提交”、“我已支付”、“确认收款”、“驳回”）必须在点击后立即进入 `disabled + loading` 锁定状态，等待网络回包。
   - **后端机制**：关键流转接口引入幂等键验证（基于 `user_id + action + target_id`），确保同一时段内的高并发重放请求只放行第一个，保证状态机单向演进不分叉。

## 2026-06-22

### 前端 UI 规范层

- 采用 `theme.css` + `ui.css` + `components/ui` 的轻量设计系统做法，而不是按每个页面继续拆出大量 CSS 文件。
- `theme.css` 负责颜色、圆角、阴影、边框和间距 token；`ui.css` 负责黄金强调按钮、通用卡片、表格容器、四项指标卡、状态标签等可复用样式。
- 新页面优先复用 `GoldButton`、`PageHeading`、`StatCard`、`StatusBadge`、`TablePanel`、`UiPanel`，页面 CSS 只保留页面专属布局和复杂交互。
- 新增 admin 内部页面 `/workspace/admin/design-system` 展示当前可复用组件规范，作为后续页面实现的对照入口。

### 控件圆角和输入规范

- 按钮和常规输入控件统一使用 8px 圆角矩形，不再使用胶囊或圆形按钮作为后台默认控件形态。
- 输入控件统一沉淀在 `ui.css`：38px 基础高度、浅灰边框、蓝色 hover/focus、统一 placeholder 和文本域计数字体。
- 非按钮的状态点、头像、进度圆环、统计卡图标背景可继续使用圆形。

### 实验配置架构 V2（前端零逻辑 + 后端 DAG 解析）

- **五大解耦模块**：全新 JSON 实验配置被重构为 `meta, inputs, ui, ai, automation` 五大高内聚模块，彻底抛弃旧版设计。
- **UI 三段式精准映射**：
  - `ui.fixedSections` 映射至前端区域 1（基础填空），受 `canUseAssistedFill` (Pro 权限) 控制。
  - `ui.dataTable` 和 `inputs.images` (逻辑图片插槽) 映射至前端区域 2（左右分栏布局的实验数据与多图上传）。
  - `ui.questions` 映射至前端区域 3（实验问题），AI 一键生成按钮受 Pro 权限控制。
- **前端零逻辑计算**：为了保护物理计算公式知识产权并解决复杂的跨域和连环依赖（A->B->C 跨域->D），前端废除了所有的业务计算层（移除 `labCalculations.js`）。所有的推导通过触发后端的统一 `POST /api/experiments/{exp_id}/compute` 接口执行，后端运用 DAG（有向无环图）自动解析依赖链和跨域任务，将全部结果一次性返回给前端回填。
- **图片利用与 Automation 升级**：放弃旧脚本的硬编码图片名，改为按 `inputs.images` 声明图片槽位。自动化环节（Playwright）完全引入高级 Locator 语法，可一键将图片插槽中的多张图片按指定 DOM 特征（如 `nth=2`、文字兄长节点）精准投递，解决了重复富文本编辑器的问题。

### 防重发与并发锁定控制（订单与自动化防刷机制）

针对学生侧可能产生的并发提交、网络延迟重试以及恶意刷单请求，我们在架构设计中确立了以下防御与锁止策略，待后端实现时必须严格遵守：

- **针对“套餐升级”的互斥锁 (Upgrade Lock)**：
  如果用户存在一条状态为 `pending_payment`（待核实付款）的升级订单（Pro/Plus），后端必须全局拦截该用户的任何二次升级请求，抛出 `409 Conflict` 冲突，前端弹窗提示“您有一笔待确认的升级订单，请勿重复提交”。
- **针对“单次代劳”的实验级锁定 (Submission Lock)**：
  锁定粒度下沉到“单个实验提交记录 (submission_id)”。只要某实验生成了任何未取消的单次代劳订单（`pending_payment`、`paid` 或 `reviewing`），系统通过数据库级唯一约束 `UNIQUE(submission_id, user_id)`，拒绝用户对同一份实验报告进行二次发起付款请求。
- **前后端幂等性防刷 (Idempotency)**：
  前端所有关键触发节点（“一键提交”、“我已支付”、“审核通过/驳回”）必须立即进入 `disabled + loading` 锁定状态；后端关键流转接口引入幂等键验证（Idempotency Key，基于 `user_id + action + target_id` 的 Redis 锁），确保10毫秒内发来的10个高并发重放请求只放行第一个，保证状态机单向演进不分叉。
