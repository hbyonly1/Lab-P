# Agent 操作手册

本文件约束所有 AI Agent 在本仓库中的工作方式。先理解产品流程，再修改页面、接口或数据表。所有改动都应围绕“可运行、可验证、可追踪”的垂直切片推进。

## 0. 项目定位

本项目是“实验报告智能处理平台”：

```text
学生选择实验和服务模式
  |
人工收款或后续第三方支付
  |
学生上传手写实验报告图片
  |
AI 识别图片为结构化数据
  |
完整模式由 reviewer 人工纠错、补固定填空和实验问题
  |
后台 Playwright 自动登录学校实验报告系统
  |
按 DOM 节点表自动填报并提交
  |
学生查看状态、截图和结果
```

当前优先实现“完整提交模式”，因为它包含最多人工处理、支付确认、权限控制和自动化链路。工具辅助模式后续复用完整模式的基础设施。

## 1. 工作前必须读取

在修改代码、配置、数据库、接口或页面前，必须先读取：

- `docs/产品技术规划.md`
- `docs/TASK_BREAKDOWN.md`

如果任务涉及接口或数据模型，后续应新增或同步：

- `docs/API_CONTRACT.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

这些文件不存在时，按任务需要创建；不要引用旧项目 IgniteNow 的规则或字段。

## 2. 当前目录约定

| 目录 | 职责 |
|---|---|
| `frontend/` | 前端项目，当前来自用户另一个项目，基于 React + Vite + Ant Design 改造成实验报告平台页面 |
| `backend/` | 后端服务，建议使用 FastAPI + SQLAlchemy/SQLModel + Alembic |
| `docs/` | 产品规划、任务拆解、API 契约、进度和技术决策 |
| `original_code_sources/` | 旧本地工具、userscript、Playwright、批量识别代码等参考来源 |

不要因为 `frontend/` 里残留旧项目名称、旧页面或旧文档就沿用旧业务语义。应逐步替换为实验报告平台语义。

## 3. 标准工作流

1. 明确本次目标、影响角色和验收标准。
2. 读取相关文档和现有代码。
3. 搜索可复用的组件、API client、路由和样式。
4. 做最小可验证改动。
5. 同步必要文档。
6. 运行与改动范围匹配的验证。
7. 最终说明改了什么、如何验证、仍有什么风险。

## 4. 产品角色和权限

系统角色：

```text
student  学生用户
reviewer 人工审核员 / 纠错员
admin    管理员
```

权限原则：

- student 只能访问自己的订单、任务、图片、识别结果和截图。
- reviewer 只能访问分配给自己的审核任务，不能修改订单、支付状态、用户角色或系统配置。
- admin 可以管理订单、任务、reviewer、实验配置、DOM 节点表和 Prompt。
- 前端隐藏页面不等于权限控制。所有后端接口必须校验登录态、角色、资源归属和任务状态。
- 任何用户都不能通过修改 URL、请求体中的 `user_id`、`role`、`order_id`、`submission_id` 越权访问数据。

## 5. 当前优先业务链路

先实现完整提交模式：

```text
student 创建完整提交订单
  |
admin 人工确认支付
  |
student 上传实验图片
  |
AI 识别
  |
reviewer 人工纠错、补固定填空和实验问题
  |
Playwright 自动填报并提交
  |
student 查看结果
```

第一条可演示切片：

```text
student 创建完整提交订单
  |
admin 确认支付
  |
student 上传图片
  |
student 查看任务状态
```

不要先一次性实现所有页面或所有后端。优先做能跑通的垂直切片。

## 6. 前端规则

`frontend/` 当前是 React + Vite + Ant Design 项目。

前端开发原则：

- 基于现有 `frontend/src` 改造，不盲目重建项目。
- 优先复用已有 layout、route、service、auth 和样式结构。
- 页面应按角色拆分：`student`、`reviewer`、`admin`。
- 页面文案和导航必须使用实验报告平台语义，不保留旧项目业务词。
- 前端可以先使用 mock 数据验证流程，但 mock 字段必须与计划中的 API contract 保持一致。
- 不在前端信任或决定价格、支付状态、角色、任务归属。
- 上传图片、查看截图、查看结果都必须以服务端鉴权接口为目标设计。

建议页面：

```text
/login
/student
/student/orders/:id
/student/submissions/:id/upload
/student/submissions/:id/status
/student/submissions/:id/result

