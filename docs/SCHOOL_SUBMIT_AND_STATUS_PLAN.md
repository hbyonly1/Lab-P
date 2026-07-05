# 学校提交与实验列表状态拆分计划

## 1. 背景和目标

当前学校自动化已经具备概览同步、单实验读取、回填和临时提交骨架，但还有两个需要收口的问题：

1. 临时提交时，如果学校实验报告 modal 已经打开，后端不应该粗暴关闭后再重新打开同一个实验；应该先识别当前页面状态，如果当前 modal 就是目标实验，则直接复用。
2. 实验列表里现在只有一个“状态”，容易把学校系统里的提交事实和平台自己的处理进度混在一起。后续列表应拆成“学校提交状态”和“平台处理状态”两个维度展示和保存。

本计划只定义后续实现规则，不表示相关代码已经全部完成。

## 2. 当前临时提交问题

场景：

```text
学生进入实验详情
  -> 平台同步学校已有数据
  -> 学校报告 modal 已经打开
  -> 学生在平台点击临时提交
```

现有链路容易出现的问题：

- 提交 job 没有复用当前已经打开的报告 modal，而是先恢复列表，再重新点击“完成报告”打开同一个实验。
- 学校系统点击“临时提交”后已经弹出成功提示，但后端后续状态识别不够准确，可能返回提交失败。
- 提交成功后的学校列表状态可能不会立刻刷新，或者列表状态文本映射不完整，导致平台误判失败。

已观察到的成功反馈节点形态：

```html
<div class="bootbox-body">提交成功!</div>
<button data-bb-handler="ok" class="btn btn-primary">OK</button>
```

## 3. 报告 modal 复用规则

后续提交前不应只有“恢复主列表再打开”这一条路径，而应先调用统一入口：

```text
get_or_open_report_modal(user_id, experiment_id)
```

建议状态判断顺序：

1. 识别当前学校页面状态：`login_page`、`report_list`、`report_modal`、`bootbox_dialog`、`loading`、`unknown`。
2. 如果当前是 `report_modal`，先读取 modal 内的实验标题、隐藏字段或可稳定识别的实验标识。
3. 如果当前 modal 属于目标实验，直接复用，不关闭、不重新打开。
4. 如果当前 modal 不属于目标实验，关闭当前 modal，恢复到 `report_list`，再打开目标实验。
5. 如果当前是 `bootbox_dialog`，先关闭 bootbox，再重新识别状态。
6. 如果当前是 `loading`，等待 loading 消失后重新识别状态。
7. 如果当前是 `report_list`，直接按实验名称打开目标实验。
8. 如果当前是 `login_page`、`closed` 或 `missing`，才重新登录。

目标是让“会话状态恢复”变成通用能力，而不是每个 job 自己猜页面在哪里。

## 4. 临时提交目标流程图

临时提交不应该固定从“重新登录学校系统”开始。正确入口应该是“获取当前用户学校会话，并恢复到本次动作需要的页面状态”：

```text
学生点击临时提交
  |
  v
保存平台当前填写数据
  |
  v
创建 / 复用 draft_submit automation job
  |
  v
获取 user_id 对应的学校浏览器会话，并持有用户级操作锁
  |
  v
识别当前学校页面状态
  |
  +--> missing / closed
  |       |
  |       v
  |     新建 Playwright 会话并登录学校系统
  |
  +--> login_page
  |       |
  |       v
  |     重新登录学校系统
  |
  +--> loading
  |       |
  |       v
  |     等待 loading 消失后重新识别状态
  |
  +--> bootbox_dialog
  |       |
  |       v
  |     关闭 bootbox 后重新识别状态
  |
  +--> report_modal
  |       |
  |       +--> 属于目标实验：直接复用当前 modal
  |       |
  |       +--> 不属于目标实验：关闭 modal -> 恢复 report_list -> 打开目标实验
  |
  +--> report_list
  |       |
  |       v
  |     按实验名称打开目标实验 modal
  |
  +--> unknown
          |
          v
        尝试点击 / 跳转完成报告主列表；失败才返回 SCHOOL_SESSION_UNAVAILABLE
  |
  v
等待目标实验 modal 稳定
  |
  v
按 automation.mappings 回填学校 DOM
  |
  v
逐节点回读校验写入结果
  |
  v
点击学校系统“临时提交”
  |
  v
等待学校提交反馈
  |
  +--> 读到“提交成功!”等明确成功反馈
  |       |
  |       v
  |     submitAccepted = true
  |
  +--> 未读到明确成功反馈
          |
          v
        继续读取列表状态；仍无确认则失败
  |
  v
关闭成功 bootbox / 恢复页面状态
  |
  v
尽量返回完成报告列表并读取该实验学校提交状态
  |
  +--> 列表确认 school_draft_submitted
  |       |
  |       v
  |     statusConfirmation = list_confirmed
  |
  +--> 列表未刷新 / 未映射 / 超时，但已读到明确成功反馈
          |
          v
        statusConfirmation = feedback_only
  |
  v
保存 school_sync_snapshots、automation_jobs.result_payload、audit_logs
  |
  v
更新平台状态和前端展示
```

