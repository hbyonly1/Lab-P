# 真实学校系统接入与数据同步实施计划

本文档用于把“真实学校实验报告系统接入”从方案草案推进为可执行、可验证、可追踪的实施路线。实现时必须继续遵守 `docs/STATE_MACHINE.md`、`docs/API_CONTRACT.md`、`docs/CAPABILITIES.md` 和 `docs/EXPERIMENT_JSON_SCHEMA_AND_FRONTEND_GUIDE.md` 中已确定的状态、权限、能力和配置约束。

当前优先服务完整提交 / Pro 全托管链路，但所有基础设施应同时兼容 Free / Plus 自主提交流：

```text
学生上传图片或编辑实验数据
  |
后端保存当前 Submission 数据
  |
必要时登录学校系统抓取真实状态
  |
AI 识别 / 计算 / 生成后立即落库
  |
Reviewer 或 Admin 审核并修正
  |
Playwright 按动态配置填报学校系统
  |
临时保存或正式提交
  |
截图、日志、审计记录和状态回写
```

## 1. 已确认技术决策

### 1.1 自动化方式

- 使用 Playwright 进行真实 DOM 点击、输入、上传图片和按钮提交。
- 禁止将学校系统关键 DOM 节点写死在 Worker 代码中。
- Worker 从后端配置读取登录页、验证码、实验列表、临时保存按钮、正式提交按钮、反馈提示等选择器。
- 自动化选择器和 Playwright 运行参数先以 Admin 可见、可编辑的 JSON 文本配置保存，不为每一个按钮或选择器单独做设置栏。
- 本计划阶段只定义配置结构、权限、审计和页面形态；暂不写具体 Playwright 脚本，具体脚本在后续实现阶段再单独设计。
- 实验字段级填报继续使用 `dom_mappings.mapping_json` 与 V2 实验配置中的 `automation` 模块。

### 1.2 异步任务架构

- 后端使用 FastAPI 承接 API 请求。
- Redis + Celery 负责学校系统同步、AI 识别、AI 生成、Playwright 临时保存和正式提交等耗时任务。
- 关键用户操作接口可以采用两种返回策略：
  - 强同步：等待任务完成后返回，用于前端必须立即知道结果的动作。
  - 异步排队 + 前端轮询：接口返回 job id，前端轮询 `Submission.status` 和 automation job 结果。
- 具体接口策略必须在 `docs/API_CONTRACT.md` 中逐条声明，避免同一个端点在前端被误用。

### 1.3 验证码处理

- Playwright 必须定位验证码图片的具体 DOM 节点并截图，不使用全屏截图裁剪。
- 验证码图片交由平台 AI 模块识别。
- 登录错误需要分类：
  - 验证码错误：可按配置重试，例如最多 3 次。
  - 账号 / 密码错误：直接终止，并记录明确错误。
  - 超时 / 网络 / 封控：按自动化错误重试策略处理。
- 每次登录尝试必须写入结构化日志，不得包含敏感凭据。

### 1.4 密码策略

- 当前 SQL 表结构中 `users` 只有 `username`，没有 `name` 字段。现状里 `username` 是平台登录名，对学生曾被临时复用为学号，但对 admin / reviewer 则只是平台账号。
- 后续真实学校系统接入时，必须把“平台登录名”“学号”“真实姓名”拆清楚，不能继续让 `username` 同时表达所有含义。
- 建议新增 `users.student_no` 保存学生学号，作为登录学校系统的账号；admin / reviewer 可为空。
- 建议新增 `users.real_name` 保存从学校系统同步到的真实姓名，只用于展示、同步校验或人工核对，不能当作学校系统登录账号或密码。
- 当前学校系统密码策略为：平台登录密码与学校实验系统密码统一；登录学校系统时账号使用 `student_no`，密码使用解密后的 `users.encrypted_school_password`。
- 不兼容现有脏数据；如果本地库里有旧数据导致约束或字段语义冲突，直接清表或重建数据库，再按新 migration 初始化。
- 学校密码不能由学号派生；学生首次登录平台时，后端保存平台密码哈希，并额外保存一份加密后的学校系统密码供 Playwright 使用。
- 若未来学校系统密码策略改变，必须更新加密凭据字段使用方式，并同步 `DECISIONS.md` 与 `API_CONTRACT.md`。
- 后端、日志、审计记录和前端响应均不得返回明文学校密码。

