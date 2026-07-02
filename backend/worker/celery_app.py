from celery import Celery
from core.config import settings
import os

# Set default Celery configuration
broker_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/0"
result_backend = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/0"

celery_app = Celery(
    "lab_p_worker",
    broker=broker_url,
    backend=result_backend,
    include=["worker.tasks", "worker.ai_tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    worker_prefetch_multiplier=1, # Very important for long-running Playwright tasks
)
