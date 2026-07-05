"""add public automation job fields

Revision ID: 5b6c7d8e9f10
Revises: f72a8d93a4b6
Create Date: 2026-07-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "5b6c7d8e9f10"
down_revision: Union[str, Sequence[str], None] = "f72a8d93a4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("automation_jobs", sa.Column("idempotency_key", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column("automation_jobs", sa.Column("public_status", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column("automation_jobs", sa.Column("public_message_code", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column("automation_jobs", sa.Column("public_message_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("automation_jobs", sa.Column("sensitive_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index(op.f("ix_automation_jobs_idempotency_key"), "automation_jobs", ["idempotency_key"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_automation_jobs_idempotency_key"), table_name="automation_jobs")
    op.drop_column("automation_jobs", "sensitive_payload")
    op.drop_column("automation_jobs", "public_message_params")
    op.drop_column("automation_jobs", "public_message_code")
    op.drop_column("automation_jobs", "public_status")
    op.drop_column("automation_jobs", "idempotency_key")
