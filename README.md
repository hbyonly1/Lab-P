# Lab-P - Physics Experiment Processing Platform

## Deployment & Setup

This project uses Docker Compose for easy deployment of the backend services (FastAPI + PostgreSQL + Redis) and Celery workers.

### First Boot & Admin Account

For security, the super admin account is generated **dynamically** on the very first boot of the database. 
A highly secure, complex password will be printed to the backend logs.

To retrieve the admin password, run the following command in your terminal:

```bash
docker-compose logs backend | grep "ADMIN_PASSWORD_GENERATED"
```

Use this password with the username `admin` to log into the management console. 
**Note:** This password is only generated once. Ensure you save it securely. 
If you lose it, you will need to reset it directly in the PostgreSQL database.

### Running the Application

1. **Start Backend Services**:
```bash
docker-compose up -d --build
```
This starts PostgreSQL, Redis, FastAPI, Celery, and Nginx.

Docker Compose loads the repository root `.env` into both `backend` and `celery_worker`. Keep `AI_API_KEY` and AI seed settings there so Celery-based AI tasks such as answer generation and image recognition use the same provider configuration as the FastAPI process.

### Making Backend Code Changes Take Effect

When editing backend Python files such as `backend/core/ai_prompts.py`, refreshing the browser is not enough. The page calls the backend API, and the running Uvicorn process must reload the Python module before changes appear.

For local non-Docker development, either restart the backend process manually or start it with auto-reload:

```bash
cd backend
PYTHONPATH=. venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

For Docker Compose, backend code is copied into the Docker image during build. After changing backend Python code, rebuild and recreate the affected services:

```bash
docker-compose up -d --build backend celery_worker

cd backend
PYTHONPATH=. venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Docker Compose exposes the backend on `http://localhost:8000`. If the frontend is running in Vite dev mode, check `frontend/.env.local`; when it contains `VITE_API_BASE_URL=http://localhost:8001`, the page is using the local development backend, not the Docker backend. In that case, rebuilding Docker will not affect the page you are viewing. Restart the local `8001` backend instead, or change `frontend/.env.local` to `http://localhost:8000` and restart Vite.

If no source code changed and you only need to restart the already-built backend container, use:

```bash
docker-compose restart backend
```

If you changed worker code or logic used by background tasks, restart or rebuild `celery_worker` as well:

```bash
docker-compose restart celery_worker
```

2. **Start Frontend (Dev Mode)**:
```bash
cd frontend
npm install
npm run dev
```

### Accessing the Application

一旦前端和后端服务均成功启动，你可以通过浏览器访问以下网址：

- **用户操作主站 (前端 UI)**: 
  [http://localhost:5173](http://localhost:5173) 
  *(提供给学生下单、查看进度，以及管理员审核的界面)*

- **后端 API 文档 (Swagger UI)**: 
  [http://localhost:8000/docs](http://localhost:8000/docs) 
  *(用于直接测试和查看所有的 API 接口规范)*

### Stopping & Resetting Data

本项目的数据库默认是 PostgreSQL，Docker Compose 中服务名为 `postgres`，默认数据库名为 `lab_p`。

在清空前先确认你当前前端连的是哪一个后端 / 数据库：

- Vite 开发前端如果 `frontend/.env.local` 里是 `VITE_API_BASE_URL=http://localhost:8001`，通常使用你本机启动的后端。
- Docker 前端 / 后端默认走 Compose 网络里的 `postgres` 服务。
- 清空数据库会删除用户、订单、审核任务、自动化任务、学校同步快照和审计日志。真实环境不要执行这些命令。

#### Option A: 本机 8001 后端清空数据

如果 `frontend/.env.local` 指向：

```text
VITE_API_BASE_URL=http://localhost:8001
```

你正在使用本机启动的 FastAPI 后端。这个后端默认仍连接 `postgresql://postgres:password@localhost:5432/lab_p`，通常就是 Docker Compose 暴露到本机 `5432` 的 PostgreSQL。

先停止正在运行的 `8001` 后端进程，然后进入数据库：

```bash
psql postgresql://postgres:password@localhost:5432/lab_p
```

如果你的电脑没有安装本机 `psql`，但 Docker PostgreSQL 正在运行，也可以用容器里的 `psql` 操作同一个库：

```bash
docker-compose exec postgres psql -U postgres -d lab_p
```

进入 `psql` 后执行：

```sql
TRUNCATE TABLE
  ai_config,
  ai_prompt_templates,
  announcements,
  audit_logs,
  automation_engine_configs,
  automation_jobs,
  experiments,
  feedbacks,
  orders,
  prompt_configs,
  school_sync_snapshots,
  submission_versions,
  submissions,
  users
RESTART IDENTITY CASCADE;
```

退出：

```sql
\q
```

然后在本机后端环境跑 migration 并重新启动 `8001`：

```bash
cd backend
PYTHONPATH=. venv/bin/alembic upgrade head
PYTHONPATH=. venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

后端启动时会重新写入默认实验配置和默认管理员。此流程不需要重建 Docker 后端镜像。

#### Option B: Docker 后端清空数据但保留表结构和 migration 记录

适合本地重新测试业务流程。这个方式会保留 `alembic_version`，只清空业务表：

```bash
docker-compose exec postgres psql -U postgres -d lab_p
```

进入 `psql` 后执行：

```sql
TRUNCATE TABLE
  ai_config,
  ai_prompt_templates,
  announcements,
  audit_logs,
  automation_engine_configs,
  automation_jobs,
  experiments,
  feedbacks,
  orders,
  prompt_configs,
  school_sync_snapshots,
  submission_versions,
  submissions,
  users
RESTART IDENTITY CASCADE;
```

然后退出：

```sql
\q
```

重建并重启后端，让最新代码和 Alembic migration 进入容器，再由启动逻辑重新写入默认实验配置和默认管理员：

```bash
docker-compose up -d --build backend celery_worker
```

#### Option C: 彻底销毁 Docker 数据卷并重建

适合你只使用 Docker Compose 数据库，并且想连数据库文件一起重建：

```bash
docker-compose down -v
docker-compose up -d --build
```

`down -v` 会删除 Docker volume，包括 PostgreSQL 和 Redis 数据。后端重新启动后会重新创建表、默认配置和首次管理员账号；新的管理员密码请重新从日志中查看：

```bash
docker-compose logs backend | grep "ADMIN_PASSWORD_GENERATED"
```

#### Troubleshooting: Alembic 找不到某个 revision

如果重启后端时看到类似错误：

```text
FAILED: Can't locate revision identified by 'b9f1e2c3d4a5'
```

说明数据库的 `alembic_version` 表记录了这个 migration，但当前运行的后端代码里没有对应的文件。最常见原因是只执行了 `docker-compose restart ...`，旧镜像没有包含新 migration。

先确认本地文件存在：

```bash
ls backend/alembic/versions | grep b9f1e2c3d4a5
```

如果存在，重建后端和 worker 镜像：

```bash
docker-compose up -d --build backend celery_worker
```

如果你正在使用本机后端而不是 Docker 后端，改为在本机运行迁移：

```bash
cd backend
PYTHONPATH=. venv/bin/alembic upgrade head
```

如果这个 migration 文件在你的工作区不存在，先切到包含该 migration 的代码版本，或从仓库同步最新代码。不要随手改 `alembic_version`，除非你明确知道当前数据库 schema 已经和目标 revision 完全一致。

#### Optional: 清理上传文件

数据库清空不会自动删除本地上传图片。如果你也想重置上传文件，可在确认不需要保留后删除：

```bash
rm -rf backend/uploads/*
```
