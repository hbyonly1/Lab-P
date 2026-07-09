# API Contract & Data Models

本文档定义了实验报告系统前后端交互的 API 契约与核心数据模型。

## 1. 核心模型设计

### 1.1 系统公告 (Announcements)
提供系统级的更新、通知和活动广播。

**表：`announcements`**
- `id`: UUID (主键)
- `title`: String (公告标题)
- `content`: Text (公告正文)
- `type`: Enum `['update', 'notice', 'promotion']` (公告类型，决定前端图标与颜色)
- `is_active`: Boolean (默认 true，用于管理员软删除或撤回)
- `created_at`: Datetime (发布时间)

**表：`user_announcement_reads`**
（用于精确跟踪每个用户的已读状态 - 方案 A）
- `id`: UUID
- `user_id`: UUID (外键)
- `announcement_id`: UUID (外键)
- `read_at`: Datetime (阅读时间)

## 2. API 接口定义

### 2.0 上传实验图片
- **Endpoint**: `POST /api/v1/files/upload`
- **Auth Required**: Yes
- **Payload**: `multipart/form-data`，字段 `file`
- **Response**:

```json
{
  "status": "success",
  "url": "/uploads/2026-07/xxx.jpg",
  "filename": "raw.heic",
  "transcoded": true
}
```

- **后端执行的严格逻辑**：
  1. 单文件最大 20MB；超过返回 `413`。
  2. 常规 `jpg/png/webp/gif/bmp` 按原格式保存。
  3. 对 `heic/heif/tif/tiff/mpo/avif` 等非常规图片，后端会尝试自动转码为 `jpg` 后保存。
  4. 自动转码失败返回 `415`，不得保存半成品文件。
  5. student 只能读取自己上传或自己提交记录引用的图片；admin/reviewer 可读取管理范围内图片。

### 2.1 获取公告列表
- **Endpoint**: `GET /api/v1/announcements`
- **Auth Required**: Yes (Student / Admin / Reviewer)
- **Response**:
```json
{
  "code": 200,
  "data": [
    {
      "id": "ann-1",
      "title": "系统维护通知",
      "content": "为了提供更好的服务...",
      "type": "update",
      "is_read": false,
      "created_at": "2026-06-30T08:00:00Z"
    }
  ]
}
```
*注：`is_read` 字段由后端联表 `user_announcement_reads` 动态计算得出。*

### 2.2 标记单条公告已读
- **Endpoint**: `POST /api/v1/announcements/{id}/read`
- **Auth Required**: Yes
- **Response**:
```json
{
  "code": 200,
  "message": "success"
}
```

### 2.3 标记全部公告已读
- **Endpoint**: `POST /api/v1/announcements/read-all`
- **Auth Required**: Yes
- **Response**:
```json
{
  "code": 200,
  "message": "success"
}
```

## 3. 核心业务 API：实验数据保存与提交

在“实验详情（编辑页）”中，针对右侧表单的修改，后端通过分离“自助提交”和“一键代写”来保证支付语义清晰：

- **自助临时 / 正式提交**：学生已经在前端填写好数据，只需要平台同步到学校系统；不创建订单，不进入待支付。
- **一键代写 / 一键提交**：学生只上传图片，交给管理员或 reviewer 代写、代纠错、代提交；这条链路才需要付费或 Pro 权限。

### 3.0 创建或复用自助提交记录

- **Endpoint**: `POST /api/v1/submissions/self-managed`
- **Auth Required**: Yes (Student)
- **Payload**:

```json
{
  "experiment_id": "exp_meter_modification",
  "image_paths": ["/uploads/raw.jpg"]
}
```

- **后端执行的严格逻辑**：
  1. 只创建 `is_one_click_handoff=false` 的 submission。
  2. 不创建 `orders`，不写 `pending_payment`。
  3. 新建 submission 的 `status=incomplete`，`payment_status=not_required`。
  4. 如果该学生该实验已有自助 submission，则复用已有记录。

### 3.0.1 统一 Checkout 报价与提交

- **报价 Endpoint**: `POST /api/v1/checkout/quote`
- **提交 Endpoint**: `POST /api/v1/checkout/submit`
- **Auth Required**: Yes
- **Payload**:

```json
{
  "plan": "pay_per_use",
  "is_hungup": true,
  "submission_batch_id": "BATCH-XXXX",
  "client_request_id": "REQ-frontend-once",
  "experiments": [
    {
      "experiment_id": "exp_meter_modification",
      "image_paths": ["/uploads/2026-07/raw.jpg"],
      "image_slots": {
        "IMG_RAW_DATA": [
          {
            "url": "/uploads/2026-07/raw.jpg",
            "name": "raw.jpg",
            "sourceIndex": 1
          }
        ]
      }
    }
  ]
}
```

- **后端执行的严格逻辑**：
  1. 只创建 `is_one_click_handoff=true` 的 submission。
  2. `experiments[].image_paths` 至少包含一个已上传图片 URL；空数组或全空值请求返回 `400`，不得创建订单或审核任务。
  3. `pay_per_use` 按实验逐项计价：当前统一为每个实验 5 元，不读取实验配置覆盖价；同一批提交只创建一笔订单，订单下挂多条 `order_items`。
  4. `pro` + 一键批量提交只创建一笔 Pro 升级订单，订单金额为 Pro 套餐价；该订单下保留一个 `plan_upgrade` item 和若干 0 元 `batch_submission` item，用于表达付款放行哪些实验。
  5. `plus/pro` 套餐升级不带 `experiments`；只创建套餐升级订单，不创建 submission。
  6. 学生不是 Pro 且选择一键托管时，只有 `is_hungup=true` 才允许创建待付款订单。
  7. 已是 Pro 的学生、管理员或 reviewer 内部代交时不创建订单，直接创建 paid submission。
  8. 一键托管提交不再自动触发盲 AI 识别；后端先按实验配置检查 `inputs.images`。如果已支付 / Pro / 内部创建的任务只有一个需要上传的图片槽，后端自动把 `image_paths` 归位到该唯一槽，并进入 `preparing_review` / `preprocess_status=queued`，直接执行固定填空、AI 识别和生成回答。多图片槽任务才进入 `pending_image_assignment`，等待管理员完成图片归位。
  9. 未支付任务不得启动预处理；管理员确认付款后，若该托管任务满足单图片槽条件，后端同样自动归位并入队预处理。
  10. `experiments[].image_slots` 为可选字段，用于前端 AI 融合上传预匹配后的槽位归位。后端只保存带有效 `url` 的图片条目，并重新按实验配置判断是否覆盖全部“需要用户上传”的图片槽。自动生成 / 计算生成图片槽不参与完整性判断。覆盖完整且 `image_assignment_confirmed=true` 时直接进入预处理队列；不完整或 `image_assignment_confirmed=false` 时仍进入 `pending_image_assignment`，由管理员 / reviewer 继续补齐。

- **新增字段**：
  - `submission_batch_id`: 同一批量提交的聚合 id；前端传入则复用，未传则后端生成。
  - `image_slots`: 图片归位结果。单图片槽且已允许处理时由后端自动填入；多图片槽默认 `{}`，等待管理员匹配。
  - `preprocess_status`: 预处理阶段状态，例如 `waiting_for_image_assignment`、`queued`、`running`、`done`、`failed`。
  - `preprocess_error`: 预处理失败或缺少图片归位时的错误说明。
  - `orders.order_type`: `plan_upgrade` 或 `one_click_batch`。
  - `orders.pricing_snapshot`: 本次计价策略快照。
  - `order_items`: 订单明细，记录套餐升级项、按实验计价项或被套餐订单放行的批量提交项。

### 3.0.2 保存一键托管图片归位

- **Endpoint**: `PATCH /api/v1/submissions/{submission_id}/image-slots`
- **Auth Required**: Yes (Admin / Reviewer)
- **Payload**:

```json
{
  "image_slots": {
    "IMG_RAW_DATA": [
      {
        "url": "/uploads/2026-07/raw.jpg",
        "name": "raw.jpg",
        "sourceIndex": 1
      }
    ]
  }
}
```

- **后端执行的严格逻辑**：
  1. 只允许保存 `is_one_click_handoff=true` 的 submission。
  2. student 不可调用该接口修改托管任务图片归位。
  3. 只保存带有效 `url` 的图片条目。
  4. 若任务已经进入 AI 识别 / 审核预处理（`preprocess_status=queued/running/done` 或 `status=preparing_review/recognizing/reviewing/submitting/draft_submitted/completed`），该接口返回当前任务，不再覆盖图片槽或回退状态。
  5. 仍处于图片匹配阶段时，保存后更新 `preprocess_status` 为 `image_assigned` 或 `waiting_for_image_assignment`。

### 3.0.3 批量启动审核预处理

- **Endpoint**: `POST /api/v1/submissions/batches/{batch_id}/prepare-review`
- **Auth Required**: Yes (Admin / Reviewer)
- **Payload**:

```json
{
  "assignments": {
    "SUB-1": {
      "IMG_RAW_DATA": [{ "url": "/uploads/2026-07/raw-1.jpg" }]
    }
  }
}
```

- **Response**:

```json
{
  "batch_id": "BATCH-XXXX",
  "status": "queued",
  "submission_ids": ["SUB-1"],
  "skipped_already_processing": [],
  "skipped_missing_images": []
}
```

- **后端执行的严格逻辑**：
  1. 校验 batch 存在，且 `assignments` 中的 submission 都属于该 batch。
  2. 已进入 AI 识别 / 审核预处理的任务不再接收本次 `assignments`，也不重复入队；这些任务返回到 `skipped_already_processing`。
  3. 仍处于图片匹配阶段的任务保存归位结果后，有图片槽则置为 `preparing_review` / `preprocess_status=queued` 并入队；缺少图片槽则进入 `skipped_missing_images`。
  4. 后台任务复用现有 `ai_service.get_fixed_fill()`、`ai_service.recognize_images()`、`ai_service.generate_answers()`。
  5. 识别图片默认读取实验配置 `ai.recognition.imageRef` 对应的 `submission.image_slots`；若配置了 `ai.recognition.groups`，则按每个分组的 `imageRef` 和 `nodeIds` 分别识别并合并结果。
  6. 当自动化配置 `oneClick.preprocessAutoComputeEnabled=true` 时，后台在 AI 图片识别之后、实验问题生成之前执行一次公式计算；计算结果会并入 `working_values`，因此问题生成可使用完整的识别值和计算值。计算失败不会丢弃 AI 识别结果，会记录审计日志并继续生成回答。
  7. 预处理结果写入 `submission.recognition_json`，完成后进入 `reviewing`；缺少归位图片时回到 `pending_image_assignment`。

### 3.1 自动草稿保存 (Auto-save Draft)
- **Endpoint**: `PATCH /api/v1/submissions/{id}/draft`
- **Auth Required**: Yes (仅验证资源所属权，学生、reviewer 和 admin 可按任务权限调用)
- **Payload**:
```json
{
  "draft_json": {
    "values": {
      "temperature": "25",
      "pressure": "101.3"
    },
    "experiment_id": "exp_meter_modification",
    "experiment_name": "电表的改装"
  },
  "image_paths": ["/uploads/2026-07/raw.jpg"],
  "image_slots": {
    "IMG_RAW_DATA": [{ "url": "/uploads/2026-07/raw.jpg" }]
  },
  "local_revision": 12
}
```
- **后端执行的严格逻辑**：
  1. **覆盖式草稿**：更新 `submission_drafts.draft_json`、`image_paths`、`image_slots`、`local_revision` 和 `updated_at`；同一 submission 只保留当前草稿。
  2. **不污染提交态**：自动草稿不更新 `submissions.corrected_json`，不生成 `submission_versions`，不触发学校系统提交。
  3. **支付语义**：自动草稿不触发订单，也不允许因为没有订单而把状态改成 `pending_payment`。
  4. **审计语义**：自动草稿默认不写普通 `audit_logs`，避免逐字输入刷爆日志；临时/正式提交时再写正式审计。

- **Endpoint**: `GET /api/v1/submissions/{id}/draft`
- **Purpose**: 进入填写页时读取当前平台草稿。前端本地草稿若更新时间更晚，可提示或自动恢复本地未同步内容。

### 3.1.1 提交态保存 (Materialize Draft / Save Correction)

点击“临时提交”或“正式提交”前，前端必须把当前页面值保存为提交态数据：

- **Endpoint**: `PATCH /api/v1/submissions/{id}/correction`
- **Purpose**: 将当前确认提交的数据写入 `submissions.corrected_json`；后续 `draft_submit` / `final_submit` job 和 `submission_versions(source=platform_before_submit)` 均以该字段为准。

