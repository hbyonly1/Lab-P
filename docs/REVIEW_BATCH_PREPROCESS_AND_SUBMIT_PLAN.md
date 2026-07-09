# 审核批量匹配、AI 预处理与学校提交链路方案

## 1. 背景

当前完整提交模式的目标链路是：

```text
学生傻瓜式上传实验图片
  -> 创建一键提交审核任务
  -> 管理员 / 审核员整理图片与实验图片槽位关系
  -> 系统自动固定填空、AI 识别表格、生成问题回答
  -> 管理员 / 审核员审核识别结果并人工触发一键计算
  -> 管理员 / 审核员触发临时提交或正式提交到学校系统
  -> 后端使用该学生的学校账号会话完成回填、校验、提交和状态确认
```

现状中，学生一键提交后只保存 `Submission.image_paths` 扁平图片列表。后端不知道哪张图对应哪个实验图片控件，也不知道哪些图片应该传给 AI 识别，哪些只是学校系统图片答案。因此多图片实验不能直接可靠识别。

本方案保留学生端的傻瓜式上传体验，把图片匹配交给管理员 / 审核员处理，并把匹配后的批量预处理和学校提交链路打通。

## 2. 设计原则

- 学生端保持简单：学生只上传图片，不负责判断图片对应哪个实验、哪个控件。
- 管理端负责匹配：管理员 / 审核员在审核任务页按批次整理图片到实验图片槽。
- 审核详情页继续复用学生实验详情页，保持表单、图片控件、计算、提交交互一致。
- AI 识别只读取匹配后的识别图片槽，不再对整批图片盲识别。
- 自动预处理只做固定填空、图片识别和问题回答生成；计算仍由管理员审核识别值后手动点击一键计算。
- 学校提交必须使用 submission 所属学生的学校账号和加密学校密码，不使用管理员账号登录学校系统。
- 临时提交和正式提交共用同一提交链路，但正式提交属于高风险动作，必须保留二次确认和审计。

## 3. 现状结论

### 3.0 当前落地状态

已落地的基础设施：

- `submissions.submission_batch_id` 用于把一次批量提交的多个实验聚合到同一审核批次。
- `submissions.image_slots` 用于保存管理员 / 审核员完成的图片匹配结果。
- `submissions.preprocess_status`、`submissions.preprocess_error` 用于记录预处理进度和失败原因。
- 一键托管提交创建后默认进入 `pending_image_assignment`，不再依赖 `AiConfig.auto_recognize` 盲识别。
- `PATCH /api/v1/submissions/{submission_id}/image-slots` 保存单个实验图片匹配。
- `POST /api/v1/submissions/batches/{batch_id}/prepare-review` 批量保存匹配并启动预处理。
- `prepare_submission_for_review_task` 已复用 `ai_service.get_fixed_fill()`、`ai_service.recognize_images()`、`ai_service.generate_answers()`，结果写回 `submission.recognition_json`。
- 自动化配置 `syncPolicy` 已新增 `autoLoadDetailForStudent` 和 `autoLoadDetailForInternalUser`，设置页提供独立开关。
- `GET /api/v1/school-sync/settings` 给实验详情页返回当前用户是否应自动加载学校详情数据。
- 审核任务页已按 `student + submission_batch_id` 聚合展示，批次行提供“图片匹配 / 批量预处理”入口。
- `ReviewBatchImageAssignmentModal` 已提供第一版图片池、配置槽位、点击放入、拖拽放入、已使用标记、预览、移除和真实旋转重新上传。
- 审核详情页已优先使用 `submission.image_slots` 回填图片控件，并从 `corrected_json.values` / `recognition_json` 解包表单初始值。

仍待继续落地：

- 批量预处理进度第一版目前通过 submission 状态字段表达；如需要统一浮窗进度，再升级为 public job 记录。
- 匹配弹窗后续可继续增强跨实验图片池、键盘操作和更完整的缩放平移预览体验。

### 3.1 审核任务聚合现状

`ReviewerTasksPage` 当前已经把 `GET /api/v1/submissions/review-pool` 返回的 submission 按 `student_username` 聚合展示，但不是按一次提交批次或订单聚合。

当前缺口：

- 后端 `review-pool` 返回扁平 submission，没有 batch 信息。
- 前端只知道某个学生有若干实验任务，不能区分“同一次一键提交的 6 个实验”和“不同时间提交的多批任务”。
- Admin 订单页已有 10 秒窗口聚合 pay-per-use 订单的展示逻辑，但审核任务页没有真正的提交批次字段。

