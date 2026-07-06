"""add_ai_task_runs

Revision ID: a2b3c4d5e6f7
Revises: f6a7b8c9d0e1
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_task_runs",
        sa.Column("task_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("task_kind", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("target_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("experiment_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("submission_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("started_audit_log_id", sa.Integer(), nullable=True),
        sa.Column("finished_audit_log_id", sa.Integer(), nullable=True),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("error_type", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["finished_audit_log_id"], ["audit_logs.id"]),
        sa.ForeignKeyConstraint(["started_audit_log_id"], ["audit_logs.id"]),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("task_id"),
    )
    op.create_index(op.f("ix_ai_task_runs_experiment_id"), "ai_task_runs", ["experiment_id"], unique=False)
    op.create_index(op.f("ix_ai_task_runs_status"), "ai_task_runs", ["status"], unique=False)
    op.create_index(op.f("ix_ai_task_runs_submission_id"), "ai_task_runs", ["submission_id"], unique=False)
    op.create_index(op.f("ix_ai_task_runs_target_id"), "ai_task_runs", ["target_id"], unique=False)
    op.create_index(op.f("ix_ai_task_runs_task_kind"), "ai_task_runs", ["task_kind"], unique=False)
    op.create_index(op.f("ix_ai_task_runs_user_id"), "ai_task_runs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_task_runs_user_id"), table_name="ai_task_runs")
    op.drop_index(op.f("ix_ai_task_runs_task_kind"), table_name="ai_task_runs")
    op.drop_index(op.f("ix_ai_task_runs_target_id"), table_name="ai_task_runs")
    op.drop_index(op.f("ix_ai_task_runs_submission_id"), table_name="ai_task_runs")
    op.drop_index(op.f("ix_ai_task_runs_status"), table_name="ai_task_runs")
    op.drop_index(op.f("ix_ai_task_runs_experiment_id"), table_name="ai_task_runs")
    op.drop_table("ai_task_runs")