### 3.2 正式提交 (Official Submit)
- **Endpoint**: `PATCH /api/v1/submissions/{id}/correction` with `save_mode=final`
- **Auth Required**: Yes
- **Payload**: 
```json
{
  "corrected_json": {
    "temperature": "25",
    "pressure": "101.3"
  },
  "save_mode": "final"
}
```
- **后端执行的严格逻辑**：
  1. **锁数据**：开启事务并 `SELECT ... FOR UPDATE` 锁住当前 submission。
  2. **路由分发**：
     - 如果是学生点击“一键代劳提交”（仅上传图片，`is_one_click_handoff: true`），状态流转为 `reviewing`（进入人工审核池）。
     - 如果是学生自己填完数据正式提交，或审核员（Admin）完成纠错后正式提交，状态直接流转为 `submitting`（自动填报中，触发自动化引擎）。
  3. **完整性校验**：如果是触发自动化引擎，需根据该实验的 `mapping_json` 检查必填项是否都已填写。
  4. **落库与触发**：将最终数据保存至 `corrected_json`，进入自动化提交流程；这一流程不需要学生再支付。

## 4. 实验辅助工具 API (AI & 算力引擎)

在实验详情页中，学生或审核员可以调用以下接口来实现自动填表、识别和计算。这也是区分 Plus/Pro 订阅的核心权益接口，**所有接口必须校验用户的 `capabilities`**。
**注意：AI 识别、固定填空和生成式回答当前返回 Celery `task_id`，前端通过 `/api/v1/ai/task/{task_id}` 轮询结果，并用非阻塞后台任务浮窗持续展示状态；公式计算接口当前仍为同步返回，但前端也纳入同一浮窗反馈，不再只依赖按钮 loading。**

- **套餐权益矩阵**：
  - `free`：不能调用一键填空、AI 图像识别、一键计算数据。
  - `plus`：可以调用 AI 图像识别和一键计算数据；不能调用一键填空。
  - `pro`：可以调用一键填空、AI 图像识别、一键计算数据和一键提交。
  - `pay_per_use`：只用于购买本次一键提交，不授予学生侧长期 AI 图像识别、计算或固定填空权益。
  - 管理员 / reviewer 属于内部账号，按业务审核和代交需要放行上述工具接口。

### 4.0 融合上传图片自动匹配

- **Endpoint**: `POST /api/v1/ai/experiment-image-auto-match-task`
- **Auth Required**: Yes
- **Payload**:

```json
{
  "experiment_ids": ["exp_air_heat_capacity_ratio"],
  "images": [
    { "index": 1, "url": "/uploads/2026-07/raw-1.jpg", "name": "raw-1.jpg" },
    { "index": 2, "url": "/uploads/2026-07/raw-2.jpg", "name": "raw-2.jpg" }
  ]
}
```

- **Task Response**:

```json
{
  "task_id": "celery-task-id",
  "poll_timeout_seconds": 180,
  "poll_interval_ms": 2000,
  "audit_target_id": "experiment_image_auto_match",
  "model": "vision-model-name"
}
```

- **Task Result**:

```json
{
  "matches": [
    {
      "imageIndex": 1,
      "slotCandidateId": "E01-S01"
    }
  ],
  "unmatched": [
    { "imageIndex": 2 }
  ],
  "candidate_map": {
    "experiments": {
      "E01": { "experiment_id": "exp_meter_modification", "name": "电表的改装" }
    },
    "slots": {
      "E01-S01": {
        "experiment_id": "exp_meter_modification",
        "slot_id": "IMG_RAW_DATA",
        "label": "签字原始数据上传"
      }
    }
  }
}
```

- **自动流转**：当自动化配置 `oneClick.fusedImageAutoConfirmEnabled !== false` 时，前端在点击“自动匹配图片”后立即关闭上传 modal，任务完成后自动调用 checkout 创建提交。前端按实验分别判断已归位图片槽是否覆盖全部“需要用户上传”的图片槽：完整的实验传 `image_assignment_confirmed=true` 并进入 AI 预处理，不完整的实验传 `false` 并进入审核页图片待对应状态。未匹配图片只影响缺槽实验，不阻塞已经完整的实验。

- **单张图片模型输出格式**：

```json
{
  "slotCandidateId": "E01-S01"
}
```

无法判断时：

```json
{
  "slotCandidateId": ""
}
```

- **Progress Polling Response** (`GET /api/v1/ai/task/{task_id}` while running):

```json
{
  "status": "progress",
  "state": "PROGRESS",
  "current_batch": 1,
  "total_batches": 13,
  "processed_images": 1,
  "total_images": 13,
  "percent": 42,
  "message": "正在匹配图片，已处理 1/13 张。"
}
```

- **后端执行的严格逻辑**：
  1. 候选实验来自当前用户可见的启用实验配置；如果请求传入 `experiment_ids`，候选实验必须进一步限制在这些实验内。单个实验一键提交只传当前实验，批量提交只传当前批量目标实验。
  2. 候选图片槽只包含需要用户上传的 `inputs.images`，排除 `computedAssets[].imageSlotId`、`autoGenerated=true` 和 `purpose=computed_asset/generated` 等自动生成槽。
  3. 后端内部按 `ai.recognition.imageRef` / `groups[].imageRef` 区分 AI 识别图片槽和单独上传图片槽，但 Prompt 不暴露该分类标签。识别图片槽直接以 `slotCandidateId -> 表格序号和表格关键信息` 表达；无表格信息的单独上传槽只展示图片槽标题；不得给 DOM 节点 id 或要求模型输出 URL。
  4. 后端按每张图片一次请求调用视觉模型，默认最多 3 个请求并发；模型只输出当前图片对应的 `slotCandidateId`，后端根据当前单图请求自动补回原始 `imageIndex` 并聚合为任务结果；不修改用户上传原图。
  5. 前端通过 `/api/v1/ai/task/{task_id}` 轮询任务结果，并复用统一异步任务浮窗展示进度；有后端批次进度时优先展示真实进度，否则使用 `frontend/src/hooks/asyncTaskProgressProfiles.js` 的 `imageAutoMatch` 估算文案。
  6. 每次任务会把完整诊断 JSON 写入 `audit_logs(action=experiment_image_auto_match).details`，并同步落盘到 `backend/tmp/ai_image_auto_match/{task_id}/debug_payload.json`；内容包含调用模型、base_url、单图请求、图片编号/URL、完整 Prompt、候选槽、模型原始返回、解析结果和 normalize 后结果；不写入 API Key 或 base64 图片正文。
  7. 模型返回后，平台用 `candidate_map` 做二次映射，前端再把真实 URL 填入 `checkout.submit` 的 `image_slots`。

- **Prompt 预览 Endpoint**: `GET /api/v1/ai/admin/experiment-image-auto-match/preview`
- **Auth Required**: Yes (Admin)
- **Purpose**: 在设置页预览融合图片匹配 Prompt 和候选映射，方便检查候选实验、图片槽和表格关键信息。

### 4.1 一键填空 (Fixed Params)
获取该实验固定的常量数据（如默认器材参数）。
- **Endpoint**: `POST /api/v1/ai/fixed-fill/{experiment_id}`
- **Response**:
```json
{
  "task_id": "celery-task-id"
}
```
- **Task Result**:
```json
{
  "SYMD_Fill_0": "电压表和欧姆表",
  "SYMD_Fill_1": "1500"
}
```

### 4.2 AI 图像识别 (OCR & Extraction)
根据上传的原始数据图片，调用大模型提取结构化数据。
- **Endpoint**: `POST /api/v1/ai/recognize-direct`
- **Payload**:
```json
{
  "experiment_id": "exp_meter_modification",
  "image_paths": ["/uploads/2026-07/raw.jpg"]
}
```
- **Response**:
```json
{
  "task_id": "celery-task-id"
}
```
- **Task Result**:
```json
{
  "Ig": "100",
  "Rg": "1500",
  "E": "1.5"
}
```

### 4.3 智能公式推导 (Compute DAG)
根据当前已填的零散数据，利用后端配置好的 DAG（有向无环图）公式，计算出所有剩余的依赖数据。
- **Endpoint**: `POST /api/v1/experiments/{exp_id}/compute`
- **Payload**:
```json
{
  "current_values": {
    "A": "1.0",
    "D": "2.5"
  }
}
```
- **核心逻辑说明（零信任）**：前端**绝对不可以通过 Payload 传递计算公式**（防篡改与注入风险）。怎么计算、公式是什么，统统存放在后端的 `experiments` 表的 `config_json` 里。后端拿到 `current_values` 后，自行去数据库查公式并推导，最后返回结果。
- **公式表达式能力**：表达式由后端 `simpleeval` 白名单执行，支持基础数学运算，以及后端在 `backend/services/experiment_formulas.py` 显式注册的辅助函数。统一使用 `v()` 取值：`v('A')` 读取单个节点，`v('A','B')` 读取多个节点并返回数组，`v(200,400)` 表示常量数组。当前已注册 `v`、`reciprocal`、`reciprocal_values`、`linear_slope`、`linear_intercept`、`linear_r2`、`interp_x_at_y`、`format_sig`、`format_fixed`；公式函数不读取 UI 表格结构，所有依赖节点或常量必须在公式中显式写出。
- **Response**:
```json
{
  "computed_values": {
    "A": "1.0",
    "D": "2.5",
    "B": "3.5",
    "Result": "1.2"
  }
}
```
- **Incomplete Input Error**: 如果公式依赖的前置节点未填写，后端返回 `400`，前端只展示“填写不完整，无法计算”，并可用 `missing_node_ids` 高亮对应输入框；学生端不得展示节点选择器或内部节点名。
```json
{
  "detail": {
    "code": "FORMULA_INPUT_INCOMPLETE",
    "message": "填写不完整，无法计算",
    "missing_node_ids": ["DBGZ10-2"]
  }
}
```

### 4.4 实验问题批量 AI 生成 (Generate Answers)
调用大模型，一次性针对当前实验的全部思考题生成答案，并按题号映射回对应节点。
- **Endpoint**: `POST /api/v1/ai/generate-answer-direct`
- **Payload**:
```json
{
  "experiment_id": "exp_meter_modification",
  "questions": [
    { "index": 1, "nodeId": "skt0Area", "title": "分析相关系数偏低的原因。" },
    { "index": 2, "nodeId": "skt1Area", "title": "说明实验误差来源。" }
  ],
  "current_form_values": {
    "SYMD_Fill_0": "欧姆表"
  }
}
```
- **核心逻辑说明（零信任）**：前端不传递核心 Prompt！后端使用实验配置页“Prompt 模板配置”的 system prompt，按 `AiPromptTemplate -> Python 默认模板` 的优先级组合系统指令；实验级附加说明只读取实验 JSON 的 `ai.generation.extraPrompt`。后端要求模型返回简洁 JSON object，例如 `{ "1": "...", "2": "..." }`，再按题号转换为对应 `nodeId`。
- **Response**:
```json
{
  "task_id": "celery-task-id"
}
```

- **Task Result**:
```json
{
  "answers": [
    { "index": 1, "nodeId": "skt0Area", "answer": "..." },
    { "index": 2, "nodeId": "skt1Area", "answer": "..." }
  ]
}
```

### 4.5 AI 辅助任务状态查询
用于一键填空、AI 图像识别和实验问题生成的前端轮询。
- **Endpoint**: `GET /api/v1/ai/task/{task_id}`
- **Response: pending**
```json
{
  "status": "pending"
}
```
- **Response: done**
```json
{
  "status": "done",
  "result": {}
}
```
- **Response: error**
```json
{
  "status": "error",
  "message": "处理失败，请稍后重试"
}
```
- **前端展示约束**：
  - 一键填空、识别、计算、生成回答都必须在触发后展示右下角非阻塞后台任务浮窗。
  - 浮窗运行期间不阻塞表单编辑和页面滚动。
  - 任务完成后保留成功摘要，用户可关闭；失败时展示可行动错误和重试入口。
  - 学校系统提交、正式提交等高风险任务继续使用专门的自动化进度弹窗，不复用 AI 辅助浮窗。

## 5. 实验项目配置 API (Experiment Configs)

为了支撑前端渲染实验详情页的表单结构，后端需要提供读取实验配置（`mapping_json`）的接口。

### 5.1 获取实验项目列表
- **Endpoint**: `GET /api/v1/experiments`
- **Auth Required**: Yes
- **权限与过滤**:
  - `student` 只能获得 `meta.enabled !== false` 的实验。
  - `admin` / `reviewer` 可获得全部实验，用于配置管理和审核。
  - 列表按 `meta.sortOrder` 升序返回；缺失或非法时按 `9999` 处理，再按实验名和 id 稳定排序。
- **Response**:
```json
[
  {
    "id": "exp_meter_modification",
    "name": "电表的改装",
    "version": "2.0",
    "status": "not_started",
    "sort_order": 10,
    "enabled": true,
    "inputs": {},
    "updated_at": "2026-07-02T12:00:00Z",
    "config_file_mtime": "2026-07-02T12:00:00Z"
  }
]
```