### 1.5 审计日志

以下操作必须写入 `audit_logs`：

- 学校系统登录和周期性同步。
- AI 识别、AI 生成、DAG 计算等核心 AI / 算力动作。
- 临时保存、正式提交、自动化重试、自动化失败。
- Admin 确认支付、驳回支付、分配 Reviewer、修改自动化配置、修改实验配置。
- Reviewer 保存纠错、完成审核、触发提交。

审计日志至少包含：

```text
actor_user_id
actor_role
action
target_type
target_id
submission_id
experiment_id
request_payload
result_payload
status
error_code
error_message
started_at
finished_at
retry_count
created_at
```

敏感字段必须脱敏或排除，例如学校系统密码、API Key、验证码原图的可公开 URL。

## 2. 目标状态

### 2.1 学生侧

- 学生登录后能进入自己的实验列表和实验详情页。
- 学生账号必须有明确的 `student_no`，用于学校系统登录和任务归属展示。
- 学生能上传实验图片，上传结果绑定到自己的 `Submission`。
- 学生能触发 AI 识别、固定参数填充、公式计算和问题答案生成，结果立即保存到当前 `Submission.corrected_json` 或对应结构字段。
- 学生点击“临时保存”或“正式提交”后，后端按套餐能力和状态机检查权限，再触发 Playwright 自动化。
- 学生只能查看自己的状态、截图、错误信息和提交结果。

### 2.2 Reviewer 侧

- Reviewer 只能查看分配给自己的审核任务。
- Reviewer 能对照图片和识别结果保存 `corrected_json`。
- Reviewer 完成审核后，任务才能进入自动化提交节点。
- Reviewer 不能修改订单、支付状态、系统配置和其他 Reviewer 的任务。

### 2.3 Admin 侧

- Admin 能通过 JSON 文本配置自动化引擎基础选择器和 Playwright 运行参数。
- Admin 能管理实验配置、DOM 节点表、Prompt、订单和任务。
- Admin 高风险动作必须二次确认，并写入审计日志；普通 JSON 配置保存不再弹出二次确认框，保存成功后依赖后端校验和审计日志追踪。
- Admin 能查看自动化任务日志、失败原因、截图和重试记录。

## 3. 数据模型补充

在现有第一版核心表基础上，真实接入学校系统需要逐步补充以下表或字段。字段落地时必须通过 Alembic migration 管理。

### 3.1 automation_engine_configs

保存学校系统基础自动化配置。建议只允许 Admin 查看和修改。第一版不把每个选择器拆成独立字段，而是使用 JSON 承接，避免学校系统页面频繁变化时反复改表。

```text
id
name
config_json
schema_version
is_active
created_by
updated_by
created_at
updated_at
```

`config_json` 示例结构：

```json
{
  "schoolSystem": {
    "baseUrl": "https://school.example.edu",
    "loginUrl": "https://school.example.edu/login"
  },
  "identity": {
    "studentNoField": "users.student_no",
    "realNameField": "users.real_name",
    "passwordPolicy": "encrypted_user_password"
  },
  "selectors": {
    "login": {
      "username": "#username",
      "password": "#password",
      "captchaImage": "#captcha-img",
      "captchaInput": "#captcha",
      "submitButton": "button[type='submit']",
      "successSignal": ".student-home",
      "errorMessage": ".login-error"
    },
    "navigation": {
      "experimentList": ".experiment-list"
    },
    "submission": {
      "draftButton": "button[data-action='draft']",
      "officialButton": "button[data-action='submit']",
      "feedback": ".submit-result"
    }
  },
  "syncPolicy": {
    "syncCooldownSeconds": 1800
  },
  "retryPolicy": {
    "captchaMaxRetries": 3,
    "networkMaxRetries": 2
  },
  "runtime": {
    "headless": true,
    "defaultTimeoutMs": 30000
  }
}
```

说明：

- `config_json` 中只能保存选择器、运行参数、重试策略和学校系统入口等配置。
- `config_json` 不保存具体 Playwright 脚本代码。
- `passwordPolicy: encrypted_user_password` 表示学校系统密码来自 `users.encrypted_school_password` 解密结果；`real_name` 只用于展示和同步核对。
- Admin 页面应提供 JSON 格式校验，保存后写入 `audit_logs`；保存配置按钮直接提交，不再弹出二次确认框。

