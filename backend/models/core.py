from typing import Optional, Dict, Any, List
from sqlmodel import SQLModel, Field, Column
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime, timezone

def get_utc_now():
    return datetime.now(timezone.utc)

class User(SQLModel, table=True):
    __tablename__ = "users"
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    student_no: Optional[str] = Field(default=None, index=True, unique=True)
    real_name: Optional[str] = Field(default=None)
    hashed_password: str
    encrypted_school_password: Optional[str] = Field(default=None)
    role: str = Field(default="student") # student, reviewer, admin
    capabilities: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=get_utc_now)

class Experiment(SQLModel, table=True):
    __tablename__ = "experiments"
    id: str = Field(primary_key=True)
    title: str
    version: str = Field(default="1.0")
    config_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    mapping_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)
    config_file_mtime: Optional[datetime] = Field(default=None)
    config_hash: Optional[str] = Field(default=None)

class Order(SQLModel, table=True):
    __tablename__ = "orders"
    id: str = Field(primary_key=True) # e.g. ORD-12345
    student_id: int = Field(foreign_key="users.id")
    experiment_id: Optional[str] = Field(default=None, foreign_key="experiments.id")
    plan: str # free, pay_per_use, plus, pro
    amount: float
    status: str = Field(default="pending_payment") # pending_payment, paid, rejected
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class Submission(SQLModel, table=True):
    __tablename__ = "submissions"
    id: str = Field(primary_key=True) # e.g. SUB-12345
    student_id: int = Field(foreign_key="users.id")
    experiment_id: str = Field(foreign_key="experiments.id")
    order_id: Optional[str] = Field(default=None, foreign_key="orders.id")
    submitted_by: Optional[int] = Field(default=None, foreign_key="users.id")
    
    status: str = Field(default="pending_payment") # pending_payment, recognizing, reviewing, submitting, completed, error
    payment_status: str = Field(default="unpaid") # unpaid, paid
    is_one_click_handoff: bool = Field(default=False)
    
    image_paths: List[str] = Field(default_factory=list, sa_column=Column(JSONB))
    image_slots: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    recognition_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    corrected_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    submission_batch_id: Optional[str] = Field(default=None, index=True)
    preprocess_status: Optional[str] = Field(default=None)
    preprocess_error: Optional[str] = Field(default=None)
    
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class AutomationEngineConfig(SQLModel, table=True):
    __tablename__ = "automation_engine_configs"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(default="default", index=True, unique=True)
    config_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    schema_version: str = Field(default="1.0")
    is_active: bool = Field(default=True)
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    updated_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class AutomationJob(SQLModel, table=True):
    __tablename__ = "automation_jobs"
    id: str = Field(primary_key=True)
    idempotency_key: Optional[str] = Field(default=None, index=True)
    submission_id: Optional[str] = Field(default=None, foreign_key="submissions.id")
    experiment_id: Optional[str] = Field(default=None, foreign_key="experiments.id")
    actor_user_id: Optional[int] = Field(default=None, foreign_key="users.id")
    action: str
    status: str = Field(default="queued")
    public_status: Optional[str] = Field(default=None)
    public_message_code: Optional[str] = Field(default=None)
    public_message_params: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    attempt: int = Field(default=0)
    max_attempts: int = Field(default=1)
    request_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    result_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    sensitive_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    screenshot_keys: List[str] = Field(default_factory=list, sa_column=Column(JSONB))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class SubmissionVersion(SQLModel, table=True):
    __tablename__ = "submission_versions"
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: str = Field(foreign_key="submissions.id", index=True)
    version_no: int
    source: str
    snapshot_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    school_snapshot_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=get_utc_now)