这个流程的关键点是：登录只是会话缺失、关闭或停在登录页时的恢复手段，不是每次临时提交的固定前置步骤。

## 5. 前端提交进度面板展示

前端提交时展示的是用户可理解的业务进度，不展示完整后端分支树。也就是说，后端可以在“准备学校系统会话”阶段内部复用当前 Playwright 会话、关闭残留 bootbox、恢复列表、重新登录；前端不应该把这些内部恢复动作拆成一堆步骤。

当前前端已有 `AutomationProgressModal`，使用方式是：

```text
StudentExperimentDetailPage
  -> 创建 draft_submit / final_submit job
  -> 打开 AutomationProgressModal
  -> 每 800ms 轮询 GET /api/v1/automation-jobs/{jobId}
  -> 读取 job.status 和 job.messageCode
  -> 渲染顶部当前提示 + 纵向 Steps
  -> succeeded / failed 后切换为 Result 成功或失败页
```

### 5.1 面板展示原则

- 弹窗是阻塞式：提交运行中不能关闭，成功或失败后才能关闭。
- 顶部始终展示当前 `messageCode` 对应的文案，并配 loading 图标。
- 下方用纵向步骤条展示主流程；已完成步骤显示对勾，当前步骤显示序号。
- 失败时展示统一失败结果，不暴露选择器、HTML、截图真实路径、验证码、学校密码或内部 payload。
- 成功时展示 `draft_submit` / `final_submit` 对应的成功文案。
- 轮询失败只作为黄色提示，不应把学校提交 job 直接标记为失败；真实失败以 job 状态为准。

### 5.2 提交面板推荐步骤

前端步骤保持稳定，不跟随后端内部恢复分支频繁变化：

```text
1. 正在保存数据至平台...
2. 正在准备学校系统会话...
3. 正在打开实验报告...
4. 正在回填表单数据...
5. 正在校验写入结果...
6. 正在执行临时提交 / 正式提交...
7. 正在确认学校系统反馈...
8. 正在同步学校提交状态...
9. 正在更新平台状态...
```

说明：

- 第 2 步“准备学校系统会话”覆盖复用现有会话、恢复当前页面、必要时重新登录。前端不再表达成“每次都重新登录”。
- 第 6 步继续复用当前前端的 `school.submit.submitAction` 聚合概念；后端仍可发送 `school.submit.submittingDraft` 或 `school.submit.submittingFinal`，前端把它们映射到同一个步骤。
- 第 8 步覆盖关闭成功弹窗、返回完成报告列表、读取列表状态；用户不需要看到 bootbox / modal / report_list 这些内部名词。
- 如果后端已经读到明确“提交成功!”反馈，但列表状态暂未确认，前端仍进入成功态；可在成功结果里用较轻的提示说明“学校已返回提交成功，列表状态将在下次同步时刷新”。

### 5.3 messageCode 建议

当前已有 messageCode 可以继续复用，但展示文案建议调整：