### 3.2 图片数据现状

当前 submission 只保存：

```json
{
  "image_paths": ["/uploads/2026-07/a.jpg", "/uploads/2026-07/b.jpg"]
}
```

前端一键提交弹窗内部其实有 `batchImageSlots[experimentId][slotId]`，但提交时被摊平成 `image_paths`，槽位信息丢失。

### 3.3 AI 预处理现状

当前 `AiConfig.auto_recognize` 默认值是 `false`。提交接口中只有当它被手动开启时，才会在创建 submission 后自动触发 `recognize_submission_task`。

这个开关应暂时保留为关闭或内部调试状态，不应作为新完整提交链路的默认入口。原因是当前自动识别链路仍然依赖扁平 `submission.image_paths`，没有管理员图片匹配步骤；多图片实验会出现“图片不知道归哪个控件”的问题。

如果 `AiConfig.auto_recognize=true`，现有后端会触发 `recognize_submission_task`：

- 读取 `submission.image_paths`
- 调用 AI 图片识别
- 根据识别结果生成问题回答
- 写入 `submission.recognition_json`
- 状态改为 `reviewing`

缺口：

- 没有自动固定填空。
- 没有图片匹配，识别图片来源不可靠。
- 生成回答只基于识别结果，不一定包含固定填空、计算结果或人工修正值。
- 计算不应自动执行，需要管理员审核识别数据后手动触发。

新链路不直接扩大 `auto_recognize` 的职责，而是在管理员完成图片匹配后，由批量预处理入口显式触发。也就是说：

```text
auto_recognize=false       默认保持关闭，避免提交后盲识别
图片匹配确认按钮           新链路的预处理触发点
prepare_review job         固定填空 + 匹配图片识别 + 问题回答生成
```

### 3.4 已有 AI 能力复用现状

学生实验详情页已经具备三类 AI/计算辅助能力：

```text
POST /api/v1/ai/fixed-fill/{experiment_id}
POST /api/v1/ai/recognize-direct
POST /api/v1/ai/generate-answer-direct
POST /api/v1/experiments/{experiment_id}/compute
```

这些接口背后已经沉淀了可复用的服务能力：

```text
ai_service.get_fixed_fill()
ai_service.recognize_images()
ai_service.generate_answers()
experiments.compute_experiment_data 的公式计算逻辑
```

新预处理链路不能重写一套固定填空、图片识别或回答生成逻辑。应优先复用这些已有服务，只新增“把结果合并并写入 submission”的编排层。

需要注意：

- 学生侧 direct API 当前主要服务页面交互，返回 `task_id` 或结果给浏览器。
- 审核批量预处理需要把结果持久化到 `submission.recognition_json`，因此后端更适合复用这些 API 背后的 service 函数，而不是在 worker 内再通过 HTTP 调用自己。
- 计算能力也已经存在，但新预处理阶段不自动计算；管理员确认识别数据后继续在审核详情页人工点击“一键计算”。

### 3.5 学校详情自动加载现状

学生进入实验详情页时，当前前端会自动尝试启动 `school_detail_sync`，把学校系统已有填写内容回填到平台页面。

当前行为要调整为可配置：

- 学生端是否打开实验详情时自动加载学校数据，可单独配置。
- admin / reviewer 打开审核详情或学生实验详情时是否自动加载学校数据，可单独配置。
- 默认建议学生端开启或沿用当前行为，admin / reviewer 默认关闭，避免管理员审核任务时意外触发学校系统会话。

这类配置属于学校自动化行为，不属于 AI 配置。建议落在自动化配置 `syncPolicy` 下，并在设置页提供开关。

### 3.6 学校提交现状

`POST /api/v1/school-sync/experiments/{experiment_id}/submit` 已经支持 one-click handoff 任务由 admin / reviewer 触发。后端提交 job 中会读取：

```python
user = session.get(User, submission.student_id)
```

也就是说，虽然动作由管理员 / 审核员发起，学校系统登录和浏览器会话应归属于 submission 的学生。学校登录账号使用 `users.student_no`，密码使用 `users.encrypted_school_password` 解密后的学校密码。

需要继续保证：

