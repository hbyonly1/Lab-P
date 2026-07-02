from sqlalchemy import event, insert
from sqlalchemy.orm.attributes import get_history
from models.core import Submission, AuditLog
from datetime import datetime, timezone

def get_utc_now():
    return datetime.now(timezone.utc)

@event.listens_for(Submission, 'after_update')
def log_submission_status_change(mapper, connection, target):
    hist = get_history(target, 'status')
    if hist.has_changes():
        old_status = hist.deleted[0] if hist.deleted else "unknown"
        new_status = hist.added[0] if hist.added else "unknown"
        
        # Insert AuditLog synchronously in the same transaction
        connection.execute(
            insert(AuditLog).values(
                user_id=target.student_id,
                action="status_changed",
                status="success",
                target_id=target.id,
                details=f"Status changed from '{old_status}' to '{new_status}'",
                created_at=get_utc_now()
            )
        )

@event.listens_for(Submission, 'after_insert')
def log_submission_creation(mapper, connection, target):
    connection.execute(
        insert(AuditLog).values(
            user_id=target.student_id,
            action="submission_created",
            status="success",
            target_id=target.id,
            details=f"Submission created with status '{target.status}'",
            created_at=get_utc_now()
        )
    )
