# 学校系统自动化完整流程计划

## 1. 当前目标

打通学生从登录平台、同步学校实验概览、进入单个实验、读取学校系统已有填写内容、在平台修改数据、再回填并提交到学校系统的完整链路。

第一阶段先走内网登录：

```text
平台登录
  -> 后端打开 http://10.25.77.60:8001/Login
  -> 学号登录学校系统
  -> AI 识别验证码
  -> 同步实验列表状态
  -> 学生按需同步单个实验
  -> 平台保存快照
  -> 回填学校系统
  -> 临时提交 / 正式提交
```

校园网 VPN 入口、短信验证码、二维码认证等分支先记录，不作为第一阶段实现范围。

## 2. 当前不实现的认证分支

如果当前服务器无法直接访问 `http://10.25.77.60:8001/Login`，理论上需要访问：

```text
https://10-25-77-60-8001-p.vpn.cumtb.edu.cn:8118/
```

该入口可能触发校园网认证，并且认证使用固定校园认证账号，不是学生账号，也不是当前登录平台的系统操作者账号。该账号密码暂不写入文档、仓库或数据库配置值，后续只能通过本地 `.env` 或部署环境变量提供，例如：

```text
CUMTB_VPN_USERNAME=2410410114
CUMTB_VPN_PASSWORD=<从本地安全环境变量读取>
```

它可能包含：

- 输入本地环境变量中的固定校园认证账号及其密码
- 扫码
- 手机短信验证码
- 其他二次验证

这些步骤涉及人工协助和实时验证码传递。第一阶段不实现自动处理，只在状态机中预留：

```text
vpn_auth_required
manual_verification_required
```

当前实现策略：

- 先强制走内网登录 URL。
- 如果内网不可达，任务失败并提示网络不可达。
- 后续再补“人工协助校园认证”流程。

## 3. 自动化配置参数

现有 `automation_engine_configs.config_json` 继续作为配置入口，第一阶段建议补充或确认以下字段。

```json
{
  "schoolSystem": {
    "baseUrl": "http://10.25.77.60:8001",
    "loginUrl": "http://10.25.77.60:8001/Login"
  },
  "networkPolicy": {
    "phase": "direct_intranet_only",
    "directLoginUrl": "http://10.25.77.60:8001/Login",
    "vpnLoginUrl": "https://10-25-77-60-8001-p.vpn.cumtb.edu.cn:8118/",
    "vpnUsernameEnv": "CUMTB_VPN_USERNAME",
    "vpnPasswordEnv": "CUMTB_VPN_PASSWORD",
    "probeTimeoutMs": 3000
  },
  "retryPolicy": {
    "captchaMaxRetries": 3,
    "credentialMaxRetries": 1,
    "networkMaxRetries": 2,
    "selectorMaxRetries": 1,
    "syncCooldownSeconds": 600
  },
  "runtime": {
    "headless": false,
    "slowMoMs": 250,
    "defaultTimeoutMs": 30000,
    "postLoginSettleMs": 2000,
    "postLoginWaitMs": 10000,
    "userSessionIdleTtlSeconds": 0,
    "schoolSessionMaxAgeSeconds": 7200,
    "keepBrowserOpenAfterLogin": true
  },
  "waitPolicy": {
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
```

说明：

- `slowMoMs`：Playwright 每个动作之间的人为延迟，单位毫秒。开发阶段设为 `250`，方便肉眼观察页面操作；正式后台运行时可调低或设为 `0`。
- `defaultTimeoutMs`：Playwright 等待元素、页面加载、网络响应的默认超时时间，单位毫秒。`30000` 表示最多等待 30 秒。
- `postLoginSettleMs`：登录按钮点击后，页面刚跳转或初始化时额外等待的稳定时间，单位毫秒。它用于等待页面脚本、表格渲染和用户信息挂载。
- `postLoginWaitMs`：登录后等待进入目标页面或关键元素出现的最长时间，单位毫秒。它和 `postLoginSettleMs` 不同：前者是最长等待窗口，后者是固定稳定延迟。
- `syncCooldownSeconds`：用户登录平台后 10 分钟内不自动重复同步概览，除非用户手动点击同步。
- `userSessionIdleTtlSeconds = 0`：平台不主动关闭学校系统浏览器会话，直到学校登录态自己失效或服务重启。
- `headless = false`：当前开发阶段打开可视浏览器窗口，方便观察。
- `vpnUsernameEnv` 指向本地环境变量名，值为固定校园 VPN 认证账号。账号不得硬编码进数据库配置、文档正文以外的代码、日志或前端响应。
- `vpnPasswordEnv` 指向本地环境变量名，密码不得写入数据库明文、文档、日志或前端响应。
- `afterClickMs`：普通点击后的短暂稳定等待，处理学校页面点击动画或同步脚本。
- `afterInputMs`：单个输入框写入后的短暂稳定等待。
- `afterImageUploadMs`：图片上传后等待编辑器或 DOM 开始响应的固定缓冲。
- `modalOpenTimeoutMs`：点击“完成报告”后等待 modal 出现的最长时间。
- `fieldWriteTimeoutMs`：写入普通文本、表格、textarea 后等待 DOM 值稳定的最长时间。
- `imageWriteTimeoutMs`：上传图片后等待图片出现在学校系统编辑器中的最长时间。
- `submitFeedbackTimeoutMs`：点击临时/正式提交后等待学校系统反馈提示的最长时间。
- `listRefreshTimeoutMs`：等待学校实验列表数据出现或提交后列表状态刷新的最长时间。概览同步读取姓名和实验列表时也使用它。
- `networkIdleTimeoutMs`：需要等待网络请求基本空闲时使用的最长时间。
- `overviewStableMs`：概览页姓名和实验列表出现后，要求 DOM 快照连续稳定的时间。
- `overviewPollMs`：概览页读取姓名和实验列表时的 DOM 轮询间隔。