- 学校密码不返回前端。
- 学校密码不写入日志、audit details、automation job public DTO。
- 提交前保存平台快照。
- 回填后逐字段校验，失败时停止点击学校提交按钮。
- 临时提交成功落为 `draft_submitted`。
- 正式提交成功落为 `completed`。

## 4. 目标用户体验

### 4.1 学生端

学生一键提交时只看到现有批量上传弹窗：

```text
左侧：实验列表
右侧：该实验的大图片上传区域
```

学生不需要把图片拖进具体控件，只要把该实验相关图片上传进去即可。

提交后，学生看到任务进入后台审核队列。

### 4.2 审核任务页

审核任务页建议从“按学生聚合”升级为“按学生 + 提交批次聚合”：

```text
学生 A
  批次 BATCH-20260706-XXXX  6 个实验  待图片匹配
    电表的改装
    声速测量
    钢丝杨氏模量
    ...
```

批次行增加主操作按钮：

```text
图片匹配 / 批量预处理
```

如果没有真实 `submission_batch_id` 的旧数据，可以临时按同一学生、相近创建时间聚合展示，但新数据必须写入明确 batch id，避免误合并。

### 4.3 批量图片匹配弹窗

复用现有 `ProSubmitModal` 的布局心智，做一个审核端弹窗，例如 `ReviewBatchImageAssignmentModal`。

整体为全屏 Modal：

```text
标题：批量图片匹配

左侧：本批次实验列表
  - 电表的改装        未匹配
  - 声速测量          已匹配
  - 钢丝杨氏模量      未匹配

右侧：当前实验匹配工作区
  左栏：学生上传图片池
    [图1]
    [图2]
    [图3]
    ...

  右栏：实验图片槽位
    [签字原始数据图          拖入图片]
    [实验装置图              拖入图片]
    [图片题 1                拖入图片]

底部：
  取消
  保存草稿
  确认匹配并开始 AI 预处理
```

交互要求：

- 左侧实验列表固定，右侧匹配工作区滚动。
- 图片池竖向缩略图，显示图号、使用状态、所属实验来源。
- 槽位来自实验配置 `inputs.images`。
- 支持拖拽图片到槽位。
- 也要提供点击式兜底：选中图片 -> 点击槽位“放入此处”，避免拖拽在触控板上不好用。
- 图片可以预览、放大、缩小、旋转、移除。
- 旋转必须沿用当前真实旋转上传逻辑，生成新文件并替换 URL，而不是只做前端 CSS 旋转。
- 已使用图片打标，但允许复用，因为同一张图可能既是原始数据图又要作为学校图片节点提交。

### 4.4 审核详情页

审核详情页继续复用学生 `ExperimentDetailView`。

区别：

- 初始表单值优先使用 `submission.corrected_json.values`。
- 没有 corrected 时使用 `submission.recognition_json`。
- 图片控件优先从 `submission.image_slots` 回填。
- 旧数据没有 `image_slots` 时，才把 `image_paths` 放入第一个图片槽作为兼容显示。

审核页管理员看到的最终状态应为：

- 固定填空已自动填好。
- 图片控件已按管理员匹配结果显示。
- 表格识别值已写入对应节点。
- 问题回答已生成。
- 计算项待管理员确认数据后点击“一键计算”。

## 5. 数据模型

### 5.1 submissions 新字段

建议新增：

```text
submission_batch_id: str | null
image_slots: JSONB
preprocess_status: str | null
preprocess_error: str | null
```

`submission_batch_id` 用于审核任务页按一次提交聚合。

`image_slots` 保存管理员匹配结果：

```json
{
  "IMG_RAW_DATA": [
    {
      "url": "/uploads/2026-07/a.jpg",
      "name": "a.jpg",
      "sourceIndex": 1,
      "rotation": 0
    }
  ],
  "IMG_QUESTION_1": [
    {
      "url": "/uploads/2026-07/b_rotated.jpg",
      "name": "b_rotated.jpg",
      "sourceIndex": 2,
      "rotation": 90
    }
  ]
}
```

`image_paths` 继续保留，表示学生原始上传图片池，方便兼容旧代码、审计和批量匹配弹窗读取。

### 5.2 状态建议

当前 `Submission.status` 已有：

```text
pending_recognition
recognizing
reviewing
submitting
completed
error
draft_submitted
```

建议新增或语义化使用：

```text
pending_image_assignment   待图片匹配
preparing_review           AI 预处理中
reviewing                  待人工审核
draft_submitted            已临时提交
completed                  已正式提交
error                      处理失败
```