### 5.2 获取单个实验的配置详情
用于前端动态渲染表单结构和计算依赖。
- **Endpoint**: `GET /api/v1/experiments/{id}`
- **Auth Required**: Yes
- **权限与过滤**:
  - `student` 请求停用实验时返回 `404`，不能绕过列表直接读取停用配置。
  - `admin` / `reviewer` 可读取停用实验配置。
- **Response**:
```json
{
  "code": 200,
  "data": {
    "id": "exp_meter_modification",
    "meta": {
      "name": "电表改装与校准实验"
    },
    "inputs": {
      "images": [],
      "fields": []
    },
    "ui": {}
  }
}
```

### 5.3 当前已接入的 V2 实验配置

配置源文件：

- 后端种子文件：`backend/configs/*.json`
- 权威落库位置：`experiments.config_json`
- 前端加载方式：`GET /api/v1/experiments` 与 `GET /api/v1/experiments/{id}`
- 列表补充字段：`updated_at` 表示配置内容最后变化时间，`config_file_mtime` 表示本地 JSON 文件最后修改时间。
- 排序和启用控制字段：`meta.sortOrder` 控制 Admin 实验配置页与学生实验页的统一显示顺序；`meta.enabled=false` 时学生端列表和详情不可见，Admin 仍可管理。
- 实验配置 `meta` 不保存学生完成状态；学生维度的 `unsubmitted/reviewing/completed` 等状态来自 `submissions`，由前端在学生页面合并展示。
- 节点类型语义：`ai_recognize` 是唯一图像识别节点类型；图像识别 Prompt schema、生成式回答附加数据节点下拉和生成式回答关键数据默认范围都只读取该类型。`fixed` 为固定填空节点，一键填空读取其 `value`；`computed` 为公式计算节点；`generated` 为生成式文本回答节点；`image_upload` 为学生/审核员单独上传图片并写回对应 `nodeId` 的图片答案节点。旧 `extract` 类型已删除，不再作为识别节点来源。
- 图片槽位语义：`inputs.images[].id` 可被 `ai.recognition.imageRef` 绑定为表格/数据识别图片；也可通过 `ai.recognition.groups[].imageRef` 绑定为分组识别图片，并用 `groups[].nodeIds` 限定该图片只识别哪些 `ai_recognize` 节点；还可通过 `inputs.images[].targetNodeId` 或 `inputs.fields[].imageSlotId` 绑定到 `image_upload` 节点。识别图片不会自动混入未声明的图片答案节点，图片答案节点保存为对应节点的图片 URL。
- 实验级识别补充说明：`ai.recognition.extraPrompt` 可选，用于当前实验的少量识别约束，例如单位换算或保留正负号；节点关系仍优先由 `ui.dataTables` / `ui.dataTable` 自动生成表结构映射，不应把整张表拆成大段逐节点说明。
- 实验级思考题补充说明：`ai.generation.extraPrompt` 可选，用于当前实验生成思考题回答时的少量约束；该字段作为预留能力，不要求所有实验配置。
- 生成式回答附带数据节点：`ai.generation.dataNodes` 可选，用于声明生成实验回答时传给 AI 的平台节点列表。该列表可以包含 `ai_recognize`、`computed`、`fixed` 等 `inputs.fields[].id`，后端只会取当前表单中有值的节点。若配置未声明，默认按当前实验 `inputs.fields` 顺序取前 3 个 `ai_recognize` 节点；数据库 Prompt 模板不再保存或覆盖数据节点选择。
- 学校 DOM 写入策略语义：`automation.mappings[].targetType` 是可选字段，用于告诉后端怎样把平台节点写入学校系统节点；它不是平台节点类型，不能和 `generated`、`image_upload`、`ai_recognize` 混用含义。缺省值一律按 `text` 处理，只有富文本等特殊学校控件才显式配置。
- 当前支持的 `targetType` 只有三种：

```text
text           普通 input / textarea / select / 可直接赋值文本节点
wysiwyg_text   学校富文本编辑器里的文本回答节点
wysiwyg_image  学校富文本编辑器里的图片上传节点
```

普通文本 mapping 不需要写 `targetType`：

```json
{
  "sourceId": "DBGZ10-0",
  "targetLocator": "#DBGZ10-0"
}
```

富文本或图片上传节点必须显式写入：

```json
{
  "sourceId": "skt0Area",
  "targetLocator": "#skt0Area",
  "targetType": "wysiwyg_text"
}
```

```json
{
  "sourceId": "YSSJDrawingAreaArea",
  "targetLocator": "#YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image"
}
```

后端写入时必须按 `targetType` 分派写入器：`text` 走普通表单写入和回读；`wysiwyg_text` 不能直接 `fill()` 隐藏 textarea，必须写入同一富文本容器内的可编辑区域并同步 textarea；`wysiwyg_image` 必须点击学校富文本工具栏的插入图片按钮、使用 popup 内的 `input[type=file]` 上传平台图片对应的本地文件，并回读确认编辑器中出现图片。

当前真实接入的学生端实验配置：

```text
exp_meter_modification          电表的改装
exp_falling_ball_viscosity      落球法测粘滞系数
exp_liquid_crystal_0625         液晶电光效应实验0625
exp_oscilloscope                示波器的使用
exp_air_heat_capacity_ratio     空气比热容比的测定
exp_three_line_torsion_pendulum 三线摆和扭摆实验
exp_steel_wire_young_modulus    钢丝杨氏模量的测定
exp_sound_velocity              声速的测量
exp_potentiometer               电位差计的原理和使用
exp_photoelectric_planck        光电效应和普朗克常量的测定
```

### 5.4 Admin 读取与保存实验原始配置

用于 Admin 在实验预览页的“原始配置”Tab 中直接维护单个实验的 V2 JSON 源文件。

- **Endpoint**: `GET /api/v1/experiments/{id}/raw-config`
- **Auth Required**: Yes，仅 Admin
- **Response**:
```json
{
  "id": "exp_air_heat_capacity_ratio",
  "title": "空气比热容比的测定",
  "version": "2.0",
  "file_path": "exp_air_heat_capacity_ratio.json",
  "config_json": {
    "meta": {
      "id": "exp_air_heat_capacity_ratio",
      "name": "空气比热容比的测定",
      "version": "2.0",
      "sortOrder": 80,
      "enabled": true
    }
  }
}
```

- **Endpoint**: `PATCH /api/v1/experiments/{id}/raw-config`
- **Auth Required**: Yes，仅 Admin
- **Payload**:
```json
{
  "config_json": {
    "meta": {
      "id": "exp_air_heat_capacity_ratio",
      "name": "空气比热容比的测定",
      "version": "2.0",
      "sortOrder": 80,
      "enabled": true
    },
    "inputs": {
      "fields": []
    },
    "ui": {}
  }
}
```

后端要求：

- `config_json` 必须是 JSON object。
- 如果存在 `config_json.meta.id`，必须与路径参数 `{id}` 一致。
- 文件路径只能由后端根据 `{id}` 映射到 `backend/configs/{id}.json`，前端不能传路径。
- 保存成功后同时写回 `backend/configs/{id}.json` 和 `experiments.config_json`。
- 如果保存前后配置内容 hash 变化，更新 `experiments.updated_at`；如果内容未变化，只同步 `config_file_mtime`。
- 保存成功必须写入 `audit_logs`，记录 action=`update_experiment_raw_config`、target_id、文件名和保存前后 hash。

### 5.5 Admin 保存实验计算规则

用于 Admin 在实验预览页的“计算规则配置”Tab 中维护 `formulas`。

- **Endpoint**: `PUT /api/v1/experiments/{id}/formulas`
- **Auth Required**: Yes，仅 Admin
- **Payload**:
```json
{
  "formulas": {
    "DBGZ2": "linear_slope(reciprocal(v('DBGZ10-0', 'DBGZ10-1')), v(200, 400))",
    "DBGZ3": "-linear_intercept(reciprocal(v('DBGZ10-0', 'DBGZ10-1')), v(200, 400))",
    "DBGZ4": "format_sig(linear_r2(reciprocal(v('DBGZ10-0', 'DBGZ10-1')), v(200, 400)), 3)"
  }
}
```

后端要求：

- 计算规则保存到 `backend/configs/{id}.json` 的顶层 `formulas` 字段。
- 只有顶层 `formulas` 会被 `/api/v1/experiments/{id}/compute` 执行；如配置中存在 `archivedFormulas`，仅表示历史公式留存，不参与一键计算。
- 保存成功后同步 `experiments.config_json.formulas`。
- 如果保存前后配置内容 hash 变化，更新 `experiments.updated_at`、`config_hash`、`config_file_mtime`。
- 保存成功必须写入 `audit_logs`，记录 action=`update_experiment_formulas`、公式数量、文件名和保存前后 hash。

### 5.6 Admin 刷新本地实验配置文件

用于 Admin 在实验配置列表页手动将 `backend/configs/*.json` 的本地变更同步到数据库。

- **Endpoint**: `POST /api/v1/experiments/refresh-configs`
- **Auth Required**: Yes，仅 Admin
- **Response**:
```json
{
  "scanned": 9,
  "created": 0,
  "changed": 1,
  "unchanged": 8,
  "failed": [],
  "changed_ids": ["exp_air_heat_capacity_ratio"]
}
```

后端要求：

- 逐个读取 `backend/configs/*.json`，计算稳定内容 hash。
- 如果数据库中没有该实验，新建记录并设置 `updated_at`、`config_file_mtime`、`config_hash`。
- 如果内容 hash 变化，更新 `config_json`、`config_hash`、`config_file_mtime`，并更新 `updated_at`。
- 如果内容 hash 未变化，不更新 `updated_at`；若文件 mtime 变化，只同步 `config_file_mtime`。
- 保存成功必须写入 `audit_logs`，记录 action=`refresh_experiment_configs`、扫描数量、更新数量、跳过数量、失败文件和变更实验 id。

### 5.7 保存实验页面数据

- **Auto-save Endpoint**: `PATCH /api/v1/submissions/{submission_id}/draft`
- **Purpose**: 填写页节流自动保存当前工作区草稿。该接口只写 `submission_drafts`，不写 `corrected_json`，不写 `submission_versions`，不触发学校系统 job。
- **Payload**:
```json
{
  "draft_json": {
    "values": {
      "SYMD_Fill_0": "示例填空",
      "Y10-0": "1.23",
      "skt0Area": "实验回答"
    },
    "experiment_id": "exp_liquid_crystal_0625",
    "experiment_name": "液晶电光效应实验0625"
  },
  "image_paths": ["/uploads/2026-07/example.png"],
  "image_slots": {},
  "local_revision": 7
}
```
- **Response**:
```json
{
  "submission_id": "SUB-XXXX",
  "draft_json": {},
  "image_paths": [],
  "image_slots": {},
  "local_revision": 7,
  "updated_at": "2026-07-07T00:00:00Z",
  "updated_by": 1
}
```

- **Endpoint**: `PATCH /api/v1/submissions/{submission_id}/correction`
- **Auth Required**: Yes
- **Permission**:
  - student 只能保存自己的 submission。
  - reviewer/admin 可保存其有权处理的 submission。
- **Payload**:
```json
{
  "corrected_json": {
    "values": {
      "SYMD_Fill_0": "示例填空",
      "Y10-0": "1.23",
      "skt0Area": "实验回答"
    },
    "experiment_id": "exp_liquid_crystal_0625",
    "experiment_name": "液晶电光效应实验0625"
  },
  "image_paths": ["/uploads/2026-07/example.png"],
  "save_mode": "draft"
}
```
- **Response**: `Submission`
- **State Change**:
  - 更新 `submissions.corrected_json`、`submissions.image_paths`、`submissions.updated_at`。
  - `corrected_json._meta` 记录 `save_mode`、保存用户、保存角色和保存时间。
  - 写入 `audit_logs(action=save_submission_correction)`。
  - `save_mode=final` 且任务处于 `pending_recognition`/`recognizing` 时，状态进入 `reviewing`。
  - 此接口是“提交态保存”，不是逐字 autosave；创建学校提交 job 前会基于 `corrected_json` 生成 `submission_versions(source=platform_before_submit)`。

## 6. 鉴权与用户 (Auth)
**现状缺口**：前端需要真实的 JWT 替代本地 Mock 的 DebugRole。

### 6.0 用户字段语义

`users` 第一阶段字段：

```text
id
username
student_no
real_name
hashed_password
encrypted_school_password
role
capabilities
created_at
```

说明：

- `username`：平台登录账号。admin / reviewer 使用平台账号登录。
- `student_no`：学生学号。学生登录平台和学校系统登录均使用该字段。
- `hashed_password`：平台登录校验使用的密码哈希。
- `encrypted_school_password`：用户登录平台时输入密码的可解密加密副本，仅供 Playwright 登录学校实验系统使用；不得返回前端、不得写入日志。
- `real_name`：学校系统同步到的真实姓名，仅用于展示和核对，不参与登录。
- 不兼容旧数据；如果本地库中已有旧用户数据导致字段冲突，直接清表或重建数据库。

