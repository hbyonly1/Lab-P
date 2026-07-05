"""unique active automation job key

Revision ID: 6c7d8e9f1011
Revises: 5b6c7d8e9f10
Create Date: 2026-07-05 12:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6c7d8e9f1011"
down_revision: Union[str, Sequence[str], None] = "5b6c7d8e9f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ACTIVE_STATUS_SQL = "status IN ('queued', 'running', 'retrying', 'waiting_manual_vpn_auth', 'waiting_manual_2fa')"


def upgrade() -> None:
    op.drop_index(op.f("ix_automation_jobs_idempotency_key"), table_name="automation_jobs")
    op.create_index(
        "uq_automation_jobs_active_idempotency_key",
        "automation_jobs",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text(f"idempotency_key IS NOT NULL AND {ACTIVE_STATUS_SQL}"),
    )


def downgrade() -> None:
    op.drop_index("uq_automation_jobs_active_idempotency_key", table_name="automation_jobs")
    op.create_index(
        op.f("ix_automation_jobs_idempotency_key"),
        "automation_jobs",
        ["idempotency_key"],
        unique=False,
    )