推荐状态流：

```text
pending_payment
  -> pending_image_assignment
  -> preparing_review
  -> reviewing
  -> submitting
  -> draft_submitted / completed
```

如果暂时不想新增状态，也可以先复用：

- `pending_recognition` 展示为“待图片匹配”
- `recognizing` 展示为“AI 预处理中”
- `reviewing` 展示为“待人工审核”

但长期建议改成更准确的状态名。

## 6. API 设计

### 6.1 创建一键提交任务

`POST /api/v1/checkout/submit`

请求字段：

```json
{
  "target_student": "26A...",
  "is_hungup": false,
  "plan": "pay_per_use",
  "submission_batch_id": "BATCH-...",
  "experiments": [
    {
      "experiment_id": "exp_meter_modification",
      "image_paths": ["/uploads/2026-07/a.jpg"]
    }
  ]
}
```

前端批量提交同一批实验时，必须生成或由后端返回同一个 `submission_batch_id`。当前实现已采用统一 checkout 接口，由后端一次创建 batch 和多条 submission；需要支付时只创建一笔订单，并通过 `order_items` 记录明细。

### 6.2 获取审核任务池

`GET /api/v1/submissions/review-pool`

响应需要包含：

```json
{
  "id": "SUB-XXXX",
  "submission_batch_id": "BATCH-XXXX",
  "student_id": 1,
  "student_username": "26A...",
  "student_name": "张三",
  "experiment_id": "exp_meter_modification",
  "status": "pending_image_assignment",
  "image_count": 3,
  "assigned_image_count": 0,
  "updated_at": "..."
}
```

前端按 `student_username + submission_batch_id` 聚合。

### 6.3 保存图片匹配

新增：

```text
PATCH /api/v1/submissions/{submission_id}/image-slots
```

请求：

```json
{
  "image_slots": {
    "IMG_RAW_DATA": [
      { "url": "/uploads/2026-07/a.jpg", "name": "a.jpg", "sourceIndex": 1 }
    ]
  }
}
```

权限：

- admin / reviewer 可保存审核任务图片匹配。
- student 不可修改 one-click handoff 任务的图片匹配。

保存后：

- 更新 `submission.image_slots`
- 写入 audit log
- 不立即强制启动 AI，除非前端调用“确认匹配并开始预处理”

### 6.4 批量保存匹配并启动预处理

新增：

```text
POST /api/v1/submissions/batches/{batch_id}/prepare-review
```

请求：

```json
{
  "assignments": {
    "SUB-1": {
      "IMG_RAW_DATA": [{ "url": "/uploads/2026-07/a.jpg" }]
    },
    "SUB-2": {
      "IMG_RAW_DATA": [{ "url": "/uploads/2026-07/b.jpg" }]
    }
  }
}
```

后端行为：

- 校验当前用户是 admin / reviewer。
- 校验每个 submission 属于该 batch。
- 保存每个 submission 的 `image_slots`。
- 为每个 submission 投递 `prepare_submission_for_review_task`。
- 状态改为 `preparing_review`。
- 返回批量预处理摘要。
- 不读取 `AiConfig.auto_recognize` 作为是否执行的依据；该接口本身就是管理员确认后的显式预处理动作。

### 6.5 获取批量预处理进度

可以复用 `automation_jobs`，新增 action：

```text
prepare_review
```

或者新增轻量 batch 状态接口：

```text
GET /api/v1/submissions/batches/{batch_id}/prepare-review/status
```

第一版可以先使用 `submission.preprocess_status` / `preprocess_error` 表达状态；如果审核端需要统一浮窗和后台进度列表，再升级为 `AutomationJob` public job 记录，避免前期为 UI 进度重复造表。

## 7. 后台预处理 Job

### 7.1 实现原则

预处理 job 是编排层，不是新的 AI 能力实现层。

执行前必须确认并复用现有能力：

| 能力 | 当前入口 | 预处理复用方式 |
|---|---|---|
| 固定填空 | `POST /api/v1/ai/fixed-fill/{experiment_id}` | 调用 `ai_service.get_fixed_fill(experiment_id)` |
| 图片识别 | `POST /api/v1/ai/recognize-direct` | 调用 `ai_service.recognize_images(experiment_id, assigned_image_paths, session)` |
| 问题回答生成 | `POST /api/v1/ai/generate-answer-direct` | 调用 `ai_service.generate_answers(experiment_id, questions, working_values, session)` |
| 公式计算 | `POST /api/v1/experiments/{experiment_id}/compute` | 不在预处理自动调用，继续由审核页人工触发 |
| AI task 轮询 | `GET /api/v1/ai/task/{task_id}` | 页面交互继续复用；批量预处理用 automation job 或 Celery task 状态聚合 |