### 6.1 用户登录
- **Endpoint**: `POST /api/v1/auth/login-preview`
- **Payload**:
```json
{
  "username": "26A2510410114"
}
```
- **说明**：登录提交前调用，用于判断本次是否会创建新的学生账号。该接口不接收、不返回密码。
- **Response**:
```json
{
  "username": "26A2510410114",
  "is_student_login": true,
  "account_exists": false,
  "requires_school_credential_confirmation": true
}
```
- **前端规则**：只有 `requires_school_credential_confirmation=true` 时，前端才弹出账号密码确认框；用户确认后再调用正式登录接口。已存在账号、admin、reviewer 不弹出该确认框。

- **Endpoint**: `POST /api/v1/auth/login`
- **Payload**: `{ "username": "xxx", "password": "xxx" }`
- **Student 规则**：当 `username` 符合学号格式时，后端按 `student_no` 查找或创建学生用户；`password` 同时作为平台登录密码和学校实验系统密码保存。后端写入 `hashed_password=hash(password)` 和 `encrypted_school_password=encrypt(password)`。
- **Admin / Reviewer 规则**：按 `username` 查找平台账号并校验平台密码哈希。
- **Response**:
```json
{
  "access_token": "jwt_string",
  "token_type": "bearer",
  "username": "26A2510410114",
  "student_no": "26A2510410114",
  "real_name": "张三",
  "role": "admin|student|reviewer",
  "capabilities": {}
}
```
- **前端展示规则**：登录成功和学校概览同步成功后，姓名只允许使用 `real_name`；缺失时显示“姓名未同步”。`student_no` 只能展示为学号，`username` 只能展示为平台账号，不得把学号或账号兜底伪装成姓名。

### 6.2 当前用户
- **Endpoint**: `GET /api/v1/auth/me`
- **Auth Required**: Yes
- **Response**:
```json
{
  "id": 1,
  "username": "26A2510410114",
  "student_no": "26A2510410114",
  "real_name": "张三",
  "role": "student",
  "capabilities": {}
}
```

## 6A. Admin 自动化配置

自动化配置仅 Admin 可见、可修改。第一版通过 JSON 文本维护选择器和 Playwright 运行参数，不为每个选择器拆单独字段，不包含具体 Playwright 脚本。

### 6A.1 获取自动化配置

- **Endpoint**: `GET /api/v1/admin/automation-config`
- **Auth Required**: Admin
- **Response**:
```json
{
  "id": 1,
  "name": "default",
  "schema_version": "1.6",
  "is_active": true,
  "created_by": 1,
  "updated_by": 1,
  "config_json": {
    "schoolSystem": {
      "_comment": "学校实验报告系统入口。",
      "baseUrl": "http://10.25.77.60:8001",
      "loginUrl": "http://10.25.77.60:8001/Login"
    },
    "identity": {
      "_comment": "学校系统账号使用 users.student_no，密码使用 users.encrypted_school_password 解密结果；登录后姓名写入 users.real_name。",
      "studentNoField": "users.student_no",
      "realNameField": "users.real_name",
      "passwordPolicy": "encrypted_user_password"
    },
    "selectors": {
      "_comment": "学校系统 DOM 选择器。重复节点后续使用 selector + index 或所在行定位。",
      "login": {
        "username": "#userName",
        "password": "#userPass",
        "captchaInput": "#checkCode",
        "captchaImage": "#imgCheckCode",
        "submit": ".loginBut"
      },
      "dashboard": {
        "realNameText": "#LoginUserName",
        "reportNav": "#reportA",
        "reportTableRows": "tbody[data-bind='foreach: CompleteReportList'] tr"
      },
      "reportList": {
        "_comment": "列表同步只保存实验名和提交状态；其它列暂不入库。",
        "columns": {
          "experimentName": 0,
          "status": 6
        },
        "openReportButtonText": "完成报告"
      },
      "modal": {
        "root": "#ReportModal",
        "content": "#ReportModal #content",
        "saveDraft": "#ReportModal button:has-text('临时提交')",
        "submitFinal": "#ReportModal button:has-text('正式提交')",
        "close": "#ReportModal button:has-text('关闭')"
      }
    },
    "safety": {
      "_comment": "高风险动作保护。按需读取和同步 modal 时必须跳过这些按钮；正式提交只允许由 final_submit job 在用户二次确认后触发。",
      "forbiddenActions": {
        "finalSubmit": {
          "policy": "never_click",
          "texts": ["正式提交"],
          "selectors": [
            "#ReportModal button:has-text('正式提交')",
            "button:has-text('正式提交')",
            "input[value='正式提交']"
          ]
        }
      }
    },
    "captcha": {
      "_comment": "验证码识别运行时使用统一 AI Provider；具体模型、prompt 和超时在 Admin AI 设置页维护。",
      "task": "captcha",
      "expectedLength": 4
    },
    "syncPolicy": {
      "initialSync": "identity_and_report_list",
      "detailSync": "on_demand",
      "autoLoadDetailForStudent": true,
      "autoLoadDetailForInternalUser": false,
      "listCacheTtlSeconds": 600,
      "syncCooldownSeconds": 1800
    },
    "oneClick": {
      "fusedImageUploadAiEnabled": false,
      "fusedImageAutoConfirmEnabled": true,
      "preprocessAutoComputeEnabled": false
    },
    "retryPolicy": {
      "captchaMaxRetries": 3,
      "credentialMaxRetries": 1,
      "networkMaxRetries": 2,
      "selectorMaxRetries": 1
    },
    "runtime": {
      "_comment": "headless=false 表示打开可视浏览器窗口；userSessionIdleTtlSeconds=0 表示平台不主动关闭会话。",
      "headless": false,
      "slowMoMs": 250,
      "defaultTimeoutMs": 30000,
      "postLoginSettleMs": 2000,
      "postLoginWaitMs": 10000,
      "keepBrowserOpenAfterLogin": true,
      "userSessionIdleTtlSeconds": 0,
      "schoolSessionMaxAgeSeconds": 7200
    },
    "waitPolicy": {
      "_comment": "学校页面节点稳定等待策略。关键 DOM 读写必须使用这些超时，不靠固定 sleep 判断成功。",
      "afterClickMs": 300,
      "afterInputMs": 100,
      "afterImageUploadMs": 1000,
      "modalOpenTimeoutMs": 15000,
      "fieldWriteTimeoutMs": 10000,
      "imageWriteTimeoutMs": 20000,
      "submitFeedbackTimeoutMs": 30000,
      "listRefreshTimeoutMs": 30000,
      "networkIdleTimeoutMs": 10000,
      "overviewStableMs": 1000,
      "overviewPollMs": 250
    }
  }
}
```

### 6A.2 更新自动化配置

- **Endpoint**: `PATCH /api/v1/admin/automation-config`
- **Auth Required**: Admin
- **Payload**:
```json
{
  "name": "default",
  "schema_version": "1.6",
  "is_active": true,
  "config_json": {
    "schoolSystem": {},
    "identity": {
      "passwordPolicy": "encrypted_user_password"
    },
    "selectors": {},
    "safety": {},
    "captcha": {},
    "syncPolicy": {},
    "oneClick": {},
    "retryPolicy": {},
    "runtime": {},
    "waitPolicy": {}
  }
}
```
- **Validation**:
  - `config_json` 必须是 JSON object。
  - 顶层必须包含 `schoolSystem`、`identity`、`selectors`、`safety`、`captcha`、`syncPolicy`、`retryPolicy`、`runtime`、`waitPolicy`。
  - `identity.passwordPolicy` 必须为 `encrypted_user_password`。
  - `syncPolicy.syncCooldownSeconds` 必须为非负整数；自动同步概览只读取这个字段，不读取 `retryPolicy`。
  - `syncPolicy.autoLoadDetailForStudent` 和 `syncPolicy.autoLoadDetailForInternalUser` 必须为 boolean；分别控制学生和 admin / reviewer 打开实验详情时是否自动加载学校数据。
  - `runtime.defaultTimeoutMs`、`runtime.postLoginSettleMs`、`runtime.postLoginWaitMs` 和 `waitPolicy` 中关键超时字段必须为正整数。
  - 不允许在配置中保存具体 Playwright 脚本代码。
  - JSONB 不支持 `//` 注释；可使用 `_comment`、`description` 等普通字段作为可保存注释。
- **Compatibility**：不兼容旧配置结构；后端以 `schema_version=1.6` 的当前结构为准。读取默认配置时，如果数据库中的 `default` 配置仍是旧结构或旧版本，将直接替换为当前默认结构。
- **列下标约定**：`selectors.reportList.columns` 使用 0 基下标；`experimentName=0` 表示读取学校列表第 1 列 `PaperName`，不要读取第 3 列 `LabName`，因为部分报告名会带批次后缀（例如 `0625`）。
- **State Change**：写入或更新 `automation_engine_configs`，并写入 `audit_logs(action=automation_config_updated)`。
- **Not Included**：当前阶段不提供 `test-login` 接口；后续如需连通性检查，再单独设计 `validate-login`。

### 6A.3 学校系统列表同步数据约束

- 首次登录后只同步轻量数据：
```json
{
  "real_name": "陈某某",
  "experiments": [
    { "experimentName": "电表的改装", "status": "未提交" }
  ],
  "summary": {
    "total": 1,
    "completed": 0,
    "unsubmitted": 1
  }
}
```
- 当前数据库不新增课程、成绩、截止时间等稳定字段；学校列表快照仅保存实验名和状态。
- 实验详情、填空节点、图片编辑器和问题回答区域按需加载：用户进入某个实验后再打开学校系统 modal 读取。
- 安全红线：自动化探测和按需读取阶段绝不点击“正式提交”；该按钮必须作为 `safety.forbiddenActions.finalSubmit` 禁点目标处理。

### 6A.3.1 统一 AI Provider 运行配置

- 后端运行时 AI 调用统一通过 `backend/services/ai_provider.py`，图片识别、实验问题生成和学校验证码识别都使用同一个 OpenAI-compatible provider。
- `AI_API_KEY` 是真实密钥，只从 `.env` / 进程环境变量读取，前端不可查看或修改。
- `ai_config` 表保存非密钥业务配置，Admin 设置页可修改，保存后立即生效。
- `.env` 中只保留部署级密钥和少量首次初始化种子。`AI_API_KEY` 每次调用都会从 `.env` / 进程环境变量读取；其它 AI 种子只在 `ai_config` 表为空、后端首次创建配置行时使用，创建后以后端数据库配置为准。

```text
AI_PROVIDER=openai_compatible
AI_API_KEY=<secret>
AI_BASE_URL=https://api.siliconflow.cn/v1
AI_DEFAULT_MODEL=deepseek-ai/DeepSeek-V4-Flash
AI_IMAGE_RECOGNITION_MODEL=zai-org/GLM-4.5V
AI_ANSWER_GENERATION_MODEL=deepseek-ai/DeepSeek-V4-Flash
AI_CAPTCHA_MODEL=zai-org/GLM-4.5V
```

