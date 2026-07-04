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

在“实验详情（编辑页）”中，针对右侧表单的修改，后端通过分离“存草稿”和“正式触发”来保证数据安全。

### 3.1 临时保存 (Save Draft / Auto-save)
- **Endpoint**: `PATCH /api/v1/submissions/{id}`
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
  2. **触发 Worker 同步**：除了在本地数据库保存外，后端会抛出异步任务给 Playwright Worker。**注意：前端在请求期间需处于 `submitting` 加载态，接口必须在 Worker 成功点击了学校网站的“临时保存”后，才返回 `200 Success`。**

### 3.2 正式提交 (Official Submit)
- **Endpoint**: `POST /api/v1/submissions/{id}/submit`
- **Auth Required**: Yes
- **Payload**: 
```json
{
  "corrected_json": {
    "temperature": "25",
    "pressure": "101.3"
  },
  "is_one_click_handoff": false
}
```
- **后端执行的严格逻辑**：
  1. **锁数据**：开启事务并 `SELECT ... FOR UPDATE` 锁住当前 submission。
  2. **路由分发**：
     - 如果是学生点击“一键代劳提交”（仅上传图片，`is_one_click_handoff: true`），状态流转为 `reviewing`（进入人工审核池）。
     - 如果是学生自己填完数据正式提交，或审核员（Admin）完成纠错后正式提交，状态直接流转为 `submitting`（自动填报中，触发自动化引擎）。
  3. **完整性校验**：如果是触发自动化引擎，需根据该实验的 `mapping_json` 检查必填项是否都已填写。
  4. **落库与触发**：将最终数据保存至 `corrected_json`，异步唤醒 Playwright Worker。**注意：接口必须阻塞等待 Worker 彻底完成自动化提交（或前端轮询状态），在此期间前端保持 `submitting` 状态。**

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

当前真实接入的学生端实验配置：

```text
exp_meter_modification          电表的改装
exp_three_line_torsion_pendulum 三线摆和扭摆实验
exp_photoelectric_planck        光电效应和普朗克常量的测定
exp_sound_velocity              声速的测量
exp_liquid_crystal_0625         液晶电光效应实验0625
exp_potentiometer               电位差计的原理和使用
exp_oscilloscope                示波器的使用
exp_air_heat_capacity_ratio     空气比热容比的测定
exp_falling_ball_viscosity      落球法测粘滞系数
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
role
capabilities
created_at
```

说明：

- `username`：平台登录账号。admin / reviewer 使用平台账号登录。
- `student_no`：学生学号。学生登录平台和学校系统登录均使用该字段；学校系统密码同 `student_no`。
- `real_name`：学校系统同步到的真实姓名，仅用于展示和核对，不参与登录。
- 不兼容旧数据；如果本地库中已有旧用户数据导致字段冲突，直接清表或重建数据库。

### 6.1 用户登录
- **Endpoint**: `POST /api/v1/auth/login`
- **Payload**: `{ "username": "xxx", "password": "xxx" }`
- **Student 规则**：当 `username` 符合学号格式时，后端按 `student_no` 查找或创建学生用户；学校系统密码策略为同学号，但平台登录接口仍接收 OAuth2 password 字段。
- **Admin / Reviewer 规则**：按 `username` 查找平台账号并校验平台密码哈希。
- **Response**:
```json
{
  "access_token": "jwt_string",
  "token_type": "bearer",
  "role": "admin|student|reviewer",
  "capabilities": {}
}
```

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
  "schema_version": "1.1",
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
      "_comment": "学校系统账号使用 users.student_no，密码固定与学号一致；登录后姓名写入 users.real_name。",
      "studentNoField": "users.student_no",
      "realNameField": "users.real_name",
      "passwordPolicy": "same_as_student_no"
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
          "experimentName": 2,
          "status": 6
        },
        "openReportButtonText": "完成报告"
      },
      "modal": {
        "root": "#ReportModal",
        "content": "#ReportModal #content",
        "saveDraft": "#ReportModal button:has-text('临时提交')",
        "close": "#ReportModal button:has-text('关闭')"
      }
    },
    "safety": {
      "_comment": "高风险动作保护。按需读取 modal 时必须跳过这些按钮，除非未来有独立审批和二次确认机制。",
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
      "provider": "openai_compatible",
      "apiKeyEnv": "ARK_API_KEY",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
      "model": "doubao-1.5-vision-lite-250315",
      "prompt": "识别图片验证码，只回答验证码内容，不要解释。"
    },
    "syncPolicy": {
      "initialSync": "identity_and_report_list",
      "detailSync": "on_demand",
      "listCacheTtlSeconds": 600
    },
    "retryPolicy": {
      "captchaMaxRetries": 3,
      "networkMaxRetries": 2,
      "syncCooldownSeconds": 1800
    },
    "runtime": {
      "_comment": "headless=false 表示打开可视浏览器窗口；userSessionIdleTtlSeconds=0 表示平台不主动关闭会话。",
      "headless": false,
      "slowMoMs": 250,
      "defaultTimeoutMs": 30000,
      "postLoginSettleMs": 2000,
      "postLoginWaitMs": 10000,
      "userSessionIdleTtlSeconds": 0
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
  "schema_version": "1.1",
  "is_active": true,
  "config_json": {
    "schoolSystem": {},
    "identity": {
      "passwordPolicy": "same_as_student_no"
    },
    "selectors": {},
    "retryPolicy": {},
    "runtime": {}
  }
}
```
- **Validation**:
  - `config_json` 必须是 JSON object。
  - 顶层必须包含 `schoolSystem`、`identity`、`selectors`、`safety`、`captcha`、`syncPolicy`、`retryPolicy`、`runtime`。
  - `identity.passwordPolicy` 必须为 `same_as_student_no`。
  - 不允许在配置中保存具体 Playwright 脚本代码。
  - JSONB 不支持 `//` 注释；可使用 `_comment`、`description` 等普通字段作为可保存注释。
- **Compatibility**：不兼容旧配置结构；后端以 `schema_version=1.1` 的当前结构为准。读取默认配置时，如果数据库中的 `default` 配置仍是旧结构或旧版本，将直接替换为当前默认结构。
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