不要把 prompt 构造、图片路径转 base64、AI 返回 JSON 清洗、固定填空读取等逻辑复制到新的 worker 里。

### 7.2 Job 步骤

新增 worker 任务：

```text
prepare_submission_for_review_task(submission_id, actor_user_id)
```

1. 读取 submission、experiment config。
2. 读取 fixed 节点，生成固定填空值。
3. 根据 `exp_config.ai.recognition.imageRef` 找到识别图片槽。
4. 只把该槽位图片传给 `ai_service.recognize_images()`。
5. 合并固定填空值和识别结果为 `working_values`。
6. 读取 `ui.questions`，排除 `image_upload` 类型问题节点。
7. 使用 `working_values` 调用 `generate_answers()`。
8. 合并生成回答。
9. 写入：

```json
submission.recognition_json = {
  "values": {
    "...": "..."
  },
  "_meta": {
    "source": "prepare_review",
    "imageRef": "IMG_RAW_DATA",
    "preparedAt": "...",
    "preparedBy": actor_user_id
  }
}
```

如果现有审核页暂时直接读取扁平 `recognition_json`，第一阶段可以继续写扁平节点：

```json
{
  "DBGZ1": "...",
  "DBGZ10-0": "...",
  "skt0Area": "..."
}
```

但长期建议统一为：

```json
{
  "values": {},
  "_meta": {}
}
```

10. 状态改为 `reviewing`。
11. 写入 audit log。

失败时：

- 状态改为 `error` 或 `pending_image_assignment`，取决于失败原因。
- AI 失败保存 `preprocess_error` 和脱敏 job result。
- 允许管理员重新匹配或重新预处理。

### 7.3 与旧 `auto_recognize` 的关系

旧 `AiConfig.auto_recognize` 保留，但新完整提交链路不依赖它：

- `auto_recognize=false`：默认推荐状态；submission 创建后等待管理员图片匹配。
- `auto_recognize=true`：仅作为旧流程或开发调试能力；不解决多图片匹配，不应作为生产完整提交默认链路。
- 批量匹配弹窗的“确认匹配并开始 AI 预处理”是新链路的主触发点。

## 8. AI 识别与回答生成规则

### 8.1 图片识别来源

AI 图片识别必须只使用：

```text
submission.image_slots[experiment.ai.recognition.imageRef]
```

如果缺少 `imageRef` 或槽位为空：

- 不应对全部 `image_paths` 盲识别。
- job 返回 `IMAGE_ASSIGNMENT_REQUIRED`。
- 前端提示管理员先完成图片匹配。

### 8.2 固定填空

固定填空来自实验配置：

```text
inputs.fields[].type = fixed
```

预处理时自动写入 `working_values`，管理员之后仍可在审核详情页修改。

### 8.3 问题回答

生成回答使用 `working_values`。

附带数据节点由：

```text
ai.generation.dataNodes
```

决定。若配置缺失，后端按当前实验 `inputs.fields` 顺序取前 3 个 `ai_recognize` 节点兜底。

### 8.4 计算

预处理 job 不自动执行公式计算。

原因：

- 管理员需要先审核 AI 识别值。
- 计算结果依赖识别数据准确性。
- 一键计算应保留为审核详情页人工动作。

审核页中管理员确认表格识别值后，点击“一键计算”，再保存 corrected 数据。

## 9. 学校提交链路

### 9.1 触发入口

审核详情页继续保留：

```text
临时提交
正式提交
```

提交前必须先保存当前审核数据到：

```text
submission.corrected_json.values
```

随后调用：

```text
POST /api/v1/school-sync/experiments/{experiment_id}/submit
```

请求：

```json
{
  "submissionId": "SUB-XXXX",
  "mode": "draft"
}
```

正式提交：

```json
{
  "submissionId": "SUB-XXXX",
  "mode": "final"
}
```

### 9.2 凭据归属

虽然提交按钮由 admin / reviewer 点击，但学校系统登录必须使用 submission 所属学生：