- 温度、超时、最大图片数、自动识别开关和验证码 prompt 不再从 `.env` 配置；首次创建 `ai_config` 时使用代码内置默认值，之后由 Admin 设置页修改并保存到数据库。
- 不再使用 `AI_API_KEY_ENV`、`CAPTCHA_AI_*`、供应商绑定 key 名或数据库加密保存 AI Key。
- 当前不做同一次 AI 调用内部 fallback：某个 task 的模型失败即向调用方返回失败，由业务层记录任务状态和错误。
- 图片识别支持重复识别备用模型：`ai_config.image_recognition_retry_enabled=true` 时，同一 `submission_id` 第 1 次图片识别使用 `image_recognition_model`，第 2 次及以后优先使用 `task_overrides_json.image_recognition_retry`。若该 task override 未启用，则继续使用主图片识别模型。次数按已有任务/审计记录统计，覆盖详情页直接识别、审核预处理识别和旧任务列表识别；无 `submission_id` 的调试识别固定按第 1 次处理。
- `GET /api/v1/ai/admin/config`：Admin 获取当前非密钥 AI 配置、`api_key_configured` 状态和 Admin-only `task_overrides_json`。其中 `task_overrides_json.*.api_key` 会原样返回给 Admin，用于本地专用模型配置。
- `PUT /api/v1/ai/admin/config`：Admin 保存非密钥 AI profile，写入 `ai_config` 并记录 `audit_logs(action=ai_config_updated)`；图片重复识别开关字段为 `image_recognition_retry_enabled`，备用模型参数统一写入 `task_overrides_json.image_recognition_retry`。
- `PUT /api/v1/ai/admin/task-overrides`：Admin 保存任务专用 JSON 配置，当前用于 `experiment_image_auto_match` 和 `image_recognition_retry`。启用后对应任务优先使用该 JSON 中的 `provider/base_url/chat_completions_url/api_key/model/temperature/timeout_seconds/batch_size/concurrency`；融合图片匹配固定每张图片一次模型请求，`concurrency` 控制同时请求数量，默认 3。
- `POST /api/v1/ai/admin/test-connection`：使用当前 `ai_config` + `.env` 中的 `AI_API_KEY` 发送一条 `hello` 测试请求，返回模型输出；失败时返回 `ok=false`、`error_code` 和具体 `error`，例如缺少密钥时返回 `missing_api_key` 与“请在 .env 中填写 AI_API_KEY，然后重启后端进程”。
- `GET /api/v1/ai/admin/prompts/{experiment_id}`：Admin 获取实验 Prompt 模板。响应始终包含当前后端默认 `recognition_system_prompt` / `generation_system_prompt`，如果数据库中 `ai_prompt_templates` 已保存非空 system prompt，则以数据库值覆盖默认值；`recognition_extra_prompt` / `generation_extra_prompt` 从实验 JSON 的 `ai.recognition.extraPrompt` / `ai.generation.extraPrompt` 读取，用于前端编辑框展示。
- `PUT /api/v1/ai/admin/prompts/{experiment_id}`：Admin 保存 `recognition_system_prompt` 与 `generation_system_prompt` 到 `ai_prompt_templates`；保存 `recognition_extra_prompt` / `generation_extra_prompt` 到实验 JSON，并同步 `experiments.config_json`。数据库不再保存识别或思考题 extra prompt。

### 6A.3.2 AI 辅助任务公共契约

学生实验详情页和审核详情页的一键填空、AI 图片识别、一键生成回答、一键计算数据都按同一套任务语义处理：

- 前端统一使用 `useAsyncTaskRunner` 管理浮窗任务、轮询、超时和重试；页面只负责把成功结果写回表单。
- Celery 类 AI 任务入队接口返回 `task_id`、`poll_timeout_seconds`、`poll_interval_ms`、`audit_target_id`。前端轮询超时必须以 `poll_timeout_seconds` 为准，不再硬编码 60 秒。
- Celery 类 AI 任务入队时会写入 `ai_task_runs`，该表以 `task_id` 为主键保存 `task_kind`、`status`、`target_id`、`experiment_id`、`submission_id`、started/finished audit id、请求摘要、结果摘要和失败诊断；`submission_id` 仅作诊断索引，不做外键约束，避免任务日志因 submission 清理而丢失。
- `poll_timeout_seconds` 由后端按 AI profile 的模型超时加队列缓冲计算，避免模型仍在运行但前端先误报 timeout。
- 如果前端等待超时，只表示浏览器停止轮询；后台 Celery 任务可能仍会成功或失败，最终以审计日志和 task 状态为准。
- Worker 成功/失败统一通过 `services.ai_task_audit.complete_ai_task_run` / `fail_ai_task_run` 更新 `ai_task_runs` 并写 completed/failed 审计日志；Celery `task_failure` signal 兜底处理任务进入业务函数前的参数绑定等失败。
- `GET /api/v1/ai/task/{task_id}` 只返回 Celery result backend 状态，不反向扫描或修补审计日志。
- 一键计算数据是同步接口，但也使用同一套 started / completed / failed 审计 action。
- 详情页若有 `submission_id`，必须传给 AI/计算接口；后端日志 `target_id` 优先使用 submission id，否则使用 experiment id。

公共审计 action：

```text
ai_fixed_fill_started / ai_fixed_fill_completed / ai_fixed_fill_failed
ai_recognition_started / ai_recognition_completed / ai_recognition_failed
ai_answer_generation_started / ai_answer_generation_completed / ai_answer_generation_failed
formula_compute_started / formula_compute_completed / formula_compute_failed
```

学生可见日志接口 `GET /api/v1/audit/my_logs` 会展示以上 action；Admin / Reviewer 的 `GET /api/v1/audit/logs` 返回全量日志。

### 6A.4 自动化 Job 公共查询

#### GET /api/v1/school-sync/overview/latest

- **Auth Required**: Yes (Student)
- **Purpose**: 返回当前学生最近一次学校系统概览同步摘要，并告诉前端是否应自动触发同步。前端登录或进入仪表盘时先调用该接口，只有 `shouldSync=true` 才自动调用 `POST /overview`。
- **Response**:

```json
{
  "lastSyncedAt": "2026-07-05T10:00:00Z",
  "shouldSync": false,
  "cooldownSeconds": 1800,
  "remainingCooldownSeconds": 120,
  "summary": {
    "source": "school_complete_report_list",
    "realName": "陈某某",
    "total": 10,
    "completed": 1,
    "unsubmitted": 9,
    "draftSubmitted": 0,
    "finalSubmitted": 1,
    "unknown": 0
  },
  "experiments": [
    {
      "experimentName": "电表的改装",
      "originalStatusText": "临时提交",
      "schoolStatus": "school_draft_submitted",
      "schoolStatusSource": "school_submit_confirmed",
      "schoolStatusSyncedAt": "2026-07-05T10:20:00Z",
      "submissionId": "SUB-XXXX",
      "statusConfirmation": "list_confirmed"
    }
  ]
}
```

- **规则**:
  - 没有同步记录时 `shouldSync=true`。
  - 距离最近同步超过 `syncPolicy.syncCooldownSeconds` 时 `shouldSync=true`。
  - 冷却期内 `shouldSync=false`，除非用户点击手动同步按钮并调用 `POST /overview` 的 `force=true`。
  - `experiments` 仍只表达学校系统状态，不得用平台 `Submission.status` 推导学校状态。
  - 返回前会把最近一次学校概览快照与已确认的单实验提交快照合并：若某实验存在 `school_submit_confirmed` 且 `statusConfirmation=list_confirmed`，并且 `mode=draft` 对应 `school_draft_submitted` 或 `mode=final` 对应 `school_final_submitted`，则该实验的 `schoolStatus` 使用提交后回读确认结果。
  - `schoolStatusSource` 用于标记该状态来自 `school_complete_report_list` 还是 `school_submit_confirmed`；学生实验列表左侧“学校提交状态”只能使用该接口返回的学校状态，不得用平台状态兜底。
  - 如果提交 job 只有 `feedback_only`，说明学校弹窗反馈成功但列表状态未确认，该快照不会覆盖 `overview/latest` 中的学校状态。

#### GET /api/v1/school-sync/settings

- **Auth Required**: Yes (Student / Admin / Reviewer)
- **Purpose**: 返回当前登录用户打开实验详情页时是否应自动触发学校详情同步。前端必须先读该接口，再决定是否调用 `POST /api/v1/school-sync/experiments/{experiment_id}`。
- **Response**:

```json
{
  "autoLoadDetailForStudent": true,
  "autoLoadDetailForInternalUser": false,
  "autoLoadDetail": true
}
```

- **规则**:
  - `autoLoadDetailForStudent` 默认 `true`，对应学生端。
  - `autoLoadDetailForInternalUser` 默认 `false`，对应 admin / reviewer。
  - `autoLoadDetail` 是后端根据当前用户角色计算后的最终开关。
  - 该接口只返回安全策略布尔值，不返回学校账号、选择器、自动化内部配置或密码。

#### POST /api/v1/school-sync/overview

- **Auth Required**: Yes (Student)
- **Purpose**: 学生登录平台后触发学校系统概览同步。当前接口已接入 `school_overview_sync` service：创建脱敏 automation job 后尝试访问内网学校系统、使用 `users.student_no` 登录、识别验证码、确认登录结果、读取右上角真实姓名和完成报告列表，并写入 `school_sync_snapshots`。如果内网、Playwright、验证码 AI 或选择器不可用，job 进入 `failed`，不再写入伪成功概览快照。
- **Payload**:

```json
{
  "force": false
}
```

- **Response**: 返回自动化 Job 公共 DTO。前端用 `jobId` 轮询 `GET /api/v1/automation-jobs/{job_id}`。

```json
{
  "jobId": "JOB-XXXX",
  "action": "school_overview_sync",
  "status": "running",
  "messageCode": "school.overview.syncing",
  "messageParams": {},
  "canRetry": false,
  "submissionId": null,
  "experimentId": null,
  "startedAt": "2026-07-05T10:00:00Z",
  "finishedAt": null,
  "createdAt": "2026-07-05T10:00:00Z",
  "updatedAt": "2026-07-05T10:00:00Z"
}
```

- **409 Response**:

```json
{
  "detail": {
    "code": "JOB_ALREADY_RUNNING",
    "job": {
      "jobId": "JOB-EXISTING",
      "action": "school_detail_sync",
      "status": "running",
      "messageCode": "school.detail.syncing",
      "messageParams": {
        "experimentName": "电表的改装"
      },
      "canRetry": false
    }
  }
}
```

- **安全要求**:
  - 后端只返回 public job DTO，不返回学校账号、验证码、选择器、内部 payload、真实截图路径或排查 HTML。
  - 真实概览同步的截图路径、验证码图片路径和内部错误只保存在 `automation_jobs.result_payload` 等后台排查字段中，不通过学生端 public DTO 返回。
  - 同一学生已有 active automation job 时返回 `409 JOB_ALREADY_RUNNING`，避免同时操作同一个学校系统会话。
  - 相同概览同步请求在 active 状态下复用已有 job，防止重复点击创建多条任务。
  - 验证码 OCR 候选值必须匹配必填配置 `captcha.expectedLength`，当前配置为 4 位；不足或超长时不填写、不提交，直接刷新验证码重试。
  - 登录提交后必须先识别学校系统 Bootbox 错误弹窗，例如 `.bootbox.modal.in .bootbox-body` 中的 `验证码不正确`，验证码错误只进入刷新重试分支，不进入读取实验列表状态。
  - 每次创建、复用或拒绝都写入 `audit_logs`。
  - 同步成功写入 `audit_logs.action=school_overview_sync_completed`；同步失败写入 `school_overview_sync_failed`，并设置 `automation_jobs.error_code`。
  - `school_overview_sync_failed.details` 必须写入脱敏 JSON 诊断 payload，至少包含 `jobId`、`errorCode`、`reason`、`message`、`currentStep`、`request.source/force`、学校系统 URL 摘要、网络策略、运行超时和重试配置；不得包含学校密码、验证码、AI API Key、完整 HTML 或截图真实路径。

#### POST /api/v1/school-sync/experiments/{experiment_id}

- **Auth Required**: Yes (Student)
- **Purpose**: 学生进入单个实验详情页时触发学校系统单实验按需同步。后端复用当前用户的学校系统浏览器会话；如会话失效则重新登录，然后返回完成报告列表、按实验名称点击“完成报告”、打开学校报告 modal，读取当前字段值并写入 `school_sync_snapshots(source=school_report_modal)`。失败时 job 进入 `failed`，不写入 stub 快照。
- **Response**: 返回自动化 Job 公共 DTO。前端用 `jobId` 轮询 `GET /api/v1/automation-jobs/{job_id}`。

```json
{
  "jobId": "JOB-XXXX",
  "action": "school_detail_sync",
  "status": "running",
  "messageCode": "school.detail.syncing",
  "messageParams": {
    "experimentName": "exp_meter_modification"
  },
  "canRetry": false,
  "submissionId": null,
  "experimentId": "exp_meter_modification"
}
```

- **安全要求**:
  - Student 只能触发自己的学校系统同步任务。
  - 同一学生已有 active automation job 时返回 `409 JOB_ALREADY_RUNNING`，避免同时操作同一个学校系统会话。
  - 前端只接收 public job DTO，不返回选择器、验证码、密码、截图真实路径或内部 payload。
  - 后台 `automation_jobs.result_payload.sessionDiagnostic` 记录会话复用或重登决策，例如 `reused_existing_session`、`existing_session_recovery_failed`、`relogin_created_session`；该字段不进入 public job DTO。
  - 每次创建、复用或拒绝都写入 `audit_logs`。

#### POST /api/v1/school-sync/experiments/{experiment_id}/submissions/{submission_id}

- **Auth Required**: Yes (Admin / Reviewer)
- **Purpose**: 审核详情页按 submission 触发学校系统单实验详情同步。虽然请求由 admin / reviewer 发起，但后端使用 `submission.student_id` 对应学生的 `student_no` 和 `encrypted_school_password` 登录或复用学校会话，不使用当前内部账号的学校身份。
- **Response**: 返回自动化 Job 公共 DTO，前端继续用 `AutomationProgressModal` 展示进度。
- **规则**:
  - submission 必须存在，且 `submission.experiment_id` 必须等于路径中的 `experiment_id`。
  - job 的学校会话归属于 submission 学生。
  - public DTO 不返回学校账号、密码、验证码、选择器或内部诊断 payload。
  - 该接口只读取学校详情快照，不触发临时提交或正式提交。