```text
school.submit.saving          正在保存平台数据...
school.submit.connecting      正在准备学校系统会话...
school.submit.opening         正在打开实验报告...
school.submit.filling         正在回填表单数据...
school.submit.verifying       正在校验写入结果...
school.submit.submittingDraft 正在执行临时提交...
school.submit.submittingFinal 正在执行正式提交...
school.submit.confirming      正在确认学校系统反馈...
school.submit.readingStatus   正在同步学校提交状态...
school.submit.success         提交成功，学校系统状态已更新。
school.submit.draftSuccess    临时提交成功，学校系统已保存草稿。
school.submit.finalSuccess    正式提交成功，学校系统状态已更新。
school.submit.failed          提交失败，原因：{reason}，系统已保留本次平台数据快照。
school.submit.verifyFailed    部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。
```

`school.submit.returningList` 可以保留给后端诊断或旧兼容，但前端展示上建议合并到“正在同步学校提交状态...”，避免用户看到“返回完成报告列表”后误以为页面一定会被关闭再重新打开。

### 5.4 成功和失败状态

成功态：

```text
job.status = succeeded
  |
  +--> draft_submit: 显示“临时提交成功，学校系统已保存草稿。”
  |
  +--> final_submit: 显示“正式提交成功，学校系统状态已更新。”
```

如果后端返回：

```json
{
  "submitAccepted": true,
  "statusConfirmation": "feedback_only"
}
```

前端仍展示成功，但可以加一条非阻塞说明：

```text
学校系统已返回提交成功，列表状态可能稍后刷新。
```

失败态：

```text
job.status = failed
  |
  v
显示后端 public messageCode 对应文案
```

典型失败展示：

```text
提交失败，原因：学校系统未确认临时提交状态，系统已保留本次平台数据快照。
```

字段写入校验失败时优先展示：

```text
部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。
```

### 5.5 与后端流程图的关系

后端流程图用于工程实现和排查，前端进度面板用于用户感知。两者不是一一对应关系：

```text
后端：识别 page 状态 -> 复用 modal / 恢复列表 / 关闭 bootbox / 必要时登录
前端：正在准备学校系统会话...

后端：点击临时提交 -> 等 bootbox -> 读提交成功 -> 关弹窗
前端：正在确认学校系统反馈...

后端：返回列表 -> 读取原始状态 -> map_school_status -> 保存 snapshot
前端：正在同步学校提交状态...
```

这样前端既不会误导用户“每次都在重新登录”，也不会暴露过多学校页面内部细节。

## 6. 前端同步进度面板展示

同步进度面板同样使用 `AutomationProgressModal`，但应区分两个场景：

```text
概览同步：同步学校真实姓名 + 完成报告列表 + 学校提交状态
单实验同步：打开某个实验报告 modal + 读取学校已有填写内容 + 保存快照并回填平台页面
```

同步面板也只展示用户能理解的业务阶段。后端内部是否复用已有 Playwright 会话、是否从实验 modal 恢复到列表、是否重新登录，都归入“准备学校系统会话”阶段，不在前端拆开展示。

### 6.1 概览同步面板

触发位置：

```text
StudentDashboardPage
  -> 页面进入时检查 overview/latest
  -> 需要同步时创建 / 复用 school_overview_sync job
  -> 打开 AutomationProgressModal
  -> 轮询 automation job
  -> 成功后刷新 auth/me 和 overview/latest
```

推荐标题：

```text
学校系统概览同步
```

推荐步骤：

```text
1. 正在准备学校系统会话...
2. 正在识别登录验证码...
3. 正在确认学校系统登录结果...
4. 正在读取完成报告列表...
5. 正在加载学校系统状态到平台...
```

说明：

- `school.overview.openingLogin`、`school.overview.loggingIn` 可以保留给后端状态和旧兼容，但前端主步骤建议收敛到“准备学校系统会话”，避免用户误以为每次概览同步都必然重新打开登录页。
- `school.overview.retryingCaptcha` 不作为独立步骤，继续通过 `stepAliases` 映射到“正在识别登录验证码...”。
- 成功后刷新用户真实姓名和学校概览快照；失败时显示 `school.overview.failed` 的脱敏原因。

建议 messageCode 展示映射：

