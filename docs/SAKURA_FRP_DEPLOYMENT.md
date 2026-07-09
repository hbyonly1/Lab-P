# Sakura FRP 内网穿透部署说明

本文档记录当前项目接入 Sakura FRP 的推荐方式。目标是只暴露一个本机 Web 入口，不直接暴露 Vite、FastAPI、PostgreSQL、Redis 或 Playwright 调试端口。

## 架构

```text
公网用户
  |
  v
Sakura FRP 公网入口
  |
  v
127.0.0.1:8080
  |
  v
lab_p_nginx
  |-- /              -> React 静态文件
  |-- /api/v1/...    -> lab_p_backend:8000
```

默认端口由 `.env` 控制：

```env
PUBLIC_WEB_PORT=8080
BACKEND_PORT=8000
VITE_API_BASE_URL=
```

`VITE_API_BASE_URL` 生产环境通常保持为空，让前端请求同源 `/api/v1`。这样 Sakura FRP 的公网域名变化时不需要重新写死 API 地址。

## 启动

首次或前端代码变更后，重建 Nginx 镜像：

```bash
docker compose build nginx
docker compose up -d
```

只改后端 Python 代码时：

```bash
docker compose up -d --build backend celery_worker
```

查看入口是否正常：

```bash
curl -I http://127.0.0.1:8080
curl http://127.0.0.1:8080/api/v1/auth/me
```

第二个请求未登录时返回 `401/403` 属于正常现象，说明 Nginx 已能转发到后端。

## Sakura FRP 面板配置

在 Sakura FRP 中创建 HTTP/HTTPS 类型隧道：

```text
本地地址：127.0.0.1
本地端口：8080
绑定域名：你的公网域名或 Sakura 分配域名
```

如果面板要求填写“本地服务”或“远程访问类型”，选择 HTTP 网站服务即可。不要创建 TCP 隧道直连 `5432`、`6379`、`8000` 或 `5173`。

## 安全要求

公网试运行前至少确认：

- `.env` 不提交到仓库，不发给他人。
- `SECRET_KEY`、`SCHOOL_PASSWORD_SECRET_KEY`、`ADMIN_PASSWORD` 使用强随机值。
- Sakura FRP 只转发 `127.0.0.1:8080`。
- Admin 账号使用强密码；公开运营前建议给后台路径再加 Sakura/反代侧访问控制或 IP 白名单。
- 上传图片和截图只能通过 `/api/v1/files/view`、`/api/v1/automation-jobs/.../screenshot` 等鉴权接口读取，不配置静态公开目录。
- 数据库和 Redis 只绑定本机回环地址。

## 当前 Docker 约束

`docker-compose.yml` 已将这些端口绑定到 `127.0.0.1`：

```text
PostgreSQL  127.0.0.1:5432
Redis       127.0.0.1:6379
Backend     127.0.0.1:8000
Nginx       127.0.0.1:8080
```

这意味着 Sakura FRP 客户端必须运行在同一台机器上，转发 `127.0.0.1:8080`。
