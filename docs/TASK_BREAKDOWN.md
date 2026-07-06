# Task Breakdown

本项目先实现“完整提交模式”，因为它包含最多人工处理、权限控制、支付确认、AI 识别和自动填报链路。工具辅助模式后续可以复用完整模式的大部分基础设施，只是在审核与内容生成步骤上改为学生自助。

## 0. 当前优先级

优先做一个可运行的完整提交垂直切片：

```text
student 创建订单
  |
admin 人工确认支付
  |
student 上传实验图片
  |
AI 识别生成结构化结果
  |
reviewer 人工纠错、补固定填空和实验问题
  |
Playwright 自动登录学校系统并填报
  |
自动提交
  |
student 查看结果和截图
```

## 1. 阶段一：页面流程原型

目标：先把真实用户流程走通，允许使用 mock 数据，不急于接完整后端。

### 1.1 student 页面

- 登录页
- 引导页（用虚拟数据展示功能）
- 实验上传页（选择要填写的实验，上传图片，填写固定空和实验问题）
- AI 识别结果查看与自助纠错
- 结果页

验收：

- student 只能看到自己的入口和任务
- 从创建任务到等待支付、上传图片、查看状态的页面链路完整
- 页面中明确展示当前任务状态和下一步操作

### 1.2 admin 页面

- 管理总览
- 订单管理
- 人工收款确认页
- 任务管理
- reviewer 分配页
- 实验配置管理入口

验收：

- admin 能看到待确认付款订单
- admin 能将订单标记为 `paid`
- admin 高风险操作需要二次确认

### 1.3 reviewer 页面

- 审核任务列表
- 图片与识别结果对照页
- 纠错编辑页
- 固定填空和实验问题处理页
- 审核完成确认页

验收：

- reviewer 只能处理分配给自己的任务
- reviewer 能保存 `corrected_json`
- reviewer 能标记任务审核完成

## 2. 阶段二：API Contract 和最小数据模型

目标：在正式写后端前，把页面需要的接口草案写清楚。

### 2.1 最小数据表

第一版只保留稳定字段，不稳定内容先用 JSON 字段承接。

```text
users
products
orders
submissions
uploaded_files
audit_logs
```

后续根据需要再拆：

```text
experiments
dom_mappings
recognition_results
review_tasks
automation_jobs
payments
```

### 2.2 最小 API

student：

```text
POST /api/auth/login
GET  /api/me
GET  /api/products
POST /api/orders
GET  /api/orders/:id
POST /api/submissions/:id/files
GET  /api/submissions/:id
GET  /api/submissions/:id/result
```

admin：

```text
GET  /api/admin/orders
POST /api/admin/orders/:id/confirm-payment
GET  /api/admin/submissions
POST /api/admin/review-tasks/assign
```

reviewer：

```text
GET   /api/reviewer/tasks
GET   /api/reviewer/tasks/:id
PATCH /api/reviewer/tasks/:id/correction
POST  /api/reviewer/tasks/:id/complete
```

验收：

- 每个接口定义请求体、响应体、权限和状态变化
- 前端 mock 数据结构与 API 草案一致
- 不允许前端自造未记录字段

## 3. 阶段三：后端基础与权限

目标：实现登录、角色权限、订单、人工收款确认和基础任务流。

### 3.1 登录与角色

- student 使用学号和密码登录
- reviewer/admin 使用平台账号密码登录
- 保存平台登录密码哈希
- 学校系统密码只作为任务凭据临时加密保存

验收：

- 未登录不能访问接口
- student 不能访问 admin/reviewer 接口
- reviewer 不能确认支付
- admin 才能确认支付和分配审核任务

### 3.2 人工收款

- 创建订单
- 展示收款说明
- student 提交付款截图或备注
- admin 确认 `orders.status = paid`
- 同步 `submissions.payment_status = paid`

验收：

- 未支付任务不能进入后续流程
- 前端传入价格不可信，价格由后端根据 product 计算
- 所有确认收款操作写入 `audit_logs`

