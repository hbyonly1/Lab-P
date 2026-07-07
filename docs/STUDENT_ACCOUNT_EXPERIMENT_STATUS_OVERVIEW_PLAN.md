# 学生账户与实验提交状态总览页规划

## 1. 页面定位

该页面用于查看所有学生的账户状态和学校实验提交状态，回答两个问题：

- 这个学生的平台账户和学校账号状态是否正常。
- 这个学生要求提交的实验是否已经全部提交。

该页面不替代审核任务页。审核任务页只看 reviewer/admin 当前要处理的审核工作是否完成；本页面看学生维度的最终提交进度。

建议入口：

```text
/workspace/admin/student-status-overview
```

第一版建议只开放给 `admin`。如果后续 reviewer 需要查看，只能看分配给自己的学生或批次。

## 2. 核心定义

### 2.1 账户状态

账户状态用于判断学生是否具备继续自动化处理的基础条件。

第一版可展示：

- 平台账号是否存在。
- 学号是否存在。
- 姓名是否已同步。
- 最近一次学校系统总览同步是否成功。
- 最近一次学校系统登录/同步错误。
- 最近一次同步时间。

不展示学校密码，不返回学校密码，不在前端判断密码内容。

### 2.2 实验提交状态

实验提交状态优先来自学校系统总览同步结果，即 `SchoolSyncSnapshot.snapshot_json` 或 `summary_json` 中的实验列表和统计。

学校状态建议统一映射为：

```text
school_unsubmitted       未提交
school_draft_submitted   临时提交
school_final_submitted   正式提交
school_unknown           未识别 / 异常
```

第一版“已提交”建议同时包含：

```text
school_draft_submitted
school_final_submitted
```

因为当前业务中临时提交成功后平台 submission 会落为 `draft_submitted`，这已经表示后台处理和学校写入成功。页面仍应单独显示“临时提交”和“正式提交”数量，避免把两者混成一个不可追踪的状态。

如后续业务要求“必须正式提交才算完成”，可以增加一个筛选或系统配置：

```text
完成口径：临时或正式 / 仅正式
```

## 3. 页面结构

### 3.1 顶部指标

建议指标：

- 学生总数
- 账户正常
- 学校同步失败
- 全部已提交
- 未全部提交
- 未同步

### 3.2 主表

每行代表一个学生。

建议列：

| 列 | 含义 |
|---|---|
| 学号 | `users.student_no` 或登录账号 |
| 姓名 | `users.real_name` |
| 平台账号 | 正常 / 缺信息 / 禁用（如后续有禁用字段） |
| 学校同步 | 成功 / 失败 / 未同步 / 进行中 |
| 全部提交 | 是 / 否 / 未知 |
| 提交进度 | 已提交数 / 应提交数 |
| 临时提交 | `school_draft_submitted` 数量 |
| 正式提交 | `school_final_submitted` 数量 |
| 未提交 | `school_unsubmitted` 数量 |
| 异常 | 未识别或同步错误 |
| 最后同步 | 最近 `SchoolSyncSnapshot.synced_at` |
| 操作 | 同步学校总览 / 查看详情 |

### 3.3 展开行

展开后展示该学生的每个实验。

建议列：

| 列 | 含义 |
|---|---|
| 实验名称 | 学校系统或平台实验配置名称 |
| 学校状态 | 未提交 / 临时提交 / 正式提交 / 异常 |
| 平台任务状态 | 最近一次 `submissions.status` |
| 审核状态 | 基于 `draft_submitted` / `completed` 派生 |
| 批次 | `submission_batch_id` |
| 最后处理时间 | submission 或学校同步更新时间 |
| 操作 | 跳转审核任务 / 跳转提交详情 / 重新同步 |

## 4. 筛选与搜索

第一版筛选：

- 搜索学号 / 姓名
- 账户状态
- 学校同步状态
- 是否全部提交
- 实验名称
- 学校实验状态
- 最近同步时间范围

可选增强：

- 只看有异常的学生
- 只看未同步学生
- 只看某个提交批次关联学生
- 只看某个 reviewer 处理过的学生

## 5. 数据来源

当前可复用的数据：

- `users`
  - 学号、姓名、角色、平台账号。
- `school_sync_snapshots`
  - 学校系统总览同步结果、每个学生的学校实验状态、最后同步时间。
- `submissions`
  - 平台内任务状态、批次号、实验 ID、提交状态。
- `experiments`
  - 平台实验配置名称。
- `automation_jobs`
  - 最近同步任务状态、失败原因、错误码。

第一版建议以后新增聚合接口，而不是让前端拼多个列表：

```text
GET /api/v1/admin/student-status-overview
```

返回结构建议：

```json
{
  "students": [
    {
      "user_id": 1,
      "student_no": "20260001",
      "real_name": "张三",
      "account_status": "ok",
      "school_sync_status": "succeeded",
      "all_submitted": false,
      "required_total": 8,
      "submitted_total": 6,
      "draft_submitted": 4,
      "final_submitted": 2,
      "unsubmitted": 2,
      "unknown": 0,
      "last_synced_at": "2026-07-07T10:30:00Z",
      "experiments": [
        {
          "experiment_id": "exp_photoelectric_planck",
          "experiment_name": "光电效应和普朗克常数的测定",
          "school_status": "school_draft_submitted",
          "platform_status": "draft_submitted",
          "review_status": "completed",
          "submission_batch_id": "BATCH-XXXX"
        }
      ]
    }
  ]
}
```

## 6. 权限与安全

- 第一版仅 `admin` 可访问。
- 页面不返回学校密码。
- 同步操作必须写入 `audit_logs`。
- 如果后续允许 reviewer 查看，后端必须按任务分配或批次归属过滤，不能只靠前端隐藏。
- 学生本人只能看自己的学生端状态页，不访问该总览。

## 7. 与现有页面的边界

审核任务页：

- 关注“这批/这个实验是否已经被审核并提交到学校系统”。
- `draft_submitted` 和 `completed` 都可视为审核完成。
- 不展示所有学生维度的总提交进度。

学生账户与实验提交状态总览页：

- 关注“每个学生所有实验是否已经全部提交”。
- 主要依据学校系统总览同步结果。
- 可辅助定位未提交学生、同步失败学生、账户异常学生。

## 8. 分阶段实现

### 阶段 1：只读总览

- 新增 admin 页面。
- 后端新增聚合接口。
- 使用最近一次学校总览同步快照。
- 支持搜索、全部提交筛选、学校状态筛选。

### 阶段 2：同步能力

- 支持对单个学生触发学校总览同步。
- 支持批量触发未同步学生的学校总览同步。
- 展示同步任务状态和错误码。

### 阶段 3：联动处理

- 从未提交实验跳转到对应审核任务或 submission。
- 支持按实验批量筛选未提交学生。
- 支持导出 CSV。

## 9. 当前不做

- 不在审核任务页塞入学生总完成度。
- 不新增数据库字段。
- 不修改学校提交状态机。
- 不展示或编辑学校密码。