```text
school.overview.syncing            正在从学校系统同步您的概览数据，请耐心等待...
school.overview.connecting         正在准备学校系统会话...
school.overview.openingLogin       正在准备学校系统会话...
school.overview.recognizingCaptcha 正在识别登录验证码...
school.overview.retryingCaptcha    验证码校验失败，正在重新识别并重试...
school.overview.loggingIn          正在确认学校系统登录结果...
school.overview.checkingLogin      正在确认学校系统登录结果...
school.overview.readingList        正在读取完成报告列表...
school.overview.savingSnapshot     正在保存学校系统状态...
school.overview.success            您的概览数据已读取完成，请查看仪表盘进行下一步操作。
school.overview.failed             当前无法连接至学校系统，原因：{reason}，若该情况持续存在，请反馈并联系管理员。
```

### 6.2 单实验同步面板

触发位置：

```text
StudentExperimentDetailPage
  -> 进入实验详情或用户手动同步
  -> 创建 / 复用 school_detail_sync job
  -> 打开 AutomationProgressModal
  -> 轮询 automation job
  -> 成功后把学校已有填写内容回填到当前平台表单
```

推荐标题：

```text
学校系统实验同步
```

推荐步骤：

```text
1. 正在准备学校系统会话...
2. 正在打开实验报告...
3. 正在读取学校系统已填写内容...
4. 正在加载实验填写快照到平台...
```

说明：

- 如果学校页面已经停在目标实验 modal，后端可以直接复用；前端仍显示“正在打开实验报告...”或“正在读取学校系统已有填写内容...”，不展示“复用 modal”这种内部动作。
- 如果学校页面停在其他实验 modal，后端先恢复再打开目标实验；前端仍只展示稳定主流程。
- 单实验同步成功后，前端应更新当前实验表单和本地状态；失败时不覆盖用户当前已编辑内容。

建议 messageCode 展示映射：

```text
school.detail.syncing        正在从学校系统同步您的「{experimentName}」填写数据，请耐心等待...
school.detail.connecting     正在准备学校系统会话...
school.detail.opening        正在打开实验报告...
school.detail.reading        正在读取学校系统已有填写内容...
school.detail.savingSnapshot 正在保存实验填写快照...
school.detail.success        您的实验数据填写已读取完成，并已回填至当前网页，请进行下一步操作。
school.detail.failed         当前无法同步实验数据，原因：{reason}，若该情况持续存在，请反馈并联系管理员。
```

### 6.3 同步面板和提交面板的区别

同步面板不表示提交，也不应该让用户以为平台已经改写学校系统：

| 面板 | 用户理解 | 是否写入学校系统 | 是否改变学校提交状态 |
|---|---|---|---|
| 概览同步 | 读取姓名和实验列表状态 | 否 | 否 |
| 单实验同步 | 读取学校已有填写内容 | 否 | 否 |
| 临时 / 正式提交 | 把平台数据写回学校并提交 | 是 | 是 |

同步面板成功后只说明“读取完成 / 快照已保存”；只有提交面板成功后才显示“临时提交成功 / 正式提交成功”。

## 7. 提交成功判定规则

临时提交不应该只依赖列表状态回读成功。建议拆成两个层级：

```text
submitAccepted       学校系统明确接收了提交动作
statusConfirmation   学校列表状态是否完成二次确认
```

判定规则：

- 如果提交后 bootbox、modal 提示或页面反馈中明确出现“提交成功”，则 `submitAccepted = true`。
- 如果随后返回列表并读到对应实验状态为 `school_draft_submitted`，则 `statusConfirmation = "list_confirmed"`。
- 如果明确读到“提交成功”，但列表状态暂未刷新、暂未映射或回读超时，则 job 可以按成功处理，并记录 `statusConfirmation = "feedback_only"`。
- 如果没有明确成功反馈，也没有列表状态确认，则不能把提交视为成功。
- 平台状态更新时应保留确认来源，方便后续排查“学校已接收，但列表未及时刷新”的情况。

建议结果 payload：

```json
{
  "feedback": ["提交成功!"],
  "submitAccepted": true,
  "statusConfirmation": "feedback_only",
  "listStatus": null,
  "sessionStateAfterSubmit": "bootbox_dialog"
}
```

如果列表也确认成功：

```json
{
  "feedback": ["提交成功!"],
  "submitAccepted": true,
  "statusConfirmation": "list_confirmed",
  "listStatus": "school_draft_submitted",
  "sessionStateAfterSubmit": "report_list"
}
```

