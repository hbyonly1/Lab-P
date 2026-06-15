# IgniteNow Web Workspace JWT 认证方案

本文记录 Web 工作台当前采用的 JWT 登录方案。第一版不做 refresh token，access token 存在 `localStorage`，需要登录的业务接口统一携带 `Authorization: Bearer <access_token>`。

## 1. 目标

完整链路：

```text
打开 /login
→ 输入账号和密码
→ POST /api/auth/login
→ 后端校验账号和密码 hash
→ 后端签发 access_token
→ 前端保存 access_token 和用户信息
→ 根据 role 跳转 /workspace/*
→ 后续请求携带 Authorization: Bearer <access_token>
→ 后端校验 JWT 签名、过期时间和角色
→ 通过后调用对应业务接口函数
```

## 2. 路由

```text
/                 产品入口页
/login            工作台登录页
/workspace        统一工作台，按 role 跳转默认页
/workspace/dashboard  仪表盘，admin
/workspace/dramas     内容管理，admin/uploader
/workspace/analyze    AI 生产，admin/uploader
/workspace/analyze/jobs/:jobId AI 任务详情，admin/uploader
/workspace/highlights 审核发布，admin
/workspace/highlights/dramas/:dramaId 短剧审核详情，admin
```

访问 `/workspace/*` 时需要路由保护：本地有 access token 才允许进入，否则跳转 `/login`。页面路由会按 role 过滤，无权限页面会跳转到该角色默认页。后端返回 `401/403` 时，前端清除本地 token 并跳转 `/login`。

## 3. 登录接口

最终契约以 `docs/API_CONTRACT.md` 为准。

```http
POST /api/auth/login
Content-Type: application/json
```

请求体：

```json
{
  "username": "admin",
  "password": "password"
}
```

成功响应 `data`：

```json
{
  "access_token": "jwt.access.token",
  "token_type": "Bearer",
  "expires_in": 7200,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  },
  "user_id": 1,
  "username": "admin",
  "role": "admin"
}
```

前端优先读取 `data.user`。`user_id`、`username`、`role` 是后端为了兼容当前移动端上传代码保留的扁平字段。

状态码：

```text
200 登录成功
400 请求体不合法
401 账号或密码错误 / token 非法或过期
403 已登录但角色无后台权限
500 服务端错误
```

## 4. 当前用户接口

```http
GET /api/auth/me
Authorization: Bearer <access_token>
```

成功响应结构与登录接口一致，会返回一个新的 access token。

## 5. 登出接口

第一版没有 refresh token 和服务端 token 黑名单，因此登出接口只用于流程对齐，真正的退出动作由前端清除本地 token 完成。

```http
POST /api/auth/logout
Authorization: Bearer <access_token>
```

响应 `data`：

```json
{
  "revoked": false
}
```

## 6. 前端模块

当前已实现：

```text
src/pages/LoginPage.jsx       登录表单，调用 /api/auth/login
src/auth.js                   localStorage 登录态读写
src/services/apiClient.js     Axios 实例，自动注入 Bearer token
src/services/authApi.js       login/logout API 封装
src/App.jsx                   /workspace/* 路由和角色保护
src/workspaceModules.jsx      工作台模块与角色权限配置
```

`apiClient.js` 行为：

```text
请求前：读取本地 access token，写入 Authorization
响应后：遇到 401/403，清理本地登录态并跳转 /login
```

## 7. 后端模块

当前后端已经提供：

```text
user_account 数据表
/api/auth/login
/api/auth/me
/api/auth/logout
/api/auth/admin/users
password hash 工具
JWT sign / verify 工具
require_user / require_roles / require_admin 依赖
```

工作台 API 安全边界在后端：旧 `X-Admin-Token` 已移除，所有需要登录的接口都使用 Bearer JWT。`admin` 可访问全部内容管理、高光审核、发布、analytics 和账号托管；`uploader` 只能访问上传、自己名下剧集的内容管理和 AI 分析相关能力。

## 8. 当前状态

当前 `/login` 已接入真实后端 JWT 登录，不再写入开发占位 token。`/workspace/*` 已有工作台布局、路由守卫和按角色过滤的侧边栏；内容管理和后台任务已接入真实接口，高光审核、AI 分析独立页和看板仍需继续完善。

首次本地部署如果没有管理员账号，需要先在仓库根目录运行：

```bash
python backend/scripts/bootstrap_admin.py
```

脚本只会在数据库中不存在 `admin` 角色账号时创建第一个管理员，并输出一次性随机密码。
