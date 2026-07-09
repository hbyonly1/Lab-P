# Decisions

## 2026-07-08

### 重列表分页与懒加载

- Admin 同学管理、Admin 订单管理、Reviewer 审核任务三类重列表统一改为服务端分页、搜索和筛选；接口返回 `{ items,total,page,pageSize,summary }`，不再保留旧数组响应。
- 同学管理列表只返回学生摘要，且摘要按“最新学校概览快照 + 已确认的临时/正式提交快照”计算；展开某个学生时再调用 `/api/v1/admin/students/{student_id}/experiments` 读取该学生实验行，避免首次加载传输和计算所有学生 × 所有实验，同时保证列表摘要和展开行学校状态口径一致。
- 订单列表只返回当前页订单及其明细；顶部金额和待处理数量由后端聚合生成，前端不再拉全量订单后本地统计。
- 审核任务列表按分页返回 submission 行，前端继续在当前页内聚合提交组；跨页批量聚合后续如有需求再单独做 batch 级后端接口。
- 为列表常用排序和过滤字段补充数据库索引：`users(role, created_at)`、`submissions(status, created_at)`、`submissions(student_id, created_at)`、`orders(status, created_at)`、`orders(student_id, created_at)`、`school_sync_snapshots(user_id, synced_at)`。

### 套餐权益和统一价格表

- 学生侧能力按套餐强制校验：Free 不能使用一键填空、AI 图像识别和一键计算数据；Plus 可以使用 AI 图像识别和一键计算数据，但不能使用一键填空；Pro 可以使用全部工具能力和一键提交。
- 一键提交只允许 Pro 直接放行，非 Pro 学生必须通过 `pay_per_use` 创建本次托管订单；前端不得用套餐判断直接阻止用户进入单次购买流程。
- 价格只从 `backend/core/pricing.py` 读取：Plus 16 元，Pro 35 元，单实验一键托管 5 元。
- 当前不读取实验 JSON 中的 `pricing.oneClick` 覆盖价，避免同一批次和不同页面金额不一致；后续如做实验级自定义价格，需要先扩展统一价格表和 checkout 测试。

## 2026-07-07

### 支付与一键批量提交统一 Checkout

- 套餐升级、按实验计价和学生一键批量提交统一走 `POST /api/v1/checkout/quote` 与 `POST /api/v1/checkout/submit`；旧的 `POST /api/v1/orders` 和 `POST /api/v1/submissions/submit` 创建入口不再保留。
- 金额只由后端计算：套餐金额和按实验一键托管价格集中在 `backend/core/pricing.py`。
- 一个批次只生成一笔订单。`pay_per_use` 订单金额等于所有实验一键托管价格之和；`pro` 批量提交只生成一笔 Pro 升级订单，批次内实验作为 0 元 `batch_submission` 明细记录。
- `order_items` 作为订单明细表保存套餐升级项、按实验计价项和套餐订单放行的实验项；管理员订单页不再做“时间窗口合并多订单”的前端假聚合。
- 前端所有升级套餐、一键单实验提交和一键批量提交都调用统一 checkout service，不再散落调用订单创建或 submission 创建接口。

### 自动草稿与提交历史分离

- 填写页自动保存使用独立 `submission_drafts` 当前草稿，不直接写入 `submissions.corrected_json`，避免逐字输入污染后续提交历史。
- `submissions.corrected_json` 只表示用户点击临时提交 / 正式提交前确认下来的平台提交态数据；学校提交 job 和 `submission_versions(source=platform_before_submit)` 均以该字段为准。
- `submission_versions` 继续作为不可变提交历史，只在临时提交或正式提交 job 创建前生成；自动保存、AI 识别、AI 生成和公式计算回填不生成历史版本。
- 前端采用“两层保存”：浏览器本地草稿即时落盘，后端 `submission_drafts` 防抖同步；页面恢复时比较本地和后端草稿更新时间，优先恢复更新内容。

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

- System Prompt 仍由 Admin Prompt 模板页维护，后端按 `AiPromptTemplate -> Python 默认模板` 的优先级生成识别和回答的系统指令。
- 实验级附加说明归属于实验 JSON：图像识别读取 `ai.recognition.extraPrompt`，实验思考题生成读取 `ai.generation.extraPrompt`。
- Admin Prompt 模板页可以编辑附加说明，但保存时直接写回实验 JSON 并同步 `experiments.config_json`，不写入 `ai_prompt_templates`。
- 数据库 `ai_prompt_templates` 不再保存识别或思考题的 extra prompt，避免实验配置和数据库模板同时维护同一类实验差异说明。

### AI 异步任务运行态