#### POST /api/v1/school-sync/experiments/{experiment_id}/screenshot

- **Auth Required**: Yes (Student)
- **Purpose**: 学生在实验详情页请求查看学校系统当前报告提交情况。后端使用当前登录学生自己的 `student_no` 和加密学校密码登录或复用学校会话，打开对应实验报告 modal，并生成连续长截图 artifact。
- **Response**: 返回 `AutomationJobPublic`，`action=school_report_screenshot`。前端轮询 `GET /api/v1/automation-jobs/{job_id}`，成功后调用 `GET /api/v1/automation-jobs/{job_id}/screenshot` 读取图片。
- **安全要求**:
  - Student 不能通过请求体或 URL 传入 `user_id` / `student_no` 冒充他人；截图任务只绑定当前登录学生。
  - 同一学生已有 active automation job 时返回 `409 JOB_ALREADY_RUNNING`。
  - Public DTO 不返回截图真实路径、学校 HTML、选择器或内部诊断 payload。

#### POST /api/v1/school-sync/experiments/{experiment_id}/submissions/{submission_id}/screenshot

- **Auth Required**: Yes (Admin / Reviewer)
- **Purpose**: 内部人员在审核/管理详情页按 submission 查看目标学生学校系统报告提交情况。后端通过 `submission.student_id` 反查学生学校身份，不使用当前 admin / reviewer 的学校身份。
- **Response**: 返回 `AutomationJobPublic`，`action=school_report_screenshot`。
- **规则**:
  - submission 必须存在，且 `submission.experiment_id` 必须等于路径中的 `experiment_id`。
  - Admin / Reviewer 可为合法 submission 发起截图；学生无权调用该 submission 级接口。
  - Public DTO 不返回截图真实路径、学校 HTML、选择器或内部诊断 payload。

#### GET /api/v1/school-sync/experiments/{experiment_id}/latest

- **Auth Required**: Yes (Student)
- **Purpose**: 学生端在单实验同步 job 成功后读取最新 `school_report_modal` 快照，并把已按 `automation.mappings` 转换后的 `formValues` 回填到当前平台表单。该接口只返回当前学生自己的该实验快照，不返回学校 DOM 原始 HTML、截图路径、选择器或内部诊断 payload。
- **Response**:

```json
{
  "lastSyncedAt": "2026-07-06T12:00:00Z",
  "experimentId": "exp_meter_modification",
  "experimentName": "电表的改装",
  "formValues": {
    "DBGZ10-0": "1.23",
    "skt0Area": "实验误差主要来自..."
  },
  "summary": {
    "source": "school_report_modal",
    "fieldCount": 17
  }
}
```

- **Admin / Reviewer 对应接口**:

```text
GET /api/v1/school-sync/experiments/{experiment_id}/submissions/{submission_id}/latest
```

该接口从 `submission.student_id` 的学校详情快照读取 `formValues`，供审核详情页在同步 job 成功后回填平台表单。

#### POST /api/v1/school-sync/experiments/{experiment_id}/submit

- **Auth Required**: Yes
- **Purpose**: 学生在平台点击“临时提交”后，创建学校系统提交 job，并由前端弹窗或右下角任务窗口轮询公开进度。后端先保存 `platform_before_submit` 快照，再复用或重建学校会话、打开对应实验报告 modal、按实验配置 `automation.mappings` 回填平台 `corrected_json.values`、逐字段校验、点击学校系统“临时提交”、等待学校反馈、关闭 modal 或返回主实验列表，并读取该实验提交状态。`mode=final` 复用同一后端流程，只切换为正式提交 selector 和 `school_final_submitted` 状态确认；当前学生端正式提交确认按钮保持禁用，不开放用户触发。
- **Payload**:

```json
{
  "submissionId": "SUB-XXXX",
  "mode": "draft"
}
```

`mode` 可选值：

```text
draft
final
```

- **Response**: 返回自动化 Job 公共 DTO。若同一用户已有其他学校自动化任务正在执行，提交任务不会返回 `409 JOB_ALREADY_RUNNING`，而是以 `queued` 状态创建并在后台按创建时间顺序等待前序任务结束后执行，避免同时操作同一个学校系统会话。

```json
{
  "jobId": "JOB-XXXX",
  "action": "draft_submit",
  "status": "queued",
  "messageCode": "school.submit.saving",
  "messageParams": {
    "experimentName": "电表的改装"
  },
  "canRetry": false,
  "submissionId": "SUB-XXXX",
  "experimentId": "exp_meter_modification"
}
```

- **状态结果**:
  - `mode=draft` 只有在学校系统反馈或回读状态确认成功后，submission 状态才更新为 `draft_submitted`。
  - `mode=final` 只有在学校系统反馈或回读状态确认成功后，submission 状态才更新为 `completed`。
  - 创建提交 job 时写入 `school_draft_submit_started` 或 `school_final_submit_started`；成功写入 `school_draft_submit_completed` 或 `school_final_submit_completed`；失败写入 `school_draft_submit_failed` 或 `school_final_submit_failed`。这些 audit log 的 `target_id` 统一为 submission id，job id 只允许作为 details 中的诊断信息。
  - `mode=final` 复用同一提交链路；只有在学校系统反馈或回读状态确认成功后，submission 状态才更新为 `completed`。
  - 提交 job 必须在同一浏览器会话内等待学校提交完成，再返回完成报告列表读取状态并写入 `school_sync_snapshots`；平台不能仅凭“已点击提交按钮”推断学校提交成功。
  - 如果学校反馈成功但列表状态未能确认，job 可以成功落库，并记录 `statusConfirmation=feedback_only`，方便后续同步或排查确认来源。
- **字段写入要求**:
  - 后端按实验配置 `automation.mappings[]` 写入学校 DOM；`targetType` 缺省为 `text`，特殊控件才显式配置为 `wysiwyg_text` 或 `wysiwyg_image`。
  - `text` 字段走普通表单写入与回读校验；`wysiwyg_text` 字段写入富文本可编辑区域并同步隐藏 textarea；`wysiwyg_image` 字段点击学校富文本插入图片工具栏并通过 file input 上传。
  - 提交前必须生成字段写入报告，至少区分 `succeededFields`、`skippedEmptyFields`、`failedFields`、`unsupportedFields`。
  - 只要 `failedFields` 或 `unsupportedFields` 非空，后端必须停止提交，不点击学校系统“临时提交 / 正式提交”按钮。
  - 字段写入失败应优先使用 `FIELD_WRITE_VERIFY_FAILED`、`WYSIWYG_TEXT_WRITE_FAILED`、`WYSIWYG_IMAGE_UPLOAD_FAILED` 等明确错误码；`automation_jobs.error_message` 和后台审计可保存脱敏节点摘要，public job DTO 不返回选择器、HTML、截图路径或内部诊断。
- **安全要求**:
  - Student 只能提交自己的 self-managed submission。
  - Student 不能通过该接口处理 `is_one_click_handoff=true` 的代写任务。
  - 后端根据 submission 当前 `corrected_json` 和 `image_paths` 计算幂等内容，不信任前端 hash。
  - 前端只接收 public job DTO，不返回学校系统选择器、字段校验细节、截图真实路径或内部 payload。
  - 后台 `automation_jobs.result_payload.sessionDiagnostic` 记录本次提交是否复用了仪表盘概览同步留下的学校窗口，以及是否发生重新登录；该字段不进入 public job DTO。

#### GET /api/v1/automation-jobs/{job_id}

- **Auth Required**: Yes
- **权限**:
  - Student 只能查看自己发起或自己 submission 关联的 job。
  - Admin / Reviewer 可以查看 job 的公共状态。
- **安全要求**:
  - 只返回脱敏 public 状态。
  - 不返回 `request_payload`、`result_payload`、`sensitive_payload`、学校系统选择器、验证码、密码、API Key、完整 HTML 或截图真实路径。
  - 对学校系统自动化 job，轮询时会检查关联学校浏览器会话；如果检测到 page 已关闭，后端会将 job 标记为 `failed`，`error_code=SCHOOL_BROWSER_CLOSED`，避免前端无限轮询 active job。
- **Response**:

```json
{
  "jobId": "JOB-XXXX",
  "action": "school_overview_sync",
  "status": "running",
  "messageCode": "school.overview.syncing",
  "messageParams": {
    "experimentName": "电表的改装"
  },
  "canRetry": false,
  "submissionId": null,
  "experimentId": null,
  "targetStudentNo": null,
  "targetRealName": null,
  "startedAt": null,
  "finishedAt": null,
  "createdAt": "2026-07-05T10:00:00Z",
  "updatedAt": "2026-07-05T10:00:00Z"
}
```

#### GET /api/v1/automation-jobs/{job_id}/screenshot

- **Auth Required**: Yes
- **Purpose**: 返回 `school_report_screenshot` job 生成的学校报告长截图二进制。
- **权限**:
  - Admin / Reviewer 可读取。
  - Student 只能读取自己可见的 automation job：`actor_user_id` 为自己，或 job 关联的 submission 属于自己。
  - 后端校验截图路径必须位于该 job artifact 目录下，防止路径穿越读取本机文件。
- **Response**: `image/png` FileResponse。
- **错误**:
  - `400`: job 不是 `school_report_screenshot`。
  - `409`: job 尚未成功完成，截图未就绪。
  - `403`: 无权查看该 job 或 artifact 路径非法。
  - `404`: job 或截图 artifact 不存在。

#### POST /api/v1/automation-jobs/{job_id}/cancel

- **Auth Required**: Yes
- **Purpose**: 管理员手动终止正在运行的自动化任务。用于服务器侧 Playwright 浏览器被关闭、任务明显卡住或需要人工介入时解除 active job。
- **权限**:
  - 仅 Admin 可调用。
  - Student / Reviewer 调用返回 `403`。
- **State Change**:
  - 仅 active job 可被终止。
  - 终止后 `automation_jobs.status=failed`，`public_status=failed`，`error_code=JOB_CANCELLED`，`public_message_params.reason=任务已手动终止`。
  - 若 job 关联 submission，submission 会更新为 `error`，避免继续展示提交中。
- **Response**: 返回自动化 Job 公共 DTO。
  - 对绑定 submission 的 job，DTO 会额外返回 `targetStudentNo`、`targetRealName`，用于 admin 运维页面定位目标学生；不返回学校密码、payload 或内部诊断。

#### GET /api/v1/automation-jobs/active

- **Auth Required**: Yes
- **Query**:
  - `action` 可选。
  - `experiment_id` 可选。
  - `submission_id` 可选。
- **Response**: 返回当前用户可见的 active job 公共列表。Admin 自动化任务页会使用该接口列出即使没有可复用浏览器会话也仍处于 active 的任务，并允许通过 `POST /api/v1/automation-jobs/{job_id}/cancel` 手动终止。
- **Active 状态**:

```text
queued
running
retrying
waiting_manual_vpn_auth
waiting_manual_2fa
```

#### 数据模型补充

`automation_jobs` 新增字段：

```text
idempotency_key
public_status
public_message_code
public_message_params
sensitive_payload
```

其中 `sensitive_payload` 永远不通过普通前端接口返回。

#### Job 创建幂等规则

后端创建自动化 job 必须通过统一 helper：

- 根据 action、当前用户、实验 / submission 和后端计算的内容 hash 生成 `idempotency_key`。
- 如果相同 `idempotency_key` 已存在 active job，直接返回已有 job。
- 如果相同 `idempotency_key` 但请求内容 hash 不一致，返回 `409 IDEMPOTENCY_CONFLICT`。
- 默认情况下，如果同一用户已有 active job 正在操作学校 session，返回 `409 JOB_ALREADY_RUNNING`。
- 学校提交任务 `draft_submit/final_submit` 是例外：不同 submission 的提交任务允许创建为 `queued` 并串行执行；相同 `idempotency_key` 仍复用已有 active job，相同 key 但内容 hash 不一致仍返回 `409 IDEMPOTENCY_CONFLICT`。
- 数据库层使用 active 状态 partial unique index 防止并发请求创建重复 active job。

## 6.5 同学管理 (Admin Students)

### 6.5.1 查询学生总览
- **Endpoint**: `GET /api/v1/admin/students`
- **Auth Required**: Yes (Admin)
- **Query**: `page`、`pageSize`、`query`、`finalCountFilter`
- **`finalCountFilter`**：
  - `lt8`: 只返回学校正式提交 / 已评分实验数小于 8 的学生。
  - `gte8`: 只返回学校正式提交 / 已评分实验数大于等于 8 的学生。
  - 为空或未传：返回全部学生。