class SubmissionDraft(SQLModel, table=True):
    __tablename__ = "submission_drafts"
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: str = Field(foreign_key="submissions.id", index=True)
    draft_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    image_paths: List[str] = Field(default_factory=list, sa_column=Column(JSONB))
    image_slots: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    local_revision: int = Field(default=0)
    updated_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class SchoolSyncSnapshot(SQLModel, table=True):
    __tablename__ = "school_sync_snapshots"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    submission_id: Optional[str] = Field(default=None, index=True)
    experiment_id: Optional[str] = Field(default=None, foreign_key="experiments.id")
    snapshot_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    summary_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    synced_at: datetime = Field(default_factory=get_utc_now)
    automation_job_id: Optional[str] = Field(default=None, foreign_key="automation_jobs.id")
    created_at: datetime = Field(default_factory=get_utc_now)

class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id")
    action: str = Field(index=True) # Corresponds to AUDIT_ACTION_META
    status: str # pending, success, failed
    target_id: Optional[str] = Field(default=None) # Submission ID or Order ID
    details: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=get_utc_now)

class AiTaskRun(SQLModel, table=True):
    __tablename__ = "ai_task_runs"
    task_id: str = Field(primary_key=True)
    task_kind: str = Field(index=True)
    status: str = Field(default="pending", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    target_id: Optional[str] = Field(default=None, index=True)
    experiment_id: Optional[str] = Field(default=None, index=True)
    submission_id: Optional[str] = Field(default=None, foreign_key="submissions.id", index=True)
    started_audit_log_id: Optional[int] = Field(default=None, foreign_key="audit_logs.id")
    finished_audit_log_id: Optional[int] = Field(default=None, foreign_key="audit_logs.id")
    request_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    result_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    error_message: Optional[str] = None
    error_type: Optional[str] = None
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)
    finished_at: Optional[datetime] = None

class Announcement(SQLModel, table=True):
    __tablename__ = "announcements"
    id: str = Field(primary_key=True)
    title: str
    content: str
    type: str = Field(default="update") # update, warning, info
    created_at: datetime = Field(default_factory=get_utc_now)

class PromptConfig(SQLModel, table=True):
    __tablename__ = "prompt_configs"
    id: str = Field(primary_key=True)
    content: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

class Feedback(SQLModel, table=True):
    __tablename__ = "feedbacks"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="users.id")
    contact_info: Optional[str] = None
    description: str
    created_at: datetime = Field(default_factory=get_utc_now)

class AiConfig(SQLModel, table=True):
    __tablename__ = "ai_config"
    id: int = Field(default=1, primary_key=True)
    provider: str = Field(default="openai_compatible")
    base_url: str = Field(default="https://api.openai.com/v1")
    default_model: str = Field(default="gpt-4o")
    default_timeout_seconds: int = Field(default=60)
    default_temperature: float = Field(default=0.7)
    default_max_images_per_task: int = Field(default=8)
    auto_recognize: bool = Field(default=False)
    image_recognition_model: str = Field(default="gpt-4o")
    image_recognition_retry_enabled: bool = Field(default=False)
    image_recognition_retry_model: Optional[str] = None
    image_recognition_timeout_seconds: int = Field(default=60)
    image_recognition_temperature: float = Field(default=0)
    image_recognition_max_images_per_task: int = Field(default=8)
    answer_generation_model: str = Field(default="gpt-4o")
    answer_generation_timeout_seconds: int = Field(default=60)
    answer_generation_temperature: float = Field(default=0.85)
    captcha_model: str = Field(default="gpt-4o")
    captcha_timeout_seconds: int = Field(default=30)
    captcha_temperature: float = Field(default=0)
    captcha_prompt: str = Field(default="OCR this captcha. Return exactly one token: the 4-character uppercase code.")
    updated_at: datetime = Field(default_factory=get_utc_now)
    updated_by: Optional[int] = Field(default=None, foreign_key="users.id")

class AiPromptTemplate(SQLModel, table=True):
    __tablename__ = "ai_prompt_templates"
    experiment_id: str = Field(primary_key=True)
    recognition_system_prompt: Optional[str] = None  # 覆盖系统指令
    generation_system_prompt: Optional[str] = None
    updated_at: datetime = Field(default_factory=get_utc_now)