- 一键填空、AI 图像识别和实验思考题生成统一登记到 `ai_task_runs`，以 Celery `task_id` 作为主键。
- `audit_logs` 继续承担用户可见审计展示；`ai_task_runs` 承担任务状态机、started/finished audit 关联和 Celery 失败兜底，不把 `audit_logs.details` 当作查询索引。
- Celery `task_failure` signal 负责处理参数绑定失败等未进入业务函数体的异常，避免 started 日志长期停留在 `pending`。

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
- 一键托管预处理内的公式计算由自动化配置 `oneClick.preprocessAutoComputeEnabled` 控制，默认关闭；开启时顺序固定为固定填空 -> AI 图片识别 -> 公式计算 -> 问题生成，确保问题生成拿到识别值和计算值。
- 预处理内公式计算失败只写审计日志并继续后续步骤，不把整条预处理打失败，避免少数实验配置或缺值导致 AI 识别结果丢失。
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

## 2026-07-07

### 图片重复识别备用模型

- AI 图片识别不做同一次请求内部自动 fallback，避免一次任务中出现模型来源不透明、失败难追踪的问题。
- 对同一 `submission_id` 的重复识别采用显式切换策略：第 1 次使用主图片识别模型，第 2 次及以后在 Admin AI 设置开启后使用备用图片识别模型。
- 识别次数复用已有 `ai_task_runs` 和 `audit_logs` 统计，不新增识别尝试表；覆盖详情页直接识别、审核预处理和旧任务列表识别入口。
- 设置项保存到 `ai_config.image_recognition_retry_enabled` 与 `task_overrides_json.image_recognition_retry`。关闭开关或 task override 未启用时，重复识别继续使用主模型。

### 一键批量提交融合图片上传

- 融合上传模式由自动化配置 `oneClick.fusedImageUploadAiEnabled` 控制；学生端只读设置接口只返回布尔开关，不暴露完整自动化配置。
- 后端内部区分 AI 识别图片槽和单独上传图片槽，但图片匹配 Prompt 不暴露该分类标签。识别图片槽直接以 `slotCandidateId -> 表格序号和表格关键信息` 表达；无表格信息的单独上传槽只展示图片槽标题。模型每次只处理一张图片，只返回当前图片的槽位候选编号或空字符串，不返回图片序号、URL、实验真实 id、实验候选 id 或 DOM / 表单节点 id。
- 示波器实验当前不进入融合图片匹配候选，继续走原有单实验/人工图片匹配链路。
- 平台在模型返回后做二次映射：当前单图请求的原始 `imageIndex -> 已上传图片 URL`，`slotCandidateId -> 真实 experiment_id / slot_id`，再把归位结果作为 `checkout.submit.experiments[].image_slots` 提交。
- 自动生成曲线图等 `computedAssets` 图片槽不进入融合匹配候选，也不参与 checkout 图片槽完整性判断。
- checkout 收到完整 `image_slots` 且任务已支付 / Pro / 内部创建时直接进入审核预处理；槽位不完整时仍进入 `pending_image_assignment`，复用现有人工图片匹配流程。
- `oneClick.fusedImageAutoConfirmEnabled` 默认开启：融合上传点击自动匹配后关闭上传 modal；匹配完成后自动调用 checkout。前端按实验分别计算 `image_assignment_confirmed`：已覆盖全部实际上传槽位的实验直接进入预处理，缺槽实验保留在图片待对应状态。
- 融合上传预匹配只保留 Celery task 接口，不保留同步匹配入口；前端统一复用 `AsyncJobFloatingPanel` 和 `asyncTaskProgressProfiles.imageAutoMatch`。
- 融合上传候选实验必须由发起一键提交时的目标实验列表决定：单实验入口只传当前实验，批量入口只传当前批量目标实验，不把所有可见实验作为候选。
- 融合上传图片匹配通过“每张图片一次模型请求 + 默认最多 3 个并发请求 + Celery 真实进度”控制视觉 token；当前不设置 `image_url.detail=low`，不限制图片最长边，也不修改用户上传原图。
- 融合上传图片匹配需要保留可复查诊断，完整 JSON 直接进入 `audit_logs(action=experiment_image_auto_match).details`，并落盘到 `backend/tmp/ai_image_auto_match/{task_id}/debug_payload.json`；诊断记录 Prompt、候选、图片 URL/编号、模型原始返回和 normalize 结果，但不记录 API Key 或 base64 图片正文。
- 融合上传图片匹配允许 Admin 配置专用 OpenAI-compatible JSON override，保存于 `ai_config.task_overrides_json.experiment_image_auto_match`。启用后该任务使用 JSON 内的 `api_key/base_url/model/concurrency`，不影响普通图片识别、回答生成和验证码识别。
- 审核图片匹配进入 AI 识别 / 预处理后必须锁定：`queued/running/done` 或 `preparing_review/recognizing/reviewing/submitting/draft_submitted/completed` 不再接受图片匹配覆盖，也不允许批量 `prepare-review` 重复入队；前端显示为“已进入AI识别”，后端返回 `skipped_already_processing`。

## 2026-07-08

### 学生侧接口安全收紧