- **Response**: 只返回当前分页的学生摘要，不再返回全部学生实验展开数据；旧数组响应已删除。
```json
{
  "items": [
    {
      "id": 1,
      "studentNo": "26A2510200112",
      "realName": "张三",
      "lastSyncedAt": "2026-07-08T10:00:00Z",
      "summary": {
        "totalExperimentCount": 11,
        "finalSubmittedCount": 3,
        "draftSubmittedCount": 2,
        "platformCompletedCount": 1,
        "pendingSyncCount": 6
      },
      "experiments": []
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 5,
  "summary": {
    "totalStudents": 100,
    "finalSubmittedCount": 3,
    "draftSubmittedCount": 2,
    "pendingSyncCount": 6
  }
}
```
- **口径**：
  - `finalSubmittedCount` 统计学校状态 `school_final_submitted`。
  - `draftSubmittedCount` 统计学校状态 `school_draft_submitted`。
  - 实验展开行同时返回学校状态 `schoolStatus` 与平台状态 `status`，避免混用平台提交状态和学校提交状态。
  - 列表接口的 `summary.totalStudents` 是筛选后的全量学生数；其他统计按当前页学生摘要计算。
  - 学生摘要读取最新学校概览快照，并合并 `school_submit_confirmed + list_confirmed` 的临时/正式提交确认快照；不展开实验、不扫描 submission。需要精确到实验行时调用展开接口。

### 6.5.1.1 查询单个学生实验展开列表
- **Endpoint**: `GET /api/v1/admin/students/{student_id}/experiments`
- **Auth Required**: Yes (Admin)
- **Response**: 返回该学生所有启用实验的展开行。
```json
[
  {
    "id": "exp_meter_modification",
    "name": "电表的改装",
    "status": "incomplete",
    "submissionId": "SUB-XXXX",
    "schoolStatus": "school_draft_submitted",
    "originalStatusText": "已临时提交",
    "schoolStatusSyncedAt": "2026-07-08T10:00:00Z"
  }
]
```

### 6.5.2 添加或更新学生
- **Endpoint**: `POST /api/v1/admin/students`
- **Auth Required**: Yes (Admin)
- **Payload**:
```json
{
  "studentNo": "26A2510200112",
  "password": "school-password"
}
```
- **逻辑**：
  1. 校验学生学号格式。
  2. 不存在则创建 `role=student` 用户。
  3. 已存在则更新平台登录密码 hash 和加密学校系统密码。
  4. 学校密码只保存为 `encrypted_school_password`，不得明文返回前端。

### 6.5.3 刷新指定学生学校状态
- **Endpoint**: `POST /api/v1/admin/students/{student_id}/sync-overview`
- **Auth Required**: Yes (Admin)
- **Payload**:
```json
{
  "closeSessionAfterFinish": true
}
```
- **Response**: 返回 `AutomationJobPublic`，前端复用自动化进度弹窗轮询 `/api/v1/automation-jobs/{job_id}`。
- **逻辑**：管理员作为操作人触发，实际学校系统登录身份使用目标学生的 `student_no` 和加密学校密码。`closeSessionAfterFinish=true` 时，无论刷新成功或失败，任务结束后都会关闭该学生的 Playwright 学校浏览器会话，适合可视化非 Headless 批量刷新。

### 6.5.4 为未提交实验创建编辑任务
- **Endpoint**: `POST /api/v1/admin/students/{student_id}/experiments/{experiment_id}/edit-submission`
- **Auth Required**: Yes (Admin)
- **Response**: 返回 `Submission`。
- **逻辑**：
  1. 若该学生该实验已有普通编辑 submission（`is_one_click_handoff=false`），直接复用。
  2. 若没有，则创建 `status=incomplete`、`payment_status=not_required` 的普通 submission，`submitted_by` 记录当前管理员。
  3. 用于 Admin 同学管理页中“未提交”实验点击“编辑与提交”时生成可编辑任务。

### 6.5.5 检查学校系统填空完整性
- **启动 Endpoint**: `POST /api/v1/admin/students/{student_id}/completion-check`
- **结果 Endpoint**: `GET /api/v1/admin/students/{student_id}/completion-check/{job_id}`
- **Auth Required**: Yes (Admin)
- **启动 Response**: 返回 `AutomationJobPublic`，`action=school_completion_check`，前端复用自动化进度弹窗轮询 `/api/v1/automation-jobs/{job_id}`。
- **结果 Response**: 返回该学生所有启用实验的学校系统实时完整性结果。实验结果包含 `checkStatus=checked/skipped`、`schoolStatus`、`complete` 和缺失项名称列表，前端显示为对勾 / 叉号 / 跳过。
- **超时保护**：后端默认整次检查最多执行 300 秒；可通过自动化配置 `runtime.completionCheckTimeoutMs` 调整，超时后 job 置为 `failed`，`errorCode=COMPLETION_CHECK_TIMEOUT`。
- **检查来源**：
  1. 不读取平台 submission、draft 或学校同步缓存。
  2. 后端使用目标学生的学校系统会话读取完成报告列表。
  3. 只有学校状态为 `school_draft_submitted` 或 `school_final_submitted` 的实验会打开详情页检查 DOM。
  4. 其他学校状态的实验返回 `checkStatus=skipped`，并保留跳过原因。
  5. DOM 检查只做快速存在性判断：普通输入检查 `value/textContent`，富文本检查编辑器文本或 HTML，图片编辑器检查是否存在 `<img>`。

### 6.5.6 查看所有提交截图
- **启动 Endpoint**: `POST /api/v1/admin/students/{student_id}/submission-screenshots`
- **结果 Endpoint**: `GET /api/v1/admin/students/{student_id}/submission-screenshots/{job_id}`
- **截图 Endpoint**: `GET /api/v1/admin/students/{student_id}/submission-screenshots/{job_id}/files/{experiment_id}`
- **Auth Required**: Yes (Admin)
- **启动 Response**: 返回 `AutomationJobPublic`，`action=school_submission_screenshots`，前端复用右下角异步任务窗口轮询 `/api/v1/automation-jobs/{job_id}`。
- **逻辑**：
  1. 管理员触发，实际学校系统登录身份使用目标学生的 `student_no` 和加密学校密码。
  2. 后端实时读取学校完成报告列表，只对学校状态为 `school_draft_submitted` 或 `school_final_submitted` 的实验打开报告 modal 并生成长截图。
  3. 未提交、未知或未同步的实验返回 `captureStatus=skipped`，不打开、不截图。
  4. 单个实验打开失败返回 `captureStatus=error`，不阻塞其他已提交实验截图。
  5. 结果接口只返回 `captureStatus/schoolStatus/screenshotAvailable` 等公共字段，不返回截图真实路径。
  6. 截图文件接口会校验 job 属于该学生、action 正确且文件路径位于该 job artifact 目录内。

### 6.5.7 将临时提交批量转为正式提交
- **启动 Endpoint**: `POST /api/v1/admin/students/{student_id}/final-submit-drafts`
- **Auth Required**: Yes (Admin)
- **启动 Response**: 返回 `AutomationJobPublic`，`action=admin_final_submit_drafts`，前端复用右下角异步任务窗口轮询 `/api/v1/automation-jobs/{job_id}`。
- **前置条件**：
  1. 后端实时读取目标学生学校完成报告列表。
  2. 学校状态为 `school_final_submitted` 和 `school_draft_submitted` 的数量之和必须刚好等于 8，否则任务失败，不点击正式提交。
  3. 只处理 `school_draft_submitted` 的实验；已正式提交的实验跳过。
- **逻辑**：
  1. 管理员触发，实际学校系统登录身份使用目标学生的 `student_no` 和加密学校密码。
  2. 后端按学校列表顺序逐个打开临时提交实验报告 modal。
  3. 不重新写入表单字段，只点击学校系统“正式提交”，等待反馈并回到列表确认状态。
  4. 每个成功转正式提交的实验写入 `school_submit_confirmed + list_confirmed` 快照；全部处理后刷新概览快照。
  5. 任务失败只返回公共错误原因，不返回学校密码、内部 payload 或 artifact 真实路径。

## 6.6 学生学校系统检查与截图

### 6.6.1 检查自己的学校系统填空完整性
- **全部实验启动 Endpoint**: `POST /api/v1/school-sync/completion-check`
- **单实验启动 Endpoint**: `POST /api/v1/school-sync/experiments/{experiment_id}/completion-check`
- **结果 Endpoint**: `GET /api/v1/school-sync/completion-check/{job_id}`
- **Auth Required**: Yes (Student)
- **权限**：
  1. student 不能传 `student_id`，后端固定使用当前登录用户 `current_user.id`。
  2. admin/reviewer 不能调用学生入口；代查学生仍使用 Admin 同学管理接口。
  3. 单实验入口会校验实验存在且启用。
- **行为**：
  1. 全部实验入口检查当前学生学校系统中所有已临时提交 / 正式提交实验。
  2. 单实验入口只检查当前实验。
  3. 未提交、未知或未同步的实验返回 `checkStatus=skipped`。
  4. 结果结构复用 Admin 完整性检查结果：`summary` + `experiments[]`。

### 6.6.2 查看自己的学校系统提交截图
- **全部实验启动 Endpoint**: `POST /api/v1/school-sync/submission-screenshots`
- **全部实验结果 Endpoint**: `GET /api/v1/school-sync/submission-screenshots/{job_id}`
- **全部实验截图文件 Endpoint**: `GET /api/v1/school-sync/submission-screenshots/{job_id}/files/{experiment_id}`
- **单实验启动 Endpoint**: `POST /api/v1/school-sync/experiments/{experiment_id}/screenshot`
- **单实验截图文件 Endpoint**: `GET /api/v1/automation-jobs/{job_id}/screenshot`
- **Auth Required**: Yes (Student)
- **权限**：
  1. student 只能创建和读取 `actor_user_id=current_user.id` 的截图 job。
  2. 全部实验截图文件接口只允许读取该 job artifact 目录下的截图文件。
  3. admin/reviewer 的代查截图仍使用 submission 或 Admin 同学管理接口。
- **行为**：
  1. Dashboard 使用全部实验入口，只截取学校状态为临时提交 / 正式提交的实验。
  2. 我的实验列表使用单实验入口，只打开当前实验并生成长截图。

## 7. 订单与支付 (Orders)
订单不再由散落接口创建。套餐升级、按实验计价和一键批量托管统一通过 `/api/v1/checkout/quote` 与 `/api/v1/checkout/submit` 完成计价和创建。

### 7.1 Checkout 报价与创建 (学生端 / 内部代交)
- **Endpoint**: `POST /api/v1/checkout/quote`
- **Endpoint**: `POST /api/v1/checkout/submit`
- **实验项字段**：`experiments[].image_slots` 保存已归位图片；`experiments[].image_assignment_confirmed` 默认为 `true`。融合图片自动匹配按实验分别传该字段：图片槽已完整归位的实验传 `true`，缺槽的实验传 `false`；后端会创建提交，但 `false` 的实验不自动进入 AI 预处理，保留在图片待对应状态。
- **Response**: 返回 `quote`、可选 `order`、`submissions` 和 `submission_batch_id`。
- **计价原则**：
  1. 前端不传、不决定金额。
  2. 套餐金额来自后端统一价格常量：Plus 16 元，Pro 35 元。
  3. 单次一键托管金额当前统一为每个实验 5 元；后续如做每个实验自定义金额，需要先调整统一价格表和测试。
  4. 一个批次只生成一笔订单；多个实验通过 `order_items` 表表达明细。

### 7.2 查询订单列表 (管理员端)
- **Endpoint**: `GET /api/v1/orders`
- **Query**: `page`、`pageSize`、`status`、`plan`、`query`
- **Response**：返回分页对象，不保留旧数组响应。订单 `items[]` 内包含订单明细，管理员展开后可查看每个实验明细、单价、数量、总价和计价快照。
```json
{
  "items": [
    {
      "id": "ORDER-XXXX",
      "student_username": "26A2510200112",
      "student_no": "26A2510200112",
      "real_name": "张三",
      "plan": "pay_per_use",
      "order_type": "one_click_batch",
      "amount": 15,
      "status": "pending_payment",
      "items": []
    }
  ],
  "total": 30,
  "page": 1,
  "pageSize": 20,
  "summary": {
    "pendingCount": 5,
    "rejectedCount": 1,
    "paidTotalAmount": 300,
    "paidTodayAmount": 35
  }
}
```

### 7.3 审核收款 (管理员端)
- **Endpoint**: `POST /api/v1/orders/{id}/verify`
- **Payload**: `{ "action": "verify" }` 或 `{ "action": "reject" }`
- **逻辑**：确认收款后，套餐订单更新用户套餐；所有绑定该订单的 submission 统一从待支付放行。驳回时，绑定 submission 标记为支付异常。

## 8. 任务与列表 (Submissions List)
**现状缺口**：ReviewerTasksPage (审核任务) 和 StudentExperiments (我的实验) 的列表数据需要 API，且必须严格隔离。