### 3.1 学校浏览器会话管理

后端使用运行期 `school_session_manager` 管理学校系统浏览器会话，键为 `user_id`。概览同步登录成功后注册会话；单实验同步、临时提交和后续正式提交都必须通过 session manager 获取页面。

获取会话规则：

1. 如果同一用户已有浏览器窗口且 page 未关闭、未停留在登录页，则优先复用。
2. 复用前先尝试关闭残留 modal / bootbox，再点击完成报告导航，恢复到完成报告主列表。
3. 会话不能只判断“可用 / 不可用”，必须先识别当前页面状态，再按目标状态恢复。

当前状态枚举：

```text
missing        无运行期会话
closed         page 已关闭
login_page     停留在学校登录页或登录表单可见
report_list    完成报告主列表可见，且没有实验 modal
report_modal   实验报告 modal 可见
bootbox_dialog 学校系统错误或提示弹窗可见
loading        学校系统 loading 遮罩可见
unknown        无法识别的学校页面状态
```

所有概览同步、单实验读取和提交前都应先调用统一恢复入口，将页面恢复到 `report_list`：

```text
report_modal   -> 关闭 modal -> 等待 report_list
bootbox_dialog -> 关闭弹窗 -> 重新识别状态
loading        -> 等待 loading 消失 -> 重新识别状态
unknown        -> 点击完成报告导航或跳转 CompleteReport -> 等待 report_list
login_page     -> 重新登录
closed/missing -> 新建浏览器并登录
```

同一 `user_id` 的学校自动化操作必须串行执行。概览同步、单实验读取和提交都需要持有用户级操作锁，避免多个 job 同时操作同一个学校窗口。
3. 如果窗口不存在、page 已关闭、停留在登录页或恢复主列表失败，则关闭旧会话并重新登录。
4. 重新登录后仍无法恢复到完成报告主列表，job 失败为 `SCHOOL_SESSION_UNAVAILABLE`。

每次 detail / submit job 的后台 `result_payload.sessionDiagnostic` 记录本次会话决策，例如：

```json
{
  "hasSession": true,
  "state": "active",
  "url": "http://10.25.77.60:8001/ReportStudent/CompleteReport/",
  "onLoginPage": false,
  "hasRealNameNode": true,
  "hasReportRows": true,
  "hasReportModal": false,
  "reuseDecision": "reused_existing_session"
}
```

该诊断只用于后台排查，不返回学生端 public DTO；不得包含学校密码、验证码、AI Key、完整 HTML 或截图真实路径。

### 3.2 DOM 读写稳定机制

所有学校系统自动化 job 在读取或写入 DOM 时，必须使用通用等待机制，不直接在点击后立即读取或写入：

- 读取文本前先等待配置选择器对应节点存在，且 `innerText/textContent` 非空并短暂稳定。
- 读取列表前先等待配置选择器对应行数达到最小要求并短暂稳定，再执行批量抽取。
- 写入字段后必须触发 `input/change/blur`，并在 `waitPolicy.fieldWriteTimeoutMs` 内持续回读校验，直到实际 DOM 值与预期值匹配。
- modal、列表和提交反馈等关键节点都必须使用配置选择器和 `waitPolicy` 超时参数，不能靠固定 `sleep` 或页面文案猜测。
- 如果等待超时，job 应记录明确错误码和当前步骤，不应把未读全的数据伪装为成功。

该机制用于防止学校页面异步渲染、Knockout/旧版 jQuery 绑定延迟、loading 遮罩提前消失等情况下出现“截图已经有值，但后端读取为空”或“刚写入就被页面脚本覆盖”的问题。

## 4. 用户登录后的概览同步

### 4.1 触发条件

用户登录平台成功后，后端检查最近一次学校概览同步时间：

- 未同步过：自动同步。
- 距离上次同步超过 `syncCooldownSeconds`：自动同步。
- 10 分钟内已同步：不自动同步。
- 用户点击“手动同步”：忽略冷却时间，立即同步。