/reviewer
/reviewer/tasks
/reviewer/tasks/:id

/admin
/admin/orders
/admin/submissions
/admin/review-tasks
/admin/experiments
/admin/dom-mappings
/admin/prompts
```

## 7. 后端规则

推荐后端：

```text
FastAPI + SQLAlchemy/SQLModel + Alembic + PostgreSQL + Redis
```

后端必须负责：

- 登录和角色识别
- 订单价格计算
- 人工收款确认
- 任务状态机
- 文件访问鉴权
- AI 识别任务调度
- reviewer 审核任务
- Playwright 自动填报任务
- 审计日志

后端不能信任前端传来的：

```text
price
payment_status
role
user_id
order_id 所属关系
submission_id 所属关系
```

这些必须从数据库和当前登录态重新校验。

## 8. 数据库和迁移规则

数据表可以随着页面和流程迭代变化，这是正常的。专业做法是使用 migration 管理变化。

规则：

- 使用 Alembic 管理表结构变化。
- 稳定字段单独成列。
- 不稳定内容先用 JSON 字段承接，例如 `recognition_json`、`corrected_json`、`config_json`、`mapping_json`。
- 新增字段必须同步 API contract 和相关文档。
- 不手动乱改数据库后又不记录迁移。

第一版核心表建议：

```text
users
products
orders
submissions
uploaded_files
audit_logs
```

后续再按需要拆分：

```text
experiments
dom_mappings
recognition_results
review_tasks
automation_jobs
payments
```

## 9. 支付规则

阶段 1 使用人工收款确认：

```text
student 下单
  |
student 扫码付款并提交截图或备注
  |
admin 后台核对
  |
admin 确认 paid
  |
系统放行任务
```

规则：

- student 不能修改支付状态。
- reviewer 不能修改支付状态。
- admin 确认支付必须写入 `audit_logs`。
- 后端根据 `product_id`、`experiment_id`、`mode` 计算价格。
- 只有 `orders.status = paid` 且 `submissions.payment_status = paid` 的任务才能继续。

## 10. 自动化与敏感信息规则

- 学校系统密码不能明文长期保存。
- 如需保存，应作为任务级临时凭据加密保存。
- 自动填报完成后应清理任务中的学校密码。
- 学校密码不能返回给前端。
- 学校密码不能写入日志。
- Playwright 自动化必须保存截图和错误信息，方便复查。
- 自动提交、重试提交等高风险动作必须有状态检查和审计日志。

## 11. 文档维护规则

每次任务结束前，只更新受影响文档：

- `docs/TASK_BREAKDOWN.md`：任务拆解或优先级变化。
- `docs/产品技术规划.md`：产品模式、页面、权限、支付和架构变化。
- `docs/API_CONTRACT.md`：接口、字段、状态变化。
- `docs/DECISIONS.md`：重要技术决策。
- `docs/PROGRESS.md`：阶段进展、验证结果、遗留风险。

不要写无法运行的理想状态。文档应反映当前计划或实际实现。

## 12. 禁止事项

- 禁止继续沿用旧项目 IgniteNow 的业务概念。
- 禁止在未确认权限规则的情况下新增管理接口。
- 禁止前端直接决定订单金额、支付状态或用户角色。
- 禁止提交 API Key、学校账号密码、真实用户隐私或不可公开数据。
- 禁止删除或回滚用户已有改动，除非用户明确要求。
- 禁止大范围重构与当前任务无关的代码。

## 13. 完成定义

一个任务只有同时满足以下条件，才算完成：

1. 代码或文档已按范围修改。
2. 涉及接口、字段、状态或权限时，相关文档已同步。
3. 至少执行一种合理验证，或说明无法验证原因。
4. 最终回复说明：
   - 改了哪些文件
   - 如何验证
   - 是否有遗留风险
