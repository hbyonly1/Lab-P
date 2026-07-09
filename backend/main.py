from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.v1 import auth, orders, submissions, files, audit, ai, experiments, feedback, automation_config, automation_jobs, school_sync, checkout, admin_students
from core.config import settings
import os
from contextlib import asynccontextmanager
from sqlmodel import Session, select
import secrets
import string
from core.db import engine
from models.core import User, Experiment
from core.security import get_password_hash
from services.experiment_seed import seed_experiment_configs
from services.school_session_manager import school_session_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize super admin on first boot
    with Session(engine) as session:
        admin_username = settings.ADMIN_USERNAME
        admin_user = session.exec(select(User).where(User.username == admin_username)).first()
        if not admin_user:
            alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
            
            if settings.ADMIN_PASSWORD:
                secure_password = settings.ADMIN_PASSWORD
                msg = f"[ADMIN_PASSWORD_SET] Username: {admin_username} | Password: (loaded from .env)"
            else:
                secure_password = ''.join(secrets.choice(alphabet) for _ in range(16))
                msg = f"[ADMIN_PASSWORD_GENERATED] Username: {admin_username} | Password: {secure_password}"
            
            admin_user = User(
                username=admin_username,
                hashed_password=get_password_hash(secure_password),
                role="admin",
                capabilities={"max_computes": 9999}
            )
            session.add(admin_user)
            session.commit()
            print("="*60)
            print(msg)
            print("="*60)

        seed_experiment_configs(session)
            
    try:
        yield
    finally:
        school_session_manager.shutdown(reason="application_shutdown")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(checkout.router, prefix=f"{settings.API_V1_STR}/checkout", tags=["checkout"])
app.include_router(orders.router, prefix=f"{settings.API_V1_STR}/orders", tags=["orders"])
app.include_router(submissions.router, prefix=f"{settings.API_V1_STR}/submissions", tags=["submissions"])
app.include_router(files.router, prefix=f"{settings.API_V1_STR}/files", tags=["files"])
app.include_router(audit.router, prefix=f"{settings.API_V1_STR}/audit", tags=["audit"])
app.include_router(ai.router, prefix=f"{settings.API_V1_STR}/ai", tags=["ai"])
app.include_router(experiments.router, prefix=f"{settings.API_V1_STR}/experiments", tags=["experiments"])
app.include_router(feedback.router, prefix=f"{settings.API_V1_STR}/feedback", tags=["feedback"])
app.include_router(automation_config.router, prefix=f"{settings.API_V1_STR}/admin/automation-config", tags=["automation-config"])
app.include_router(admin_students.router, prefix=f"{settings.API_V1_STR}/admin/students", tags=["admin-students"])
app.include_router(automation_jobs.router, prefix=f"{settings.API_V1_STR}/automation-jobs", tags=["automation-jobs"])
app.include_router(school_sync.router, prefix=f"{settings.API_V1_STR}/school-sync", tags=["school-sync"])

os.makedirs("uploads", exist_ok=True)

@app.get("/")
def root():
    return {"message": "Lab-P Backend API is running"}