### 3.2 submission_versions

保存临时提交或正式提交前的完整数据快照。AI 识别、AI 生成和自动保存不生成历史版本。

```text
id
submission_id
version_no
source
snapshot_json
school_snapshot_json
created_by
created_at
```

`source` 示例：

```text
draft_submit
official_submit
admin_submit
reviewer_submit
school_sync
```

### 3.3 automation_jobs

记录每次 Playwright 执行。

```text
id
submission_id
experiment_id
actor_user_id
action
status
attempt
max_attempts
request_payload
result_payload
error_code
error_message
screenshot_keys
started_at
finished_at
created_at
updated_at
```

`action` 示例：

```text
school_sync
draft_submit
official_submit
```

`status` 示例：

```text
queued
running
succeeded
failed
cancelled
```

### 3.4 school_sync_snapshots

保存从学校系统抓取到的真实数据，用于冲突对比与页面版本选择。

```text
id
user_id
submission_id
experiment_id
snapshot_json
summary_json
synced_at
automation_job_id
created_at
```

## 4. 后端接口补充

以下接口是实施计划需要补进 `API_CONTRACT.md` 的目标接口；编码前应先补齐正式请求体、响应体和权限规则。

### 4.1 自动化配置

```text
GET   /api/v1/admin/automation-config
PATCH /api/v1/admin/automation-config
```

权限：

- 仅 `admin` 可访问。
- 修改配置必须写入 `audit_logs`。
- 第一阶段暂不实现 `POST /api/v1/admin/automation-config/test-login`。这个名字原本表示“保存配置后用受控测试账号跑一次学校系统登录连通性检查”，但它会提前引入具体 Playwright 登录脚本，因此先从近期接口中移除。
- 后续如果需要配置校验接口，建议命名为 `POST /api/v1/admin/automation-config/validate-login`，并明确它只做受控连通性检查，不提交实验、不修改业务状态、不记录明文密码。

### 4.2 学校系统同步

```text
POST /api/v1/submissions/{id}/sync-school
GET  /api/v1/submissions/{id}/school-snapshots
```

权限：

- `student` 只能同步自己的 submission。
- `reviewer` 只能读取分配给自己的任务所需快照。
- `admin` 可同步和查看全部。
- 冷却时间内重复同步应返回最近快照或明确提示。
- 同步成功后可回填 `users.real_name`，但不得覆盖 `student_no`。

### 4.3 版本选择

```text
GET  /api/v1/submissions/{id}/versions
POST /api/v1/submissions/{id}/versions/apply
```

规则：

- 版本应用只覆盖当前平台编辑页数据，不直接提交学校网站。
- 应用版本后更新 `corrected_json` 或对应结构字段，并写入审计日志。
- 学校系统版本必须来自 `school_sync_snapshots`，本地历史版本必须来自 `submission_versions`。

### 4.4 自动化提交

```text
POST /api/v1/submissions/{id}/draft-submit
POST /api/v1/submissions/{id}/official-submit
GET  /api/v1/submissions/{id}/automation-jobs
```

规则：

- 所有提交动作必须先按 `STATE_MACHINE.md` 校验状态。
- 触发前生成 `submission_versions` 快照。
- Free / Plus / Pro 能力差异按 `CAPABILITIES.md` 校验。
- 单次代劳或完整模式必须校验订单已支付。
- 接口必须支持幂等键，防止重复点击创建多个自动化任务。

## 5. 前端页面补充

### 5.1 Admin 自动化引擎配置页

路径建议：

```text
/workspace/admin/automation-config
```

页面能力：

- 页面主体使用现有 `PageHeading` + `UiPanel`，不新建一套独立视觉规范。
- 使用一个 JSON 文本编辑区维护学校系统基础 URL、登录 URL、关键选择器、重试次数、同步冷却时间和 Playwright 运行参数。
- JSON 编辑区使用 Ant Design `Input.TextArea`，可设置等宽字体，但控件圆角、边框、focus 和高度规范沿用现有 `ui.css` 与 `/workspace/admin/design-system`。
- 不为登录按钮、验证码、提交按钮等每个选择器单独做一个设置栏。
- 选择器与 Playwright 配置信息仅 Admin 可见、可设置。
- 保存前做 JSON 格式校验、必填路径校验和敏感字段检查。
- 保存时先做 JSON 格式校验，校验通过后直接提交保存。
- 暂不提供“测试登录”按钮，避免在计划阶段提前绑定具体 Playwright 脚本；后续如实现 `validate-login`，再补充对应按钮。
- 显示最近一次配置修改人、修改时间和审计日志入口。

