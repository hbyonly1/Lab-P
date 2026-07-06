# Decisions

## 2026-07-02

### 学生端保存页 HTML 批量转后端 V2 配置

- 从 `assets/complete_saves_student` 的真实学校系统保存页抽取 8 个新增实验，生成 V2 JSON 配置，继续沿用 `meta / inputs / ui / ai / formulas` 结构。
- 配置文件只保存在 `backend/configs` 并 upsert 到 `experiments.config_json`；前端通过后端实验 API 获取配置，不再保留构建期 JSON 副本。
- 图片从 HTML 内联 base64 提取为 `frontend/public/assets/configs_images/*`，小公式图保留 `inline=true`，块级图按最大 400px 高度展示。
- 当前阶段先保证填空、表格、图片插槽和实验回答区可加载、可编辑、可保存；复杂公式仍留在后端 `formulas`/DAG 后续补齐。

### Admin 原始实验配置编辑

- Admin 在实验预览页最左侧“原始配置”Tab 中维护单个实验的 V2 JSON，不在实验列表页另做一套编辑入口。
- JSON 编辑器抽为公共组件，自动化配置和实验原始配置共用同一套格式化、JSON object 校验和保存按钮交互；保存配置时不再弹出二次确认框。
- 保存实验原始配置时，后端同时写回 `backend/configs/{experiment_id}.json` 和 `experiments.config_json`，确保源文件与运行态数据库一致。
- 后端不接受前端传入文件路径，只根据 `experiment_id` 生成受控路径，并校验 `meta.id` 与路径参数一致。
- 每次保存写入 `audit_logs`，记录 action、target_id、文件名和保存前后 hash，不把完整大 JSON 写入审计详情。
- 实验配置列表区分 `updated_at` 和 `config_file_mtime`：前者只代表配置内容 hash 发生变化的时间，后者代表本地 JSON 文件修改时间。手动刷新时如果 hash 不变，不更新 `updated_at`。
- 计算规则归属于实验配置源文件，Admin 保存“计算规则配置”时写回 `backend/configs/{experiment_id}.json` 的顶层 `formulas`，并同步数据库运行态。

### 实验排序与启用状态

- 实验显示顺序统一由 `backend/configs/{experiment_id}.json` 的 `meta.sortOrder` 控制，后端 `GET /api/v1/experiments` 按该字段排序后返回，Admin 实验配置页和学生实验页共用同一顺序来源。
- 实验是否对学生开放统一由 `meta.enabled` 控制；缺失时默认视为启用，显式 `false` 时学生列表和学生详情接口都不可见。
- 实验配置 `meta` 不保存学生维度状态，已删除 `meta.status`；某个学生的实验状态只由 `submissions` 产生并在学生页面合并展示。
- Admin / Reviewer 仍可从实验列表和详情接口读取停用实验，便于配置、审核和恢复；前端隐藏不是权限边界，学生过滤必须在后端完成。

### 自动化配置以 Admin JSON 文本维护

- 学校系统基础选择器、入口 URL、验证码节点、提交按钮、反馈节点、重试策略和 Playwright 运行参数第一版统一保存到 `automation_engine_configs.config_json`。
- Admin 页面只提供一个 JSON 文本配置入口，不为每个选择器单独设计设置栏，避免学校系统页面变化时频繁改表和改 UI。
- 自动化配置仅 Admin 可见、可修改；保存前做 JSON 格式校验和必填路径校验；保存后写入 `audit_logs`。
- 配置 JSON 只保存选择器和运行参数，不保存具体 Playwright 脚本代码。具体脚本在 Worker 实现阶段单独设计。

### 学校系统身份字段策略

- 当前代码和 migration 中 `users` 表只有 `username`，没有 `name` 字段；`username` 是平台登录名，学生账号场景下曾被临时复用为学号。
- 后续真实学校系统接入必须拆分语义：新增 `users.student_no` 保存学号，新增 `users.real_name` 保存学校系统同步到的真实姓名。
- 登录学校系统时账号只使用 `student_no`，密码使用用户登录平台时输入密码的加密副本 `users.encrypted_school_password` 解密结果。
- `real_name` 只用于展示、学校系统同步后的核对和人工确认，不参与学校系统登录。
- 不兼容旧数据；如果本地库里已有旧用户数据与新字段语义冲突，直接清表或重建数据库。
- 学校系统密码不再假设等于学号；平台登录密码和学校实验系统密码统一，由后端同时保存哈希和可解密加密副本。明文密码不得返回前端、写入日志或进入 automation job payload。

### 验证码 AI 识别统一进入 Worker

- 学校系统验证码识别不再在 FastAPI / Playwright 同步流程内直接调用大模型；验证码截图由当前流程读取为 base64 后投递给 Celery `recognize_captcha_task`。
- Worker 侧负责调用统一 AI provider 的 `captcha` profile，避免高并发验证码识别阻塞 API 进程，并保证验证码、实验图片识别和问题生成使用一致的 worker 环境变量与并发控制。
- 任务参数传 base64，不传本地文件路径；这样本机 `8001` 后端、Docker backend 和 Docker worker 不需要共享 `tmp/` 文件系统。

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

