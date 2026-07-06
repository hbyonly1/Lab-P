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

### 3.0.1 创建一键托管提交记录

- **Endpoint**: `POST /api/v1/submissions/submit`
- **Auth Required**: Yes
- **Payload**:

```json
{
  "experiment_id": "exp_meter_modification",
  "is_hungup": true,
  "plan": "pay_per_use",
  "image_paths": ["/uploads/2026-07/raw.jpg"]
}
```

- **后端执行的严格逻辑**：
  1. 只创建 `is_one_click_handoff=true` 的 submission。
  2. `image_paths` 至少包含一个已上传图片 URL；空数组或全空值请求返回 `400`，不得创建订单或审核任务。
  3. 学生不是 Pro 且没有已支付单次订单时，只有 `is_hungup=true` 才允许创建待付款订单。
  4. 前端批量提交时只能对已上传图片的实验调用该接口，未上传图片的实验必须留空，不进入人工审核池。

### 3.1 临时保存 (Save Draft / Auto-save)
- **Endpoint**: `PATCH /api/v1/submissions/{id}/correction`
- **Auth Required**: Yes (仅验证资源所属权，学生和管理员均可调用)
- **Payload**:
```json
{
  "corrected_json": {
    "temperature": "25",
    "pressure": "101.3"
  }
}
```
- **后端执行的严格逻辑**：
  1. **落库暂存**：更新 `corrected_json` 字段。任务的 `status` 仍保持 `incomplete`（未完成）或 `reviewing`（审核中），前端可做节流自动保存或点击“暂存”按钮触发。
  2. **支付语义**：临时保存不触发订单，也不允许因为没有订单而把状态改成 `pending_payment`。

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
**注意：AI 识别、计算和生成均为强同步接口（Blocking），必须等待 AI 和引擎算完后才返回数据。**

### 4.1 一键填空 (Fixed Params)
获取该实验固定的常量数据（如默认器材参数）。
- **Endpoint**: `GET /api/v1/experiments/{exp_id}/fixed-params`
- **Response**:
```json
{
  "code": 200,
  "data": {
    "SYMD_Fill_0": "电压表和欧姆表",
    "SYMD_Fill_1": "1500"
  }
}
```