UI 要求：

- Modal 结构参考已完成的 `ProSubmitModal`、`PaywallModal`、`UpgradePlanModal`：使用 Ant Design `Modal`，宽度按内容控制，不自造弹窗框架。
- 表单使用 Ant Design `Form`、`Input.TextArea`、`Button`，按钮和输入控件遵守控件规范里的 8px 圆角、统一 hover/focus 和禁用 loading 态。
- 配置保存成功提示优先使用现有 message 模式；危险操作仍按需使用现有 Modal，不新增大面积自定义 CSS。
- 主操作按钮优先复用现有 `GoldButton` 或项目内已经使用的 primary button 样式，普通操作使用 AntD `Button` 或现有 `OutlineButton`。

### 5.2 实验详情页版本冲突 Modal

触发条件：

- 学校系统同步快照与当前 `Submission` 数据不一致。
- 用户进入实验详情页或手动点击同步后检测到差异。

UI 要求：

- 顶部选项为“学校系统版本”。
- 下方为“本地历史版本”，展示版本来源、保存时间、操作者和提交类型。
- 底部红字提示：`仅覆盖当前页面，不提交学校网站`。
- 用户选择版本后只覆盖当前平台编辑数据，并通过后端接口保存。

### 5.3 自动化任务状态展示

学生、Reviewer 和 Admin 均应能在各自权限范围内看到：

- 当前 `Submission.status`。
- 最近一次自动化动作。
- 成功 / 失败结果。
- 错误分类。
- 截图缩略图或附件入口。
- 重试状态和下一步操作。

Admin 可额外看到：

- Worker attempt。
- 选择器版本。
- 审计日志入口。
- 手动重试按钮。

## 6. 分阶段实施路线

### 阶段 0：文档和契约收口

目标：在写后端前消除接口、状态机和能力边界的不一致。

任务：

- 更新 `API_CONTRACT.md`，补齐自动化配置、学校同步、版本选择和自动化提交接口。
- 更新 `STATE_MACHINE.md`，明确 `pending_recognition`、`reviewing`、`submitting`、`completed`、`error` 的进入条件。
- 更新 `DECISIONS.md`，记录“当前 `users.username` 是平台账号且曾被学生学号复用，后续新增 `student_no` / `real_name` 拆分语义；不兼容旧数据，必要时清表重建”“学校系统账号为学号、密码来自加密保存的用户登录密码、真实姓名仅用于展示与核对”“验证码节点截图识别”“自动化配置以 Admin JSON 文本外置”。
- 更新 `TASK_BREAKDOWN.md`，把真实学校系统接入拆成可执行任务。

验收：

- 每个新增接口都有请求体、响应体、权限、状态变化和失败码。
- 文档中不存在同一动作既强同步又异步轮询的矛盾描述。
- 前端 mock 字段与 API contract 一致。

### 阶段 1：后端配置与审计底座

目标：先让系统能保存配置、记录日志、表达自动化任务。

任务：

- 新增 Alembic migration：`users.student_no`、`users.real_name`、`automation_engine_configs`、`automation_jobs`、`submission_versions`、`school_sync_snapshots`。
- 不做旧数据回填；本地已有数据如不满足新结构，直接清表或重建数据库。
- 实现 Admin 自动化配置 API。
- `automation_engine_configs` 第一版使用 `config_json` 保存选择器和运行参数，不拆成大量选择器字段。
- 实现统一 `audit_logs` 写入 helper。
- 实现自动化任务创建、状态更新和查询接口。
- 增加权限校验：仅 Admin 可修改自动化配置。

验收：

- Admin 能保存并读取自动化 JSON 配置。
- 非 Admin 不能查看自动化选择器和 Playwright 配置信息。
- 保存配置前能发现 JSON 格式错误和明显缺失的必填配置。
- 修改配置会产生审计日志。
- 非 Admin 请求配置修改接口返回 403。
- 自动化 job 可创建、查询并记录状态。