## 4. 阶段四：文件上传和 AI 识别

目标：学生上传实验图片后，后台自动进入 AI 识别任务。

任务：

- 上传图片到对象存储或本地私有文件目录
- 保存 `uploaded_files`
- 创建识别任务
- 调用现有豆包/Ark 识别逻辑
- 保存 `raw_ai_output`、`recognition_json`

验收：

- student 只能查看自己的图片
- 文件下载接口必须鉴权
- AI 识别失败时任务状态可见
- AI 输出不直接信任，必须做 JSON 解析和格式校验

## 5. 阶段五：reviewer 人工审核

目标：完整模式进入人工处理流程。

任务：

- admin 分配 reviewer
- 按 `submission_batch_id` 聚合一键托管提交批次
- 管理员 / reviewer 把学生上传图片匹配到实验配置的 `inputs.images` 槽位
- 保存 `submission.image_slots`
- 匹配确认后启动审核预处理：固定填空、按 `ai.recognition.imageRef` 识别图片、生成实验问题回答
- reviewer 对照图片修改识别结果
- reviewer 审核 AI 预处理结果并人工点击一键计算
- 保存 `corrected_json`
- 标记审核完成

验收：

- reviewer 只能处理分配任务
- student 不需要选择具体图片槽位，也不能修改托管任务图片匹配
- 预处理复用已有 AI service，不复制 prompt、图片解析或 JSON 清洗逻辑
- `AiConfig.auto_recognize` 默认不承担完整提交主链路
- 所有修改写入审计日志或版本记录
- 审核完成后才能进入自动填报

## 6. 阶段六：Playwright 自动填报与提交

目标：复用原本本地自动化能力，改造成后台 worker。

任务：

- 将 DOM 节点表和实验配置迁移到后端配置
- Worker 拉取待自动填报任务
- 解密任务级学校密码
- Playwright 登录学校系统
- 切换到对应实验
- 按 corrected_json 和 DOM 节点表填报
- 自动提交
- 保存截图、日志、错误信息
- 任务结束后清理学校密码

验收：

- 只有 paid + review_done 的任务能自动填报
- 自动提交前状态机合法
- 失败任务可重试
- 不在日志中输出学校密码
- student 能查看最终截图和结果

## 7. 阶段七：工具辅助模式复用

完整提交模式跑通后，再实现工具辅助模式。

复用：

- 登录
- 支付
- 上传
- AI 识别
- 自动填报
- 自动提交
- 截图和任务状态

差异：

- 不进入 reviewer 审核队列
- student 自己修改识别结果
- student 自己填写固定填空和实验问题
- student 确认后直接进入自动填报队列

## 8. 专业化工程规则

### 8.1 用迁移接受数据表变化

数据表后续一定会改。专业做法是使用 migration 工具管理变更，而不是害怕改表。

建议：

```text
FastAPI + SQLAlchemy/SQLModel + Alembic
```

规则：

- 每次新增字段必须写 migration
- API 文档同步字段变化
- 前端 mock 与接口响应保持一致

### 8.2 状态机优先

先稳定任务状态，再写复杂页面。

建议状态：

```text
created
pending_payment
paid
uploaded
recognizing
recognition_done
reviewing
review_done
automation_pending
automation_running
submitted
failed
cancelled
```

### 8.3 垂直切片优先

不要先把所有前端或所有后端一次性做完。每次做一个可演示链路：

```text
页面
API
数据库
权限
状态变化
验收步骤
```

第一条可演示链路：

```text
student 创建完整提交订单 -> admin 确认支付 -> student 上传图片 -> 状态更新
```

## 9. 当前下一步

1. 根据 `frontend/` 现有 React + Vite + Ant Design 项目改出三类角色的页面壳。
2. 写 `docs/API_CONTRACT.md`，先覆盖订单、任务、上传、审核几个接口。
3. 实现后端最小登录、订单、任务和权限。
4. 接入人工收款确认。
5. 再接 AI 识别和 reviewer 审核。
