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

停止服务并**彻底销毁所有数据**：

```bash
docker-compose down -v
```