```text
submission.student_id -> users.student_no
submission.student_id -> users.encrypted_school_password
```

不得使用 admin / reviewer 的账号登录学校系统。

后端 job 需要：

- 根据 `submission.student_id` 读取学生用户。
- 使用 `student_no` 填学校账号。
- 解密 `encrypted_school_password` 填学校密码。
- 学校浏览器会话按学生 `user.id` 复用或重建。

### 9.3 数据来源

学校系统回填使用：

```text
submission.corrected_json.values
```

图片字段也必须包含在 corrected values 或由 `image_slots` 同步到对应 image_upload 节点值。

推荐保存审核数据时，后端把 `image_slots` 中绑定了 `targetNodeId` 的图片同步到 `corrected_json.values[targetNodeId]`，例如：

```json
{
  "YSSJDrawingAreaArea": "/uploads/2026-07/a.jpg"
}
```

这样学校提交服务只需要按 `automation.mappings[]` 读取平台节点值，不需要临时理解前端图片槽结构。

### 9.4 提交流程

提交 job 主链路：

```text
保存 platform_before_submit 快照
  -> 获取或恢复该学生学校系统会话
  -> 打开或复用目标实验报告 modal
  -> 按 automation.mappings 写入文本、富文本和图片
  -> 逐字段回读校验
  -> 如有失败，停止，不点击学校提交按钮
  -> 点击临时提交或正式提交
  -> 等待学校反馈
  -> 回到完成报告列表读取学校状态
  -> 写入 SchoolSyncSnapshot / AutomationJob / AuditLog
  -> 更新 Submission.status
```

### 9.5 临时提交

`mode=draft`：

- 点击学校系统临时提交 selector。
- 成功后 submission 状态改为 `draft_submitted`。
- 失败时保留平台快照和字段写入报告，方便重试。

### 9.6 正式提交

`mode=final`：

- 与临时提交共用同一链路，只切换 selector 和状态确认。
- 前端必须二次确认。
- 后端必须写入审计日志。
- 成功后 submission 状态改为 `completed`。
- 在任何探测、截图、modal 读取、草稿验证任务中，不得顺手点击学校系统正式提交按钮；正式提交只能来自明确的用户提交动作和确认流程。

## 10. 前端组件规划

### 10.1 复用现有组件

可复用：

- `ProSubmitModal` 的全屏 Modal 框架和左侧实验列表。
- `ExperimentImageUploader` 的预览、缩放、旋转、移除能力。
- `StudentExperimentDetailPage.ExperimentDetailView` 作为审核详情页主体。
- `AsyncJobFloatingPanel` 或 `AutomationProgressModal` 展示预处理 job 进度。

建议新增：

```text
ReviewBatchImageAssignmentModal.jsx
ReviewImagePool.jsx
ReviewImageSlotBoard.jsx
```

### 10.2 弹窗布局

桌面端：

```text
Modal
  Header
  Body
    LeftExperimentRail
    RightAssignmentWorkspace
      ImagePoolColumn
      SlotBoardColumn
  Footer
```

移动端或窄屏：

- 实验列表改为顶部横向 tabs。
- 图片池和槽位上下排列。
- 保留点击式分配，不强依赖拖拽。

### 10.3 审核任务页批次展示

父层：

```text
学生 / 姓名 / 批次数 / 待处理数
```

展开后：

```text
批次号 / 实验数 / 图片数 / 状态 / 操作
```

批次再展开：

```text
实验名称 / 状态 / 最后更新 / 编辑 / 单独重跑预处理
```

### 10.4 设置页开关

设置页需要新增“打开实验详情自动加载学校数据”的可视化开关，避免只能改 raw JSON。

建议位置：

```text
系统设置
  自动化配置
    学校数据自动加载
      学生打开实验详情时自动加载学校数据             Switch
      Admin/Reviewer 打开实验详情时自动加载学校数据   Switch
```

建议配置结构：

```json
{
  "syncPolicy": {
    "initialSync": "identity_and_report_list",
    "detailSync": "on_demand",
    "autoLoadDetailForStudent": true,
    "autoLoadDetailForInternalUser": false,
    "listCacheTtlSeconds": 600,
    "syncCooldownSeconds": 1800
  }
}
```

前端行为：

