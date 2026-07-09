"""add list performance indexes

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-08 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f8a9b0c1d2e3"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_users_role_created_at", "users", ["role", "created_at"])
    op.create_index("ix_submissions_status_created_at", "submissions", ["status", "created_at"])
    op.create_index("ix_submissions_student_created_at", "submissions", ["student_id", "created_at"])
    op.create_index("ix_orders_status_created_at", "orders", ["status", "created_at"])
    op.create_index("ix_orders_student_created_at", "orders", ["student_id", "created_at"])
    op.create_index("ix_school_sync_snapshots_user_synced_at", "school_sync_snapshots", ["user_id", "synced_at"])


def downgrade() -> None:
    op.drop_index("ix_school_sync_snapshots_user_synced_at", table_name="school_sync_snapshots")
    op.drop_index("ix_orders_student_created_at", table_name="orders")
    op.drop_index("ix_orders_status_created_at", table_name="orders")
    op.drop_index("ix_submissions_student_created_at", table_name="submissions")
    op.drop_index("ix_submissions_status_created_at", table_name="submissions")
    op.drop_index("ix_users_role_created_at", table_name="users")