## 8. Bootbox 关闭和页面恢复规则

提交成功或失败反馈出现后，应优先按 bootbox 规则关闭弹窗：

```text
.bootbox.modal.in button[data-bb-handler="ok"]
.bootbox.modal.in .bootbox-close-button
.bootbox.modal.in [data-dismiss="modal"]
```

关闭后需要等待：

- `.bootbox.modal.in` 不再可见。
- `.modal-backdrop` 被移除或不可见。
- `body.modal-open` 状态被清理。
- 学校页面 loading 遮罩消失。

之后再识别当前状态：

```text
bootbox_dialog -> close -> report_modal/report_list/unknown
report_modal   -> close or keep, depending on next action
report_list    -> read list status
unknown        -> navigate or click CompleteReport, then read list
```

## 9. 实验列表状态拆分

建议将实验列表中的单一“状态”拆成两个字段和两个展示列：

```text
学校提交状态
平台处理状态
```

### 9.1 学校提交状态

学校提交状态来自学校系统完成报告列表，是外部事实来源，表达学校系统认为该实验当前提交到什么程度。

当前后端已经有学校状态归一化逻辑，来源是 `backend/services/school_overview_sync.py` 的 `map_school_status(raw_status)`。后续不要另起一套枚举，应复用这套映射语义。

建议字段：

```text
schoolStatus
originalStatusText
schoolStatusSyncedAt
```

现有映射：

```text
school_not_submitted    未提交
school_draft_submitted  临时提交
school_final_submitted  正常提交
school_unknown          其他未知文本
```

说明：

- `schoolStatus` 是平台归一化后的状态。
- `originalStatusText` 保存学校页面原始文本，当前概览同步和单实验状态读取都已经使用这个字段名。
- `schoolStatusSyncedAt` 表示该学校状态的同步时间。
- `school_not_synced` 暂不应作为 `map_school_status()` 的返回值；它更适合作为前端在没有任何学校快照时的展示兜底。
- “未完成”不是学校系统状态。它当前是平台状态 `STATUS_META.incomplete` 的展示文案，不能和学校系统的“未提交”混用。

学校概览统计当前按学校状态汇总：

```text
completed = school_draft_submitted + school_final_submitted
unsubmitted = school_not_submitted
draftSubmitted = school_draft_submitted
finalSubmitted = school_final_submitted
unknown = school_unknown
```

### 9.2 平台处理状态

平台处理状态来自平台自己的订单、submission、识别、纠错和自动化 job，表达我们的处理进度。

建议字段：

```text
platformStatus
platformStatusText
latestJobStatus
latestJobErrorCode
```

当前前端已有 `frontend/src/constants/statusEnums.js` 中的 `STATUS_META`，后续列表展示应优先复用现有平台状态语义：

```text
incomplete           未完成
draft_submitted      已临时提交
pending_payment      待核实付款
pending_recognition  待自动识别
recognizing          AI 识别中
reviewing            人工审核中
submitting           自动填写中
completed            已完成
error                处理异常
```

说明：

- 平台状态不能覆盖学校状态。
- 学校状态也不能直接覆盖平台状态。
- 两者不一致时，应把不一致作为诊断信息展示或记录，而不是强行合并成一个 badge。

## 10. 前端列表展示建议

实验列表建议从一个“状态”列改为两个列：

```text
实验名称 | 学校提交状态 | 平台处理状态 | 最近同步时间 | 操作
```

推荐文案：

```text
学校提交状态
平台处理状态
```


典型组合示例：

| 学校提交状态 | 平台处理状态 | 含义 |
|---|---|---|
| 未提交 | 未完成 | 学校还没有提交记录，平台也还没完成处理 |
| 未提交 | 自动填写中 | 平台正在向学校系统回填或提交，但学校列表尚未确认 |
| 临时提交 | 已临时提交 | 学校和平台状态一致 |
| 临时提交 | 处理异常 | 学校可能已接收提交，但平台后续确认或保存失败，需要后台排查 |
| 未同步 | 未完成 | 尚未读取学校系统状态，不能猜测学校提交情况 |