### 4.2 前端提示

自动同步开始后，前端显示浮窗：

```text
正在从学校系统同步您的概览数据，请耐心等待...
```

同步成功后通知：

```text
您的概览数据已读取完成，请查看仪表盘进行下一步操作。
```

同步失败时展示可理解错误，不暴露内部选择器：

```text
当前无法连接至学校系统，原因：xxxx，若该情况持续存在，请反馈并联系管理员。
```

### 4.3 后端同步内容

登录学校系统后读取实验列表表格，只保存：

- 学校系统学生姓名
- 实验报告名称
- 学校提交状态
- 原始状态文本
- 同步时间

第一阶段不保存课程、成绩、截止时间等扩展列。

学校状态建议映射：

```text
未提交   -> school_not_submitted
临时提交 -> school_draft_submitted
正常提交 -> school_final_submitted
未知文本 -> school_unknown
```

这些学校状态不要直接覆盖平台 `Submission.status`。平台状态继续表示平台内部处理进度，学校状态保存到 `school_sync_snapshots.summary_json` 并在前端合并展示。

提交后的状态确认规则：

- 学校系统是最终提交事实来源。
- 平台在提交 job 内可以更新 `Submission.status`，但必须以学校系统反馈、modal 状态或列表状态回读为依据。
- 不能仅凭“Playwright 已点击临时提交 / 正式提交按钮”就把 submission 标记为 `draft_submitted` 或 `completed`。
- 提交 job 成功后必须立即保存一次针对该实验的 `school_sync_snapshots`；如能回到列表并读取概览，也应同步更新概览快照。
- 例行概览同步只用于登录后刷新整体列表，不替代提交 job 的即时确认。

## 5. 学校系统登录流程

第一阶段登录流程：

1. 打开 `schoolSystem.loginUrl`。
2. 填写用户名：`users.student_no`。
3. 填写密码：同学号。
4. 截取验证码图片节点。
5. 调用 AI API 识别验证码。
6. 清洗并校验验证码候选值，必须匹配必填配置 `captcha.expectedLength`，当前配置为 4 位；不匹配时刷新验证码重试，不填写提交。
7. 填写验证码并提交。
8. 等待登录结果分支：成功进入实验报告列表，或出现学校系统 Bootbox 错误弹窗。
9. 如果 `.bootbox.modal.in .bootbox-body` 出现 `验证码不正确` 等验证码错误，关闭弹窗并按 `captchaMaxRetries` 重新截图识别；自动化不主动点击验证码图片刷新，避免截图验证码和提交验证码错位。
10. 读取右上角姓名并写入 `users.real_name`。

失败分类：

```text
NETWORK_UNREACHABLE
CONFIG_INVALID
CAPTCHA_RETRY_EXHAUSTED
CREDENTIAL_FAILED
LOGIN_TIMEOUT
SELECTOR_MISSING
UNKNOWN_LOGIN_RESULT
```

验证码失败只按 `captchaMaxRetries` 重试。账号密码错误不无限重试，最多按 `credentialMaxRetries`。

## 6. 学生打开单个实验时的按需同步

学生打开 `StudentExperimentDetailPage` 时触发单实验同步。

前端提示：

```text
正在从学校系统同步您的「实验名称」填写数据，请耐心等待...
```

同步成功后通知：

```text
您的实验数据填写已读取完成，并已回填至当前网页，请进行下一步操作。
```

同步失败时展示可理解错误，不暴露内部选择器：

```text
当前无法同步实验数据，原因：xxxx，若该情况持续存在，请反馈并联系管理员。
```

后端动作：

1. 复用当前用户的学校系统 browser context。
2. 如果会话失效，重新登录。
3. 回到学校实验报告列表页。
4. 根据实验名称找到对应行。
5. 点击“完成报告”按钮。
6. 等待报告 modal 打开。
7. 按 `backend/configs/{experiment_id}.json` 中的节点配置读取已有值。
8. 保存 `school_sync_snapshots`。
9. 返回可回填到平台表单的节点值。

恢复策略：

- 找不到实验行：回主列表页重试一次。
- 找不到“完成报告”按钮：保存截图和 HTML 摘要，返回 `REPORT_OPEN_BUTTON_MISSING`。
- modal 未打开：返回 `REPORT_MODAL_NOT_FOUND`。
- 学校页面错乱：返回主列表页，重试一次，仍失败则记录 `PAGE_RECOVERY_FAILED`。

## 7. 平台提交到学校系统

用户在平台点击“临时提交”或“正式提交”后，前端弹出阻塞进度弹窗。

建议进度步骤：

```text
1. 正在保存平台数据...
2. 正在连接学校系统...
3. 正在打开实验报告...
4. 正在回填表单数据...
5. 正在校验写入结果...
6. 正在执行临时提交 / 正式提交...
7. 正在确认学校系统反馈...
8. 正在返回完成报告列表...
9. 正在读取学校系统提交状态...
10. 正在更新平台状态...
```