### 阶段 2：Playwright 登录与验证码识别

目标：Worker 能稳定登录学校系统，并能区分主要失败类型。

注意：本阶段开始前才设计和编写具体 Playwright 登录脚本；阶段 0 和阶段 1 不写具体脚本。

任务：

- 搭建 Celery Playwright Worker 入口。
- 根据 `automation_engine_configs` 读取登录选择器。
- 账号只使用 `users.student_no` 中的学号。
- 学校系统密码按 `passwordPolicy: encrypted_user_password` 从 `users.encrypted_school_password` 解密取得。
- `users.real_name` 仅用于同步后的真实姓名展示和人工核对，不参与登录。
- 对验证码图片节点截图并调用 AI 识别模块。
- 实现验证码错误、账号密码错误、超时网络错误分类。
- 保存登录过程日志、错误摘要和必要截图。

验收：

- 使用测试账号能完成一次真实登录。
- 验证码失败时按配置次数重试。
- 账号密码错误不会无意义重试。
- 日志和审计记录不包含学校密码。

### 阶段 3：学校系统周期性同步

目标：登录后抓取学校系统真实姓名、实验概览和实验详情数据。

任务：

- 实现 `sync-school` API 和 Celery 任务。
- 增加同步冷却时间检查。
- 抓取真实姓名并更新 `users.real_name`。
- 抓取已正式提交实验数、未完成实验、每个实验的详情数据。
- 将抓取结果保存到 `school_sync_snapshots`。
- 在实验详情页接入手动同步入口。

验收：

- 冷却时间内重复同步不会重复触发学校系统登录。
- 同步成功后能在 Admin / Student 权限范围内查看摘要。
- 抓取失败时 `Submission.status` 不被错误推进。
- 同步任务写入审计日志。

### 阶段 4：冲突检测与版本选择

目标：解决学校系统数据、平台当前数据和历史提交版本之间的冲突。

任务：

- 实现数据差异检测。
- 实现 `versions` 查询和 `versions/apply` 接口。
- 临时提交和正式提交前生成 `submission_versions`。
- 前端实验详情页弹出版本选择 Modal。
- 选中版本后仅覆盖平台编辑页数据，不触发学校系统提交。

验收：

- 学校系统版本和本地历史版本可区分展示。
- AI 识别中间状态不会出现在历史版本列表。
- 应用版本后页面数据刷新，学校网站不会被提交。
- 版本应用动作写入审计日志。

### 阶段 5：AI 结果持久化与审计

目标：AI 识别、固定填空、问题生成和 DAG 计算结果不会因刷新丢失，并且可追踪。

任务：

- AI 识别完成后更新当前 `Submission` 数据字段。
- 简答题生成和公式推导完成后同步保存结果。
- 统一 AI 请求与响应审计 payload。
- 失败时保留错误码和用户可读提示。

验收：

- 用户刷新页面后仍能看到 AI 处理结果。
- AI 动作不生成 `submission_versions`。
- 审计日志包含目标实验、请求摘要、结果摘要和执行状态。
- 前端不能提交 Prompt、公式或价格等可信字段。

### 阶段 6：临时保存自动化流水线

目标：点击“临时保存”时，平台能把当前数据写回学校系统但不正式提交。

任务：

- 实现 `draft-submit` API。
- 校验套餐能力、任务归属、订单状态和 submission 状态。
- 生成 `submission_versions` 快照。
- 创建 `automation_jobs(action=draft_submit)`。
- Worker 登录学校系统，按 `dom_mappings` 和 `corrected_json` 填报。
- 点击学校系统临时保存按钮。
- 保存截图、结果反馈和审计日志。

验收：

- 未授权用户不能触发他人任务提交。
- 未支付的单次代劳任务不能提交。
- 成功后状态按 `STATE_MACHINE.md` 更新。
- 失败后状态进入 `error` 或保留可重试状态，并展示失败原因。

### 阶段 7：正式提交自动化流水线

目标：审核完成或学生确认后能触发正式提交，并形成完整证据链。

任务：

- 实现 `official-submit` API。
- 完整性校验：按实验配置和 DOM 映射检查必填项。
- 防重复提交：前端 loading 锁 + 后端幂等键 + 数据库状态锁。
- Worker 填报后点击学校系统正式提交按钮。
- 捕获学校系统反馈、最终截图和结果。
- 更新 `Submission.status` 为 `completed` 或 `error`。