### 4.2 AI 图像识别 (OCR & Extraction)
根据上传的原始数据图片，调用大模型提取结构化数据。
- **Endpoint**: `POST /api/v1/experiments/{exp_id}/recognize`
- **Payload**:
```json
{
  "image_urls": ["https://oss.example.com/img1.jpg"]
}
```
- **Response**:
```json
{
  "code": 200,
  "data": {
    "Ig": "100",
    "Rg": "1500",
    "E": "1.5"
  }
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
- **公式表达式能力**：表达式由后端 `simpleeval` 白名单执行，支持基础数学运算，以及后端在 `backend/services/experiment_formulas.py` 显式注册的辅助函数。统一使用 `v()` 取值：`v('A')` 读取单个节点，`v('A','B')` 读取多个节点并返回数组，`v(200,400)` 表示常量数组。当前已注册 `v`、`reciprocal`、`reciprocal_values`、`linear_slope`、`linear_intercept`、`linear_r2`、`format_sig`；公式函数不读取 UI 表格结构，所有依赖节点或常量必须在公式中显式写出。
- **Response**:
```json
{
  "code": 200,
  "data": {
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
- **核心逻辑说明（零信任）**：前端不传递核心 Prompt！后端使用实验配置页“Prompt 模板配置”的生成式回答模板，按 `AiPromptTemplate -> 系统默认模板` 的优先级组合提示词。实验 JSON 的 `ai` 只声明图片槽位和目标节点等结构绑定，不保存 Prompt 内容。后端要求模型返回简洁 JSON object，例如 `{ "1": "...", "2": "..." }`，再按题号转换为对应 `nodeId`。
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
- 图片槽位语义：`inputs.images[].id` 可被 `ai.recognition.imageRef` 绑定为表格/数据识别图片；也可通过 `inputs.images[].targetNodeId` 或 `inputs.fields[].imageSlotId` 绑定到 `image_upload` 节点。识别图片不会自动混入图片答案节点，图片答案节点保存为对应节点的图片 URL。
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
  "schema_version": "1.5",
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
      "listCacheTtlSeconds": 600,
      "syncCooldownSeconds": 1800
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
  "schema_version": "1.5",
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
  - `runtime.defaultTimeoutMs`、`runtime.postLoginSettleMs`、`runtime.postLoginWaitMs` 和 `waitPolicy` 中关键超时字段必须为正整数。
  - 不允许在配置中保存具体 Playwright 脚本代码。
  - JSONB 不支持 `//` 注释；可使用 `_comment`、`description` 等普通字段作为可保存注释。
- **Compatibility**：不兼容旧配置结构；后端以 `schema_version=1.5` 的当前结构为准。读取默认配置时，如果数据库中的 `default` 配置仍是旧结构或旧版本，将直接替换为当前默认结构。
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
AI_IMAGE_RECOGNITION_MODEL=deepseek-ai/DeepSeek-OCR
AI_ANSWER_GENERATION_MODEL=deepseek-ai/DeepSeek-V4-Flash
AI_CAPTCHA_MODEL=zai-org/GLM-4.5V
```

- 温度、超时、最大图片数、自动识别开关和验证码 prompt 不再从 `.env` 配置；首次创建 `ai_config` 时使用代码内置默认值，之后由 Admin 设置页修改并保存到数据库。
- 不再使用 `AI_API_KEY_ENV`、`CAPTCHA_AI_*`、供应商绑定 key 名或数据库加密保存 AI Key。
- 当前不做 fallback model：某个 task 的模型失败即向调用方返回失败，由业务层记录任务状态和错误。
- `GET /api/v1/ai/admin/config`：Admin 获取当前非密钥 AI 配置和 `api_key_configured` 状态，不返回真实 key。
- `PUT /api/v1/ai/admin/config`：Admin 保存非密钥 AI profile，写入 `ai_config` 并记录 `audit_logs(action=ai_config_updated)`。
- `POST /api/v1/ai/admin/test-connection`：使用当前 `ai_config` + `.env` 中的 `AI_API_KEY` 发送一条 `hello` 测试请求，返回模型输出；失败时返回 `ok=false`、`error_code` 和具体 `error`，例如缺少密钥时返回 `missing_api_key` 与“请在 .env 中填写 AI_API_KEY，然后重启后端进程”。

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
      "schoolStatus": "school_draft_submitted"
    }
  ]
}
```

- **规则**:
  - 没有同步记录时 `shouldSync=true`。
  - 距离最近同步超过 `syncPolicy.syncCooldownSeconds` 时 `shouldSync=true`。
  - 冷却期内 `shouldSync=false`，除非用户点击手动同步按钮并调用 `POST /overview` 的 `force=true`。
  - `experiments` 来自最近一次学校概览快照，仅包含学生端可展示的实验名、学校原始状态文本和归一化学校状态；前端可用它合并展示“学校提交状态”，但不得用它覆盖平台 `Submission.status`。

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

#### POST /api/v1/school-sync/experiments/{experiment_id}/submit

- **Auth Required**: Yes
- **Purpose**: 学生在平台点击“临时提交”后，创建学校系统提交 job，并由前端阻塞弹窗轮询公开进度。后端先保存 `platform_before_submit` 快照，再复用或重建学校会话、打开对应实验报告 modal、按实验配置 `automation.mappings` 回填平台 `corrected_json.values`、逐字段校验、点击学校系统“临时提交”、等待学校反馈、关闭 modal 或返回主实验列表，并读取该实验提交状态。`mode=final` 复用同一后端流程，只切换为正式提交 selector 和 `school_final_submitted` 状态确认；当前学生端正式提交确认按钮保持禁用，不开放用户触发。
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

- **Response**: 返回自动化 Job 公共 DTO。

```json
{
  "jobId": "JOB-XXXX",
  "action": "draft_submit",
  "status": "running",
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
  "startedAt": null,
  "finishedAt": null,
  "createdAt": "2026-07-05T10:00:00Z",
  "updatedAt": "2026-07-05T10:00:00Z"
}
```

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

#### GET /api/v1/automation-jobs/active

- **Auth Required**: Yes
- **Query**:
  - `action` 可选。
  - `experiment_id` 可选。
  - `submission_id` 可选。
- **Response**: 返回当前用户可见的 active job 公共列表。
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
- 如果同一用户已有 active job 正在操作学校 session，返回 `409 JOB_ALREADY_RUNNING`。
- 数据库层使用 active 状态 partial unique index 防止并发请求创建重复 active job。

## 7. 订单与支付 (Orders)
**现状缺口**：前端有完整的“订单管理”页面和筛选逻辑，需要真实的 API 支撑。
### 7.1 创建订单 (学生端)
- **Endpoint**: `POST /api/v1/orders`
- **Payload**: `{ "experiment_id": "exp_001", "plan": "pro" }`
- **Response**: 返回带 `order_id` 和 `amount` 的待支付订单信息。

### 7.2 查询订单列表 (管理员端)
- **Endpoint**: `GET /api/v1/orders` (支持 `status` 等 Query 参数过滤)

### 7.3 审核收款 (管理员端)
- **Endpoint**: `POST /api/v1/orders/{id}/verify` (确认收款) / `POST /api/v1/orders/{id}/reject` (驳回)
- **逻辑**：确认收款后，触发内部状态机，流转绑定的 submission 状态。

## 8. 任务与列表 (Submissions List)
**现状缺口**：ReviewerTasksPage (审核任务) 和 StudentExperiments (我的实验) 的列表数据需要 API，且必须严格隔离。

### 8.1 获取我的实验 (学生端)
- **Endpoint**: `GET /api/v1/submissions/my`
- **限制**：只返回当前 JWT token 对应 `user_id` 的任务。

### 8.2 获取审核任务池 (管理员/审核员端)
- **Endpoint**: `GET /api/v1/submissions/review-pool`
- **限制**：**绝对禁止学生调用！** 仅限 Reviewer/Admin 角色，返回所有 `status=reviewing` 或分配给当前审核员的任务。

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
### 9.1 获取上传凭证 (预签名 URL)
- **Endpoint**: `POST /api/v1/upload/presigned-url`
- **Payload**: `{ "filename": "exp1.jpg", "content_type": "image/jpeg" }`
- **Response**: 返回 OSS/S3/MinIO 的直传 URL。前端把图片 PUT 过去后，拿到最终的图片 URL 传给业务接口。

## 11. 操作日志 (Audit Logs)
**现状缺口**：前端已经把高复用日志页面搭好了，需要后端吐完整的数据。
**强制规则**：前面提到的“图片识别”、“简答题生成”、“公式推导”、“自动填报”等所有核心动作，后端在执行结束后**必须强同步写入 audit_logs 表**。

### 11.1 查询日志列表 (管理员)
- **Endpoint**: `GET /api/v1/audit-logs`
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
      "action": "calculate_data", 
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
  - 只返回当前登录学生自己的日志。
  - 只返回学生可理解的业务动作白名单，例如订单、支付、上传、AI 识别和自动化填报状态。
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