后端动作顺序：

1. 保存 `submission_versions(source=platform_before_submit)`。
2. 创建 `automation_jobs(action=draft_submit | final_submit)`。
3. 获取当前用户的学校浏览器会话，并持有用户级操作锁。
4. 识别当前学校页面状态；如果是 `report_modal` 且属于目标实验，则直接复用当前 modal。
5. 如果当前是其他实验 modal、bootbox、loading 或 unknown 状态，先通过统一恢复入口恢复；只有会话缺失、page 关闭、停留在登录页或恢复失败时才重新登录。
6. 确保目标实验的“完成报告” modal 已打开并稳定。
7. 根据实验配置将平台表单数据回填到学校系统 DOM 节点。
8. 校验所有有内容的节点和图片是否已经成功写入学校系统。
9. 保存提交前学校页面快照。
10. 根据用户选择点击“临时提交”或“正式提交”。
11. 等待学校系统完成提交动作：优先等待成功提示、modal 状态变化、按钮状态变化或网络请求结束；超时返回 `SUBMIT_FEEDBACK_TIMEOUT`。
12. 如果读到“提交成功!”等明确成功反馈，记录 `submitAccepted=true`。
13. 提交动作确认后关闭 bootbox / modal，尽量返回“完成报告”列表。
14. 等待列表刷新并读取对应实验状态列，将学校状态映射为 `school_draft_submitted` / `school_final_submitted` 等；如果已确认成功反馈但列表状态暂未确认，记录 `statusConfirmation=feedback_only`，不应直接误判提交失败。
15. 保存 `school_sync_snapshots`。
16. 写入 `audit_logs`。
17. 基于学校系统反馈确认来源和列表回读结果更新平台内实验状态。

注意：

- 探测、同步、读取 modal 时禁止点击“正式提交”。
- 只有用户在平台明确点击“正式提交”，并通过前端二次确认后，才允许创建 `final_submit` job。
- 每次提交都必须先保存平台快照，避免学校提交失败后无法恢复用户数据。
- 当前学生端正式提交确认按钮保持禁用；后端 `final_submit` 流程已按正式提交 selector 和 `school_final_submitted` 确认规则准备，后续开放前必须先完成前端二次确认放行和真实学校环境验证。
- 临时提交的 modal 复用、bootbox 成功反馈识别，以及实验列表“学校提交状态 / 平台处理状态”拆分，详见 `docs/SCHOOL_SUBMIT_AND_STATUS_PLAN.md`。

### 7.1 回填后逐节点校验

回填学校系统后，后端必须检查所有“平台侧有内容”的节点是否成功写入学校页面。

需要校验的内容：

- 普通文本输入框：`targetType` 缺省为 `text`，读取学校 DOM 当前值，与平台提交值规范化后比较。
- 富文本文本区域：`targetType=wysiwyg_text`，不能直接 fill 隐藏 textarea；必须写入同一 `.wysiwyg-wrapper` / `.wysiwyg-container` 内的 `.wysiwyg-editor`，同步 textarea value，并回读 editor HTML 或可见文本。
- 表格输入节点：按节点 ID 或配置定位逐格校验。
- 富文本图片上传节点：`targetType=wysiwyg_image`，点击同一编辑器 toolbar 的“插入图片”按钮，等待 popup 中的 `input[type=file]`，使用 Playwright 上传平台图片对应的本地文件，再确认 editor 内出现图片节点。
- 计算结果节点：如果平台侧有值，也要按普通输入节点校验。

不需要校验的内容：

- 平台侧为空的节点。
- 配置中明确标记为只读、展示用或无需回填的节点。

校验失败时：

- 不继续点击“临时提交”或“正式提交”。
- 将失败节点记录到 `automation_jobs.result_payload.failedFields`。
- 对学生展示标准提示，不暴露内部选择器。
- 保存截图和必要 HTML 摘要，供管理员排查。

失败结果示例：

```json
{
  "errorCode": "FIELD_WRITE_VERIFY_FAILED",
  "failedFields": [
    {
      "nodeId": "DBGZ10-0",
      "type": "text",
      "reason": "value_mismatch"
    },
    {
      "nodeId": "Y2Area",
      "type": "wysiwyg_image",
      "reason": "image_not_found_after_upload",
      "stage": "verify"
    }
  ]
}
```

前端提示：

```text
部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。
```

### 7.2 学校系统操作等待与稳定性策略

学校系统提交链路是模拟真实用户点击、输入和上传，因此每个关键动作后都必须等待学校系统完成对应操作。等待策略不能只依赖固定 sleep，应优先等待明确结果。

等待优先级：