- 文件上传接口必须登录后调用；后端不再只信任 `Content-Type`，会读取文件头校验真实图片格式。
- 当前上传限制为 20MB，允许 `jpg/jpeg/png/webp/gif/bmp`，拒绝 SVG、伪图片和超大图片。
- 学生不能直接保存一键托管任务的 draft/correction/image slots，避免通过抓包污染后台审核数据；自助提交仍允许学生保存草稿和纠错。
- `/api/v1/ai/task/{task_id}` 对学生按 `ai_task_runs.user_id` 校验归属；未知 task id 对学生返回 404，防止通过 task id 横向读取 AI 结果。
- `/uploads` 静态公开挂载已取消。数据库和 submission 中仍保留 `/uploads/...` 作为内部文件引用路径；浏览器预览统一通过 `GET /api/v1/files/view?path=...` 鉴权读取 blob，后台 AI / 学校自动化继续使用本地路径解析，不改变任务数据格式。

### 学校报告截图展示

- 查看学校系统提交情况使用独立 `school_report_screenshot` automation job，不复用详情同步快照，避免为了截图而读取/回填学校 DOM 节点。
- 前端只拿 public job id 和鉴权后的截图二进制；截图真实路径仅保存在 `automation_jobs.result_payload`，`GET /api/v1/automation-jobs/{job_id}/screenshot` 会校验当前用户可见 job 且截图路径位于该 job artifact 目录内。
- 学生截图任务始终使用当前登录学生自己的学校身份；admin / reviewer 只能通过 submission 级接口由后端反查目标学生身份。
- Admin 同学管理页的“查看所有提交截图”使用独立 `school_submission_screenshots` job，先读取学校完成报告列表，只对 `school_draft_submitted` / `school_final_submitted` 实验截图；结果接口不返回真实路径，截图文件通过 admin 专用鉴权 endpoint 读取。
- 学生 Dashboard 和我的实验页可以触发自己的完整性检查 / 截图任务，但学生接口不接受 `student_id`，后端始终绑定 `actor_user_id=current_user.id`；单实验入口只额外接收 `experiment_id` 并校验实验启用。

### 自动化任务页中的 Playwright 会话管理

- 学校系统浏览器会话继续由后端内存中的 `school_session_manager` 管理，不落库；页面只显示当前后端进程保留的会话。
- 管理入口限定为 admin，接口放在 `/api/v1/automation-jobs/school-browser-sessions` 下，复用现有自动化任务鉴权边界。
- 自动化任务页拆成两类操作：活跃自动化任务表负责终止数据库中的 job；Playwright 浏览器会话表负责诊断、关闭单个会话和关闭全部会话。关闭操作写入 `audit_logs`，用于处理 headless 模式下无法手动关闭浏览器窗口导致的资源占用问题。
- 关闭会话不主动取消数据库中的 automation job；如果任务仍在运行，后续轮询会按现有浏览器关闭/任务失败逻辑处理。
- 后端重启按钮复用该 admin 管理页，接口只做当前 backend 进程延迟退出，不调用宿主机 Docker 命令；自动恢复依赖 `docker-compose.yml` 中 backend 的 `restart: unless-stopped`。

### 已评分学校状态

- 学校报告列表中“状态”列可能仍显示“正常提交”，但“成绩”列已有数字且“完成报告”按钮不可打开；因此状态识别优先级改为成绩列优先。
- `score` 有数字时统一映射为 `school_graded`，前端展示 `已评分：{score}`，使用提示态叹号，不当作成功或失败色。
- `school_graded` 计入完成统计；完整性检查和提交截图不再点击完成报告，直接跳过并说明已评分导致不可打开。

### 数据合理性检查规则

- 实验配置新增顶层 `scoreCheck`，与 `formulas` 分离：`formulas` 负责一键计算和回填，`scoreCheck` 只负责后端读取当前页面已有值并给出可检查项得分。
- `scoreCheck.items` 只写可计算或教师 HTML 明确给出数值区间/关系的规则；文本、图片、主观分析等规则不写入自动检查，避免伪造评分能力。
- 数据合理性检查不复用一键计算能力，不触发公式依赖求值，不生成曲线图，不修改表单值。
- 普通实验配置接口只返回 `scoreCheck` 摘要，防止前端暴露标准值、区间和公式；完整规则仅 admin raw-config 管理接口可见。
- 功能入口和接口权限暂限定为 `admin` / `reviewer`，学生端不展示按钮，学生直接调用接口返回 `403`。
- 对只有材料/物性典型量级、但教师 HTML/PPT 未明确参考值的项目，使用独立 `referenceValueCheck`，不与 `scoreCheck` 混写，不计入可检查得分。
- `referenceValueCheck` 对 admin 返回典型参考值、单位和来源说明；非 admin 只返回偏差等级和原因。前端展示为“按典型参考值检查”，明确标注不计入学校评分。
- 明确写在教师 HTML / 实验配置题干中的有效数字或小数位要求可以进入数据合理性检查：有明确分值区间的项写入 `scoreCheck.requiredSignificantDigits` / `requiredDecimalPlaces`，作为满分条件；只有格式要求、没有明确分值或参考区间的项写入 `referenceValueCheck` 的格式提示，不计入学校评分。