## 11. API 和数据建议

实验列表 DTO 后续可增加：

```json
{
  "experimentId": "exp_meter_modification",
  "experimentName": "电表的改装",
  "schoolStatus": "school_draft_submitted",
  "originalStatusText": "临时提交",
  "schoolStatusSyncedAt": "2026-07-05T13:31:23Z",
  "platformStatus": "error",
  "platformStatusText": "处理异常",
  "latestJobStatus": "failed",
  "latestJobErrorCode": "LIST_REFRESH_TIMEOUT"
}
```

提交 job 结果建议保留：

```json
{
  "submitAccepted": true,
  "statusConfirmation": "feedback_only",
  "schoolStatus": null,
  "originalStatusText": null,
  "feedback": ["提交成功!"]
}
```

## 12. 后续实现位置

后续代码实现时优先检查这些位置：

- `backend/services/school_overview_sync.py`
  - 继续复用 `map_school_status(raw_status)`。
  - 如果未来学校系统出现新原始文本，在这里集中扩展映射，不在前端或其他 service 里分散判断。
- `backend/services/school_session_manager.py`
  - 页面状态识别。
  - bootbox / modal / loading 恢复。
  - 用户级学校会话串行锁。
- `backend/services/school_report_sync.py`
  - `get_or_open_report_modal()`。
  - `_click_submit_and_wait_feedback()`。
  - `close_submit_feedback_dialog()`。
  - 提交成功判定和结果 payload。
- `frontend/src/components/ui/AutomationProgressModal.jsx`
  - 概览同步、单实验同步、提交都复用同一个进度弹窗组件，但传入不同 `steps`。
  - 同步面板只表达读取和保存快照，不表达提交成功。
  - 提交过程只展示稳定业务步骤，不展示完整后端恢复分支。
  - 将 `school.submit.submittingDraft` / `school.submit.submittingFinal` 继续聚合为一个提交动作步骤。
  - `feedback_only` 成功可展示为成功态附带轻提示。
- `frontend/src/constants/automationMessages.js`
  - 将 `school.overview.connecting` / `school.detail.connecting` 的展示文案调整为“正在准备学校系统会话...”。
  - 将 `school.submit.connecting` 的展示文案从“正在连接学校系统...”调整为“正在准备学校系统会话...”。
  - 将 `school.submit.readingStatus` 的展示文案调整为“正在同步学校提交状态...”。
- `frontend/src/pages` 下学生实验列表相关页面
  - 将单一“状态”拆为“学校提交状态”和“平台处理状态”。
  - 两个状态分别使用不同字段和 badge。
- `docs/API_CONTRACT.md`
  - 后续实现接口字段时同步正式 DTO。

## 13. 验收标准

后续实现完成后，应满足：

- 当前已经打开目标实验 modal 时，临时提交直接复用该 modal，不重新打开同一个实验。
- 当前打开的是其他实验 modal 时，能够关闭并恢复主列表，再打开目标实验。
- 临时提交流程不会固定重新登录；只有会话缺失、关闭、停在登录页或恢复失败时才登录。
- 概览同步和单实验同步面板也不展示“固定重新登录”语义，统一表达为准备学校系统会话。
- 同步面板成功文案只表达读取完成和快照保存，不表达提交成功或学校状态已被改变。
- 前端提交进度面板不展示“固定重新登录”语义，第 2 步应表达为准备 / 恢复学校系统会话。
- 前端进度步骤保持用户可理解，不暴露 bootbox、selector、HTML、artifact 路径等内部细节。
- 提交后出现“提交成功!” bootbox 时，job 识别为学校已接收提交。
- 列表状态未及时刷新时，job 不应因为列表未确认而错误返回“提交失败”，但必须记录 `statusConfirmation = "feedback_only"`。
- 列表状态成功回读时，记录 `statusConfirmation = "list_confirmed"`。
- 实验列表同时展示“学校提交状态”和“平台处理状态”。
- 平台状态和学校状态不一致时，前端能展示差异，后台能通过 job payload 和 snapshot 追踪原因。
- 学校提交状态枚举只从 `map_school_status()` 派生；平台处理状态只从 `Submission.status` / automation job 状态派生。