1. 等待明确 DOM 结果：元素出现、输入值变化、图片节点出现、按钮状态变化、提示文本出现。
2. 等待学校系统业务状态：列表状态列变更、modal 关闭、提交反馈出现。
3. 使用短固定等待作为 UI 动画和学校页面脚本稳定缓冲。
4. 超过配置时间仍无结果时，返回明确错误码并保存排查信息。

关键等待点：

- 点击“完成报告”后：等待报告 modal 出现，超时返回 `MODAL_OPEN_TIMEOUT`。
- 回填普通输入框后：等待 DOM value 等于平台值，超时返回 `FIELD_WRITE_TIMEOUT`。
- 回填 textarea / 富文本后：等待可见文本或 HTML 包含平台值，超时返回 `FIELD_WRITE_TIMEOUT`。
- 上传图片后：等待学校页面中出现图片、文件名或编辑器图片节点，超时返回 `IMAGE_WRITE_TIMEOUT`。
- 点击“临时提交”或“正式提交”后：等待学校系统提示文本、按钮状态变化或 modal 状态变化，超时返回 `SUBMIT_FEEDBACK_TIMEOUT`。
- 提交后回到列表页：等待对应实验状态列刷新，超时返回 `LIST_REFRESH_TIMEOUT`。

前端进度弹窗在等待阶段应显示明确状态，例如：

```text
正在等待学校系统保存结果...
正在等待学校系统刷新提交状态...
```

不要让用户看到无提示的长时间 loading。

等待失败时：

- `automation_jobs.status` 置为 `failed`。
- `automation_jobs.error_code` 写入对应 timeout 错误码。
- `automation_jobs.result_payload.currentStep` 记录失败步骤。
- 保存截图和必要 HTML 摘要。
- 前端展示标准化失败提示。

## 8. Automation Job 状态机

建议状态：

```text
queued
running
waiting_manual_vpn_auth
waiting_manual_2fa
retrying
succeeded
failed
cancelled
expired
```

建议 action：

```text
school_overview_sync
school_detail_sync
draft_submit
final_submit
session_recover
```

建议错误码：

```text
NETWORK_UNREACHABLE
VPN_AUTH_REQUIRED
MANUAL_VERIFICATION_REQUIRED
CAPTCHA_RETRY_EXHAUSTED
CREDENTIAL_FAILED
LOGIN_TIMEOUT
REPORT_LIST_NOT_FOUND
REPORT_ROW_NOT_FOUND
REPORT_OPEN_BUTTON_MISSING
REPORT_MODAL_NOT_FOUND
FIELD_SELECTOR_MISSING
SUBMIT_BUTTON_MISSING
MODAL_OPEN_TIMEOUT
FIELD_WRITE_TIMEOUT
IMAGE_WRITE_TIMEOUT
SUBMIT_FEEDBACK_TIMEOUT
LIST_REFRESH_TIMEOUT
SCHOOL_FEEDBACK_UNKNOWN
SCHOOL_SUBMIT_FAILED
SESSION_EXPIRED
PAGE_RECOVERY_FAILED
FIELD_WRITE_VERIFY_FAILED
JOB_ALREADY_RUNNING
IDEMPOTENCY_CONFLICT
```

## 9. 日志和审计要求

自动化链路必须同时写入两类记录：

1. `automation_jobs`
   - 记录机器可读的任务状态、步骤、错误码、截图、失败字段和重试次数。
   - 用于前端进度弹窗轮询和管理员排查。

2. `audit_logs`
   - 记录用户可追踪的关键行为。
   - 用于后台操作日志和责任追踪。

必须记录的动作：

```text
school_overview_sync_started
school_overview_sync_completed
school_overview_sync_failed
school_detail_sync_started
school_detail_sync_completed
school_detail_sync_failed
school_submit_started
school_submit_write_verified
school_submit_write_verify_failed
school_submit_clicked
school_submit_completed
school_submit_failed
school_session_recovered
school_session_expired
```

日志安全要求：

- 不记录学生学校系统密码。
- 不记录 `CUMTB_VPN_PASSWORD`。
- 不记录验证码原图的公开 URL。
- 不把完整 HTML 原文写进普通审计日志；HTML 摘要和截图路径只保存在自动化 job 的排查 payload 中。
- 前端响应不返回选择器、密码、验证码图片、API Key。

## 10. 后端安全边界与并发控制

学校自动化属于高风险链路，不能依赖前端隐藏字段、禁用按钮或路由控制。所有安全边界、重复提交防护和状态一致性必须由后端保证。

### 10.1 前端可见信息白名单

前端只能拿到平台希望用户看到的信息：

- 任务 ID。
- 脱敏后的任务状态。
- 当前进度步骤的标准 `messageCode`。
- 成功或失败状态。
- 用户可读失败原因。
- 是否允许重试。
- 最近一次同步时间。
- 学校状态的用户可读映射，例如“未提交 / 临时提交 / 正常提交”。

前端不能拿到：