### Prompt 配置归属

- 实验 JSON 不保存识别或生成 Prompt 文本，只保留 `ai.recognition.imageRef`、`ai.generation.targetRef`、`ai.generation.dataNodes` 等结构绑定。
- Prompt 内容统一由系统 Prompt 模板页维护，后端按 `AiPromptTemplate -> 系统默认模板` 的优先级生成最终识别和回答 Prompt。
- 这样避免 raw JSON 与系统设置同时维护 Prompt 文案造成来源不清。

### 电表改装拟合公式

- 电表改装实验的 `DBGZ2/DBGZ3/DBGZ4` 由后端公式计算器统一计算，不在前端实现拟合逻辑。
- 计算模型为 `Rₓ = k * (1/Iₓ) + b`，使用表格中的 `Rₓ = 200/400/600/800/2000/4000/6000/8000 Ω` 和学生识别/填写的 `Iₓ(μA)` 做线性拟合。
- `DBGZ2 = k`，单位与页面展示保持为 `Ω∙μA`；`DBGZ3 = -b`；`DBGZ4 = R²`，按 3 位有效数字格式化。
- 后端公式执行器保留白名单函数机制，公式统一通过 `v()` 显式读取节点或常量：`v('A')` 返回单个节点值，`v('A','B')` 返回节点序列，`v(200,400)` 返回常量序列。
- 公式函数集中放在 `backend/services/experiment_formulas.py`；不再保留电表改装专用函数，也不从 UI 表格结构推断计算依赖。电表改装的电流节点和 `Rₓ` 常量直接写在 `formulas` 中，后续单节点、非表格节点和多节点序列都走同一套表达方式。

### 图片答案节点

- 实验表格识别图片和学校系统中的图片答案节点分开建模，不再共用一个上传区域。
- `ai.recognition.imageRef` 只指向 AI 识别用图片槽位；单独图片答案通过 `inputs.fields[].type = "image_upload"` 和 `inputs.images[].targetNodeId` / `imageSlotId` 绑定。
- 前端遇到 `image_upload` 节点时，在该段落位置渲染独立图片上传卡，上传成功后将图片 URL 写回对应 `nodeId`；该节点不进入生成式文本回答 textarea。
- 落球法测粘滞系数的 `L3Area` 采用该语义，作为“粘滞系数与温度关系曲线”的图片答案节点。

### 审核预处理复用学生侧 AI 能力

- 一键托管提交默认进入 `pending_image_assignment`，等待管理员 / 审核员完成图片归位；`AiConfig.auto_recognize` 保持关闭或内部调试语义，不作为完整提交主链路。
- 批量预处理只做编排，不重写 AI 能力：固定填空复用 `ai_service.get_fixed_fill()`，图片识别复用 `ai_service.recognize_images()`，生成回答复用 `ai_service.generate_answers()`。
- AI 识别图片来源以实验配置 `ai.recognition.imageRef` 对应的 `submission.image_slots` 为准，避免对学生上传的整批图片盲识别。
- 预处理结果第一阶段继续写入扁平 `submission.recognition_json`，以兼容现有审核详情页；长期可升级为 `{ values, _meta }` 结构。
- 学校详情自动加载属于学校自动化策略，放在 `automation_config.syncPolicy`；学生默认开启，admin / reviewer 默认关闭。

### 防重发与并发锁定控制（订单与自动化防刷机制）

针对学生侧可能产生的并发提交、网络延迟重试以及恶意刷单请求，我们在架构设计中确立了以下防御与锁止策略，待后端实现时必须严格遵守：

- **针对“套餐升级”的互斥锁 (Upgrade Lock)**：
  如果用户存在一条状态为 `pending_payment`（待核实付款）的升级订单（Pro/Plus），后端必须全局拦截该用户的任何二次升级请求，抛出 `409 Conflict` 冲突，前端弹窗提示“您有一笔待确认的升级订单，请勿重复提交”。
- **针对“单次代劳”的实验级锁定 (Submission Lock)**：
  锁定粒度下沉到“单个实验提交记录 (submission_id)”。只要某实验生成了任何未取消的单次代劳订单（`pending_payment`、`paid` 或 `reviewing`），系统通过数据库级唯一约束 `UNIQUE(submission_id, user_id)`，拒绝用户对同一份实验报告进行二次发起付款请求。
- **前后端幂等性防刷 (Idempotency)**：
  前端所有关键触发节点（“一键提交”、“我已支付”、“审核通过/驳回”）必须立即进入 `disabled + loading` 锁定状态；后端关键流转接口引入幂等键验证（Idempotency Key，基于 `user_id + action + target_id` 的 Redis 锁），确保10毫秒内发来的10个高并发重放请求只放行第一个，保证状态机单向演进不分叉。