- 学生打开实验详情时，只有 `autoLoadDetailForStudent=true` 才自动触发 `school_detail_sync`。
- admin / reviewer 打开审核详情或学生实验详情时，只有 `autoLoadDetailForInternalUser=true` 才自动触发。
- 即使自动加载关闭，也保留手动“加载学校数据”按钮，方便需要时显式触发。

后端行为：

- 自动化配置接口校验这两个字段为 boolean。
- 默认值：`autoLoadDetailForStudent=true`，`autoLoadDetailForInternalUser=false`。
- 这两个开关只影响打开页面时是否自动触发，不影响用户手动点击同步，也不影响学校提交 job。

## 11. 后端实现阶段

### 阶段 1：批次和图片匹配结构

- `submissions` 增加 `submission_batch_id`、`image_slots`。
- 一键批量提交时生成同一 batch id。
- `review-pool` 返回 batch id、图片数量、匹配状态。
- 审核详情页优先使用 `image_slots` 回显图片。
- 旧数据没有 `image_slots` 时兼容 `image_paths`。

验收：

- 学生一次提交 6 个实验，审核页能看到一个批次。
- 管理员能打开批量匹配弹窗。
- 图片匹配后，单个审核详情页对应图片控件能正确显示图片。

### 阶段 2：批量匹配弹窗

- 新增审核端批量匹配 Modal。
- 支持图片池、槽位、拖拽/点击分配、旋转、预览。
- 支持保存匹配草稿。
- 支持确认匹配并启动预处理。

验收：

- 一批多个实验可以逐个完成图片匹配。
- 槽位数据保存后刷新页面不丢失。
- 旋转后的图片 URL 是真实新文件。

### 阶段 3：预处理 job

- 新增 `prepare_submission_for_review_task`，作为现有固定填空、图片识别、问题回答服务的编排层。
- 新增批量 prepare API。
- 自动固定填空、图片识别、生成回答。
- 状态从 `pending_image_assignment` 到 `preparing_review` 到 `reviewing`。
- 保持 `AiConfig.auto_recognize` 默认关闭，不把旧自动识别作为完整提交主链路。

验收：

- 管理员确认匹配后无需逐个点识别。
- 审核详情页打开时已经有固定填空、识别数据和回答。
- 计算项仍为空或待计算，由管理员点击一键计算。

### 阶段 4：学校提交闭环

- 审核页保存 corrected values 后触发临时 / 正式提交。
- 后端使用 submission 所属学生的学校凭据登录或复用会话。
- 图片节点通过 corrected values 和 automation mappings 写入学校系统。
- 提交前字段写入报告阻断不完整写入。
- 临时提交成功落 `draft_submitted`。
- 正式提交成功落 `completed`。

验收：

- admin / reviewer 触发 one-click handoff 提交时，不使用自己的学校账号。
- 字段写入失败不会点击学校提交按钮。
- 提交失败可在 automation job 和 audit log 中看到脱敏原因。

### 阶段 5：详情自动加载学校数据开关

- 在自动化配置 `syncPolicy` 中新增 `autoLoadDetailForStudent` 和 `autoLoadDetailForInternalUser`。
- 设置页新增两个 Switch，避免管理员必须编辑 raw JSON。
- 学生详情页和审核详情页读取该配置决定是否自动触发 `school_detail_sync`。
- 自动加载关闭时保留手动加载入口。

验收：

- 学生端和 admin/reviewer 端可分别控制打开详情时是否自动加载学校数据。
- 默认学生端沿用当前自动加载体验，admin/reviewer 默认不自动加载。
- 学校提交链路不受该开关影响。

## 12. 风险与约束

- 批量匹配不能只靠时间窗口聚合，否则同一学生短时间多次提交可能被误合并；新任务必须有显式 batch id。
- 图片槽位必须来自实验配置 `inputs.images`，不能由前端临时自造。
- AI 识别不能在未匹配时自动读取全部图片。
- `AiConfig.auto_recognize` 默认保持关闭；在图片匹配能力完成前，不应把它作为完整提交自动处理入口。
- 批量预处理必须优先复用学生侧已经沉淀的固定填空、图片识别、回答生成服务能力，只新增写入 submission 的编排逻辑。
- 正式提交是高风险动作，必须独立确认、审计和状态检查。
- 学校密码只能在后端解密并用于 Playwright 登录，不得进入前端或日志。
- 提交链路以 `automation.mappings[]` 为唯一学校 DOM 写入依据；图片槽只是平台 UI 匹配结构，最终仍要落到 mapped source node。