- 学校系统选择器。
- DOM 节点内部定位规则。
- Playwright 脚本细节。
- 验证码图片、验证码识别结果和 AI 原始响应。
- 学校系统密码、VPN 账号密码、API Key。
- 完整 HTML。
- 内部截图真实存储路径。
- `automation_jobs.request_payload` 原文。
- `automation_jobs.result_payload` 中的排查细节。
- 失败节点的内部选择器。

后端需要为学生端单独提供脱敏 DTO，例如：

```json
{
  "jobId": "JOB-XXXX",
  "status": "running",
  "messageCode": "school.submit.filling",
  "messageParams": {
    "experimentName": "电表的改装"
  },
  "canRetry": false,
  "startedAt": "2026-07-05T10:00:00Z",
  "finishedAt": null
}
```

管理员可以看到更多排查信息，但仍不能看到密码、验证码、API Key 和完整敏感 HTML。

### 10.2 前端防抖

前端需要做体验层防抖：

- 点击同步、读取详情、临时提交、正式提交后立即禁用按钮。
- 阻塞提交弹窗关闭前不能再次提交。
- 请求未完成前不能重复点击。
- 刷新页面后应根据后端 job 状态恢复进度弹窗，而不是重新发起任务。

但前端防抖只用于改善体验，不作为安全依据。

### 10.3 后端幂等与任务锁

后端必须防止重复 automation job。

建议规则：

- 同一用户同一时间只允许一个学校系统浏览器上下文执行实际操作。
- 同一用户可以排队同步不同实验，但不能并行操作同一个学校系统 session。
- 同一个 `submission_id` 同一时间只能存在一个 active submit job。
- 同一个 `experiment_id` 同一时间只能存在一个 active detail sync job。
- 概览同步在冷却期内复用最近结果，除非用户手动强制同步。

active job 状态：

```text
queued
running
retrying
waiting_manual_vpn_auth
waiting_manual_2fa
```

如果用户重复点击：

- 如果存在相同幂等键的 active job，后端返回已有 `job_id`，前端继续轮询。
- 如果请求 payload 与已有 active job 冲突，返回 `409 IDEMPOTENCY_CONFLICT`。
- 如果同一 submission 已在提交中，返回 `409 JOB_ALREADY_RUNNING`，并附带脱敏的当前 job 状态。
- 如果用户手动关闭学校浏览器窗口，下一次 job 轮询会检测 `pageClosed=true` 并将任务标记为 `failed`，错误码 `SCHOOL_BROWSER_CLOSED`。
- 学生端不允许手动终止学校自动化任务；如果任务卡死，由管理员调用 `POST /api/v1/automation-jobs/{job_id}/cancel` 手动处理，后端标记 `JOB_CANCELLED` 并释放 active job。

建议幂等键：

```text
school_overview_sync:{user_id}:{cooldown_bucket_or_force_token}
school_detail_sync:{user_id}:{experiment_id}
draft_submit:{submission_id}:{content_hash}
final_submit:{submission_id}:{content_hash}
```

`content_hash` 由后端根据平台提交的表单值和图片引用计算，不信任前端传来的 hash。

### 10.4 页面刷新和跨实验操作

如果用户提交一个实验后刷新页面，再进入另一个实验并提交：

- 前端应先查询当前用户是否有 active automation job。
- 如果已有提交 job 正在运行，前端显示该 job 的进度，禁止再次提交。
- 如果已有 job 是可排队的概览同步或详情同步，后端可以排队，但不能并行使用同一个学校 session。
- 如果第一个提交 job 已完成，第二个实验可以正常创建新 job。
- 如果第一个提交 job 失败，第二个实验能否继续由错误类型决定：
  - `SESSION_EXPIRED`、`NETWORK_UNREACHABLE`：建议先恢复会话或提示用户重试。
  - `FIELD_WRITE_VERIFY_FAILED`：只影响当前实验，不应阻断其他实验。
  - `CREDENTIAL_FAILED`：阻断后续学校自动化，直到账号问题解决。

### 10.5 数据库层约束

后端代码检查之外，还应在数据库层保证一致性：

- `automation_jobs` 增加 `idempotency_key`。
- active job 查询必须在事务内完成。
- 创建 job 时使用行级锁或唯一约束，避免并发请求同时创建两个 job。
- `submissions` 更新状态时检查当前状态，避免旧 job 覆盖新状态。
- job 完成时只能更新自己负责的 submission 和 snapshot。

建议后续迁移增加：

```text
automation_jobs.idempotency_key
automation_jobs.public_status
automation_jobs.public_message_code
automation_jobs.public_message_params
automation_jobs.sensitive_payload
```

其中 `sensitive_payload` 永远不返回给普通前端接口。

## 11. 标准化提示系统

前端和后端提示必须组件化、标准化，避免文案散落在页面、接口和 worker 中。

### 11.1 后端提示码

后端接口和 `automation_jobs.public_message_code` 返回稳定的 `messageCode`，而不是到处手写中文。

示例：