### 8.1 获取我的实验 (学生端)
- **Endpoint**: `GET /api/v1/submissions/my`
- **限制**：只返回当前 JWT token 对应 `user_id` 的任务。

### 8.2 获取审核任务池 (管理员/审核员端)
- **Endpoint**: `GET /api/v1/submissions/review-pool`
- **Query**: `page`、`pageSize`、`query`、`status`、`reviewStatus`
- **限制**：**绝对禁止学生调用！** 仅限 Reviewer/Admin 角色。
- **Response**: 返回分页对象，不保留旧数组响应。
```json
{
  "items": [
    {
      "id": "SUB-XXXX",
      "student_id": 1,
      "student_username": "26A2510200112",
      "student_name": "张三",
      "student_no": "26A2510200112",
      "experiment_id": "exp_meter_modification",
      "status": "reviewing",
      "submission_batch_id": "BATCH-XXXX",
      "image_count": 1,
      "assigned_image_count": 1,
      "preprocess_status": "done",
      "preprocess_error": null,
      "updated_at": "2026-07-08T10:00:00Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20,
  "summary": {
    "reviewing": 5,
    "draft_submitted": 3
  }
}
```
- **状态范围**：审核任务表保留处理中和已完成提交记录，返回 `pending_image_assignment`、`preparing_review`、`pending_recognition`、`recognizing`、`reviewing`、`submitting`、`draft_submitted`、`completed`、`error` 等状态；前端通过状态筛选查看“待人工审核”、“已临时提交”或“正式提交完成”。

## 9. 仪表盘数据盘 (Dashboard Stats)
**现状缺口**：`StudentDashboardPage` 以及未来的 `AdminDashboard` 上面的进度环、统计卡片需要数据。
### 9.1 获取统计概览
- **Endpoint**: `GET /api/v1/dashboard/stats`
- **Response**:
```json
{
  "progress": { "completed": 1, "total": 6 },
  "metrics": {
    "pending": 3,
    "processing": 1,
    "completed": 2
  }
}
```

## 10. 存储与文件上传 (Storage)
**现状缺口**：图片必须持久化，不能存 Base64 塞满数据库。

### 10.1 上传实验图片（当前实现）
- **Endpoint**: `POST /api/v1/files/upload`
- **Auth Required**: Yes
- **权限**：任意已登录用户可上传；上传后的 URL 只能写入该用户有权创建或编辑的 submission / draft / checkout payload。
- **Content-Type**: `multipart/form-data`
- **Payload**: `file`
- **限制**：
  - 文件大小最大 20MB。
  - 后端会读取文件头校验真实图片格式；只允许 `jpg/jpeg/png/webp/gif/bmp`。
  - SVG、伪造 `Content-Type` 的非图片内容、超大文件会被拒绝。
- **Response**:
```json
{
  "status": "success",
  "url": "/uploads/2026-07/uuid.png",
  "filename": "raw.png"
}
```
- **说明**：返回的 `/uploads/...` 是平台内部文件引用路径，不再是公开静态访问 URL；前端预览必须通过鉴权读取接口获取 blob。

### 10.2 鉴权读取上传图片（当前实现）
- **Endpoint**: `GET /api/v1/files/view?path=/uploads/2026-07/uuid.png`
- **Auth Required**: Yes
- **权限**：
  - admin / reviewer 可读取审核和自动化所需上传图片。
  - student 只能读取本人上传的图片，或本人 submission / draft 中引用的图片。
- **Response**: 图片二进制 `FileResponse`。
- **禁止**：直接访问 `/uploads/...` 不再提供静态文件服务。

### 10.3 获取上传凭证 (预签名 URL，规划项)
- **Endpoint**: `POST /api/v1/upload/presigned-url`
- **Payload**: `{ "filename": "exp1.jpg", "content_type": "image/jpeg" }`
- **Response**: 返回 OSS/S3/MinIO 的直传 URL。前端把图片 PUT 过去后，拿到最终的图片 URL 传给业务接口。

## 11. 操作日志 (Audit Logs)
**现状缺口**：前端已经把高复用日志页面搭好了，需要后端吐完整的数据。
**强制规则**：前面提到的“图片识别”、“简答题生成”、“公式推导”、“自动填报”等所有核心动作，后端必须按 started / completed / failed 写入 `audit_logs` 表。

### 11.1 查询日志列表 (管理员)
- **Endpoint**: `GET /api/v1/audit/logs`
- **Response**: 返回高度结构化的日志信息，供前端展示在 AdminOperationLogsPage。
```json
{
  "code": 200,
  "data": [
    {
      "id": 1001,
      "user": { "id": 5, "name": "李四", "role": "admin" },
      "action": "ai_recognition_failed", 
      "status": "failed",
      "target_id": "submission_123",
      "details": "AI返回超时或图片模糊无法识别",
      "created_at": "2026-06-30T09:30:00Z"
    },
    {
      "id": 1002,
      "user": { "id": 5, "name": "李四", "role": "admin" },
      "action": "formula_compute_completed",
      "status": "success",
      "target_id": "submission_123",
      "details": "根据牛顿环公式推导了N4的值",
      "created_at": "2026-06-30T09:31:00Z"
    }
  ]
}
```

### 11.2 查询学生最近操作
- **Endpoint**: `GET /api/v1/audit/my_logs`
- **Auth Required**: Yes
- **权限与过滤**:
  - 返回当前登录学生本人发起的日志，以及 `target_id` 指向其 order / submission 的日志；因此 admin / reviewer / worker 对该学生任务产生的完成类日志也会出现在学生最近操作中。
  - 只返回学生可理解的业务动作白名单，例如订单、支付、上传、AI 识别和自动化填报状态。
  - 学校提交日志统一使用 `school_draft_submit_started/completed/failed` 和 `school_final_submit_started/completed/failed`；`target_id` 必须指向 submission id，不再使用旧的通用 submit action。
  - 不返回内部审计动作，例如 `save_submission_correction`、配置保存、公式保存、刷新配置等；这些仍保留在 Admin / Reviewer 审计日志中。
- **Response**:
```json
[
  {
    "action": "order_created",
    "status": "success",
    "details": "创建订单。",
    "created_at": "2026-07-03T10:30:00Z"
  }
]
```

## 12. Playwright 学校系统会话管理

### 12.1 查询当前学校系统浏览器会话
- **Endpoint**: `GET /api/v1/automation-jobs/school-browser-sessions`
- **Auth Required**: Yes
- **权限**：仅 admin。
- **Response**:
```json
[
  {
    "userId": 12,
    "studentNo": "26A2512345678",
    "realName": "张三",
    "source": "overview_login",
    "state": "report_list",
    "createdByJobId": "AUTO-xxx",
    "createdAt": "2026-07-08T10:00:00Z",
    "lastUsedAt": "2026-07-08T10:05:00Z",
    "pageClosed": false,
    "url": "https://...",
    "rowCount": 17,
    "bootboxVisible": false,
    "modalVisible": false,
    "loadingVisible": false,
    "activeJobCount": 0,
    "diagnostic": {}
  }
]
```

### 12.2 关闭单个学校系统浏览器会话
- **Endpoint**: `DELETE /api/v1/automation-jobs/school-browser-sessions/{user_id}`
- **Auth Required**: Yes
- **权限**：仅 admin。
- **Response**: `{ "closed": 1 }`

### 12.3 关闭全部学校系统浏览器会话
- **Endpoint**: `DELETE /api/v1/automation-jobs/school-browser-sessions`
- **Auth Required**: Yes
- **权限**：仅 admin。
- **Response**: `{ "closed": 3 }`
- **说明**：关闭会话会释放后端保留的 Playwright context/browser/playwright 实例；如果对应学生仍有自动化任务执行中，该任务可能失败。

### 12.4 重启 Backend 服务
- **Endpoint**: `POST /api/v1/automation-jobs/backend/restart`
- **Auth Required**: Yes
- **权限**：仅 admin。
- **Response**:
```json
{
  "accepted": true,
  "message": "Backend restart requested. Docker restart policy will bring it back."
}
```
- **说明**：接口先写入 `audit_logs(action=backend_restart_requested)` 并返回响应，然后延迟退出当前 backend 进程；Docker Compose 中 backend 服务依赖 `restart: unless-stopped` 自动拉起。重启会中断后端内存中的 Playwright 会话，正在执行的学校自动化任务可能失败。

## 13. 学校报告列表状态

- 学校报告列表实验项可携带 `score` 字段。
- 当 `score` 为数字时，后端将该实验的 `schoolStatus` 置为 `school_graded`，前端展示为 `已评分：{score}`。
- `school_graded` 计入已完成实验，不计入临时提交；完整性检查和所有提交截图会跳过该实验，原因说明为“学校系统已评分：{score}，完成报告不可打开”。
- 自动化配置读取列位于 `config_json.selectors.reportList.columns`：
```json
{
  "experimentName": 0,
  "status": 6,
  "score": 7
}
```

## 14. 实验数据合理性检查

### 14.1 检查当前实验数据
- **Endpoint**: `POST /api/v1/experiments/{experiment_id}/score-check`
- **Auth Required**: Yes
- **权限**：仅 `admin` / `reviewer`。`student` 调用返回 `403`。
- **Payload**：

```json
{
  "current_form_values": {
    "D7": "0.0401",
    "D9": "0.999"
  },
  "submission_id": "SUB-XXXX"
}
```

- **权限与数据规则**：
  1. 接口只读取请求中的当前页面表单值，不触发 `formulas`，不自动计算，不回填数据。
  2. `submission_id` 可选；传入时必须属于当前实验。学生无权调用；admin / reviewer 可检查其可处理页面中的数据。
  3. 评分规则只来自后端实验配置 `scoreCheck.items`，前端不接收规则明细。
  4. `GET /api/v1/experiments/{experiment_id}` 只返回 `scoreCheck` 摘要，不返回 `items`、标准值、区间或公式；完整配置仅 admin 的 raw-config 管理接口可见。
  5. 只配置可计算或教师 HTML 明确标注计算/区间规则的项目；文本理解、图片质量、主观评分项不计入。

- **Response**：

```json
{
  "experimentId": "exp_potentiometer",
  "experimentTitle": "电位差计的原理和使用",
  "enabled": true,
  "totalScore": 10,
  "computableScore": 4,
  "score": 3.5,
  "itemCount": 4,
  "items": [
    {
      "id": "potentiometer_fit_k",
      "title": "拟合斜率 k",
      "status": "partial",
      "score": 0.5,
      "maxScore": 1,
      "value": 0.043,
      "reason": "k在 0.036 到 0.044 之间"
    }
  ],
  "notes": ["仅检查教师 HTML 中明确给出数值区间的项目。"]
}
```

- **状态枚举**：
  - `full`: 满分。
  - `partial`: 有分但未满分。
  - `zero`: 未得分。
  - `missing`: 当前页面缺少该项所需数据。
  - `unsupported`: 配置存在但当前后端暂不支持该规则类型。
- `numeric_range` 可选配置 `requiredSignificantDigits` 或 `requiredDecimalPlaces`。配置后，命中数值区间但格式不符合时只拿区间分；命中区间且格式符合时拿 `maxScore`。有效数字/小数位按当前页面提交的原始字符串判断，不由浮点数反推。

### 14.2 典型参考值检查

实验配置可额外声明 `referenceValueCheck`。该结果只做合理性提示，不参与 `score` / `computableScore`。

```json
{
  "referenceChecks": {
    "enabled": true,
    "label": "按典型参考值检查",
    "itemCount": 1,
    "items": [
      {
        "id": "steel_wire_young_modulus_typical",
        "title": "钢丝杨氏模量 E",
        "level": "warning",
        "metric": 13.2,
        "metricLabel": "相对偏差(%)",
        "reason": "相对钢材典型杨氏模量偏差较大",
        "referenceValue": 2.0,
        "referenceUnit": "10¹¹ Pa",
        "referenceSource": "钢材典型杨氏模量约 2.0×10¹¹ Pa，非学校评分标准。"
      }
    ],
    "notes": ["按材料典型值做合理性提示，不计入学校评分。"]
  }
}
```

- `admin` 响应包含 `referenceValue` / `referenceUnit` / `referenceSource`，用于审核时判断参考依据。
- 非 admin 响应不返回典型参考值，只返回 `level`、偏差程度和说明，避免用户把典型值误认为学校评分标准。
- `referenceValueCheck.items` 支持 `relative_error_percent` 附带 `requiredSignificantDigits` / `requiredDecimalPlaces`；也支持 `numeric_precision` 作为不计分的格式检查项。
- `level` 可为：
  - `good`: 与典型参考值或典型规律接近。
  - `warning`: 偏差较大。
  - `danger`: 明显异常。
  - `missing`: 缺少数据。
  - `unsupported`: 后端暂不支持该典型检查类型。