验收：

- 同一 submission 并发提交只会创建一个有效 automation job。
- 正式提交前必填项缺失会返回明确错误。
- 成功提交后学生可查看结果截图。
- 失败任务 Admin 可在后台查看详情并按规则重试。

### 阶段 8：后台监控、重试与运维

目标：让真实接入后的失败可定位、可恢复、可追责。

任务：

- Admin 增加自动化任务监控页。
- 支持按 submission、学生、实验、状态、错误码筛选。
- 支持受控重试失败任务。
- 重试前重新校验状态和订单。
- 展示关联审计日志、截图和错误摘要。

验收：

- Admin 能定位最近失败的 Playwright 任务。
- 重试不会绕过状态机和支付规则。
- 每次重试均生成新的 automation job 和审计记录。

## 7. 权限和安全红线

- 前端隐藏按钮不等于权限控制，所有接口必须服务端鉴权。
- `student` 只能访问自己的订单、任务、文件、截图和结果。
- `reviewer` 只能访问分配给自己的任务，不能修改支付、套餐和系统配置。
- `admin` 修改配置、确认支付、重试提交、分配任务必须写审计日志。
- 后端不能信任前端传入的 `price`、`payment_status`、`role`、`user_id`、`order_id`、`submission_id` 所属关系。
- 学校密码、API Key、验证码原图敏感地址不得进入日志、审计 payload 或前端响应。
- Playwright 自动提交必须经过状态机、订单支付、套餐能力、必填项和幂等检查。

## 8. 验证策略

### 8.1 文档验证

- 检查 `implementation_plan.md`、`API_CONTRACT.md`、`STATE_MACHINE.md`、`DECISIONS.md` 对同一状态和接口描述一致。
- 检查新增字段是否都有 migration 和 API contract。

### 8.2 后端验证

- 单元测试：权限、状态机、价格和支付状态校验。
- 集成测试：订单支付后进入识别 / 审核 / 自动化节点。
- Worker 测试：登录重试、验证码失败、选择器缺失、网络超时。
- 安全测试：学生越权访问他人 submission、Reviewer 修改支付、伪造 user_id。

### 8.3 前端验证

- `npm run build`。
- Student：上传、同步、版本选择、临时保存、正式提交状态展示。
- Reviewer：任务领取 / 保存纠错 / 完成审核。
- Admin：自动化配置保存、测试登录、任务监控、失败重试。

### 8.4 真实系统联调

- 使用测试学生账号完成登录。
- 同步一次实验概览。
- 对一个低风险实验执行临时保存。
- 确认截图、学校系统页面数据、平台状态和审计日志一致。
- 正式提交只在明确允许的测试任务上执行。

## 9. 当前最小下一步

为了保持垂直切片可运行，建议按以下顺序推进：

1. 先补 `API_CONTRACT.md` 中用户身份字段、自动化配置、学校同步、版本选择、自动化提交接口，并暂不加入 `test-login`。
2. 实现 `users.student_no`、`users.real_name`、自动化配置表、automation job 表和审计日志 helper，其中自动化配置第一版使用 Admin JSON 文本。
3. 做 Admin 自动化配置页，先接真实后端保存和读取，UI 复用现有 Modal 和控件规范。
4. 如本地库已有旧数据且阻塞验证，直接清表或重建数据库。
5. 再开始设计 Playwright 登录脚本，验证“账号=student_no、密码=student_no”和验证码节点截图识别。
6. 接学校系统同步和实验详情页版本冲突 Modal。
7. 最后接临时保存与正式提交流水线。

## 10. 完成定义

本计划对应功能只有同时满足以下条件才算完成：

1. 接口、状态机、数据表、权限和审计日志文档已同步。
2. Alembic migration 能从空库创建所需结构。
3. 后端权限测试覆盖 student / reviewer / admin 的关键越权场景。
4. Playwright Worker 能使用配置完成登录、同步和至少一次临时保存。
5. 自动化执行有截图、错误摘要、重试记录和审计日志。
6. 前端能在对应角色页面展示状态、版本选择、自动化结果和失败原因。
7. 已明确哪些动作是临时保存，哪些动作会正式提交学校系统。