```json
{
  "messageCode": "school.overview.syncing",
  "messageParams": {
    "experimentName": "电表的改装"
  }
}
```

建议新增后端模块：

```text
backend/core/messages.py
```

职责：

- 维护 message code。
- 维护默认中文文案。
- 将错误码映射为用户可读提示。
- 将自动化步骤映射为前端进度文案。

### 11.2 前端提示字典

建议新增前端模块：

```text
frontend/src/constants/automationMessages.js
```

职责：

- 维护自动化同步、回填、提交的所有前端提示文本。
- 根据 `messageCode` 和 `messageParams` 渲染文案。
- 页面只引用统一方法，不直接写散落中文。

### 11.3 前端通用组件

建议新增或抽象：

```text
AutomationProgressModal
SchoolSyncNotice
AutomationJobStatusBadge
```

用途：

- `AutomationProgressModal`：阻塞式提交进度弹窗。
- 学生侧 `AutomationProgressModal` 只展示进度和失败结果，不提供终止按钮；管理员任务管理界面可接入 `POST /api/v1/automation-jobs/{job_id}/cancel` 处理卡死任务。
- `SchoolSyncNotice`：概览同步和单实验同步提示。
- `AutomationJobStatusBadge`：列表或详情页展示最近一次自动化状态。

### 11.4 第一批标准提示文本

```text
school.overview.syncing = 正在从学校系统同步您的概览数据，请耐心等待...
school.overview.connecting = 正在准备学校系统会话...
school.overview.openingLogin = 正在准备学校系统会话...
school.overview.recognizingCaptcha = 正在识别登录验证码...
school.overview.loggingIn = 正在确认学校系统登录结果...
school.overview.checkingLogin = 正在确认学校系统登录结果...
school.overview.retryingCaptcha = 验证码校验失败，正在重新识别并重试...
school.overview.readingList = 正在读取完成报告列表...
school.overview.savingSnapshot = 正在加载学校系统状态到平台...
school.overview.success = 您的概览数据已读取完成，请查看仪表盘进行下一步操作。
school.overview.failed = 当前无法连接至学校系统，原因：{reason}，若该情况持续存在，请反馈并联系管理员。

school.detail.syncing = 正在从学校系统同步您的「{experimentName}」填写数据，请耐心等待...
school.detail.connecting = 正在准备学校系统会话...
school.detail.opening = 正在打开实验报告...
school.detail.reading = 正在读取学校系统已填写内容...
school.detail.savingSnapshot = 正在加载实验填写快照到平台...
school.detail.success = 您的实验数据填写已读取完成，并已回填至当前网页，请进行下一步操作。
school.detail.failed = 当前无法同步实验数据，原因：{reason}，若该情况持续存在，请反馈并联系管理员。

school.submit.saving = 正在保存数据至平台...
school.submit.connecting = 正在准备学校系统会话...
school.submit.opening = 正在打开实验报告...
school.submit.filling = 正在回填表单数据...
school.submit.verifying = 正在校验写入结果...
school.submit.submittingDraft = 正在执行临时提交...
school.submit.submittingFinal = 正在执行正式提交...
school.submit.confirming = 正在确认学校系统反馈...
school.submit.returningList = 正在同步学校提交状态...
school.submit.readingStatus = 正在同步学校提交状态...
school.submit.success = 提交成功，学校系统状态已更新。
school.submit.failed = 提交失败，原因：{reason}，系统已保留本次平台数据快照。
school.submit.verifyFailed = 部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。
```

## 12. 前端需要新增的能力

### 12.1 概览同步浮窗

位置：

- 用户登录后进入工作台。
- `StudentDashboardPage` 和 `StudentExperimentsPage` 都应能感知概览同步状态。

显示：

- 同步中。
- 成功通知。
- 失败通知。
- 手动同步按钮。

### 12.2 单实验同步浮窗

位置：

- `StudentExperimentDetailPage`。

显示：

- 正在同步当前实验填写数据。
- 同步成功后把学校系统值合并到页面表单。
- 同步失败时允许继续使用平台已有数据。

### 12.3 提交阻塞弹窗

位置：

- `StudentExperimentDetailPage`。

要求：

- 阻塞页面操作。
- 显示每一步状态。
- 支持轮询 `automation_jobs`。
- 失败时展示可理解原因和重试入口。

## 13. 后端接口建议

第一阶段建议新增：

```text
POST /api/v1/school-sync/overview
GET  /api/v1/school-sync/overview/latest
POST /api/v1/school-sync/experiments/{experiment_id}
POST /api/v1/school-sync/experiments/{experiment_id}/submit
GET  /api/v1/automation-jobs/{job_id}
GET  /api/v1/automation-jobs/active
POST /api/v1/automation-jobs/{job_id}/cancel
GET  /api/v1/automation-jobs/{job_id}/events   # 可后置，第一版先轮询
```

提交接口请求示例：

