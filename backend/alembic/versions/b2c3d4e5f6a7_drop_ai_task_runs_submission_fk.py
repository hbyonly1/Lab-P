"""drop_ai_task_runs_submission_fk

Revision ID: b2c3d4e5f6a7
Revises: a2b3c4d5e6f7
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ai_task_runs_submission_id_fkey", "ai_task_runs", type_="foreignkey")


def downgrade() -> None:
    op.create_foreign_key(
        "ai_task_runs_submission_id_fkey",
        "ai_task_runs",
        "submissions",
        ["submission_id"],
        ["id"],
    )