```json
{
  "mode": "draft",
  "form_values": {},
  "image_values": {}
}
```

`mode` 第一版允许：

```text
draft
final
```

`final` 必须要求前端二次确认，并在后端写入独立审计日志。

## 14. 实施顺序

1. 增加 job 查询接口和前端通用进度弹窗。
2. 增加后端幂等键、active job 查询和数据库级并发保护。
3. 抽出学校系统 Playwright 登录 service，先只支持内网 URL。
4. 实现概览同步：登录、验证码识别、读取姓名和实验状态。
5. 将学校状态合并到仪表盘和 `StudentExperimentsPage`。
6. 实现单实验按需同步：点击“完成报告”，读取 modal 节点数据。
7. 实现回填后逐节点校验：文本、表格、图片均需确认成功写入。
8. 实现临时提交：保存平台快照、回填、校验、点击临时提交、确认反馈。
9. 实现正式提交：二次确认、独立 job、严格审计。
10. 后续补固定 VPN 账号环境变量的校园认证人工协助流程。

## 15. 第一阶段验收标准

- 内网可达时，学生登录平台后能自动同步学校概览。
- 10 分钟内不会重复自动同步，手动同步可强制触发。
- 学校实验列表的“未提交 / 临时提交 / 正常提交”能保存并在学生页面展示。
- 学生点进实验后能打开对应学校 modal 并读取已有节点值。
- 临时提交能保存平台快照、回填学校系统、逐节点校验写入结果，并读取成功或失败反馈。
- 所有读取 / 写入学校 DOM 的步骤都经过通用稳定等待和回读确认，避免页面异步渲染导致空读或误判成功。
- 所有自动化 job 均有状态、错误码、审计日志和必要截图。
- 前端提示文本通过统一字典和通用组件管理，不在页面中散落硬编码。
- 学生端接口只返回脱敏 public job 状态，不暴露选择器、脚本细节、验证码、密码、内部 payload 或截图真实路径。
- 重复点击同步或提交不会创建重复 active job；相同请求返回已有 job，冲突请求返回 409。
- 用户刷新页面后能恢复当前 active job 进度；一个实验提交完成或失败后，另一个实验的提交能按锁规则正确排队或启动。
- 探测和读取流程不会点击“正式提交”。

## 16. 接入真实 Playwright 前检查

已完成的基础能力：

- 自动化配置、重试参数、等待参数和安全红线已文档化；默认概览冷却时间为 `syncCooldownSeconds=600`。
- 自动化 job 已有脱敏 public DTO、active 查询、幂等键和 active job 唯一约束。
- 概览同步已有 `GET /api/v1/school-sync/overview/latest` 和 `POST /api/v1/school-sync/overview`；后端已接入 `school_overview_sync` service，负责内网连通性探测、Playwright 登录、验证码 AI 识别、真实姓名和完成报告列表读取。当前仍需在配置 `AI_API_KEY` 且可访问学校内网的环境中做真实端到端验证。
- 单实验同步已有 `POST /api/v1/school-sync/experiments/{experiment_id}` 真实 service：复用用户级学校浏览器会话，回到完成报告列表，点击对应实验“完成报告”，读取 modal 字段并保存 `school_sync_snapshots(source=school_report_modal)`。
- 临时 / 正式提交共用 `POST /api/v1/school-sync/experiments/{experiment_id}/submit` service：前端提交时先保存平台数据，再创建 `draft_submit` 或 `final_submit` job；后端打开学校 modal、按 `automation.mappings` 回填和校验文本字段、点击对应提交按钮、等待反馈、返回主实验列表并读取状态。正式提交当前仅后端流程准备完成，学生端二次确认弹窗的确认按钮仍保持禁用。
- 提交前已保存 `submission_versions(source=platform_before_submit)`，便于后续真实学校系统失败时追踪平台侧快照。
- 学生端接口只返回 public job 状态和标准提示码，不返回选择器、验证码、密码、内部 payload 或截图真实路径。
- 学生仪表盘和实验详情页会在进入页面时恢复当前 active job 弹窗，避免刷新后丢失进度。

仍需由真实 Playwright 层继续完成或验证的能力：

- 概览同步真实环境验证：确认内网连通性、验证码识别准确率、选择器稳定性、真实姓名和学校提交状态读取结果。
- 将学校状态合并到学生页面的实验列表和仪表盘指标。
- 在真实学校页面继续验证各实验 `automation.mappings` 与 modal DOM 是否完全匹配；特殊节点通过 `targetType=text | wysiwyg_text | wysiwyg_image` 区分写入策略，普通节点默认 `text`。
- 根据平台节点值回填学校 DOM，逐节点校验文本、表格和图片是否写入成功。
- 点击临时 / 正式提交按钮，等待学校反馈、保存截图 / HTML 摘要，并写入真实学校状态快照。
- VPN / 二次验证人工协助分支仍只预留状态，不在第一阶段实现。
