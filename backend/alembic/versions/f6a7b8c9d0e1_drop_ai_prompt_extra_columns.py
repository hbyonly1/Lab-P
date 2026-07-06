"""drop_ai_prompt_extra_columns

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("ai_prompt_templates", "recognition_extra_prompt")
    op.drop_column("ai_prompt_templates", "generation_extra_prompt")


def downgrade() -> None:
    op.add_column(
        "ai_prompt_templates",
        sa.Column("generation_extra_prompt", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "ai_prompt_templates",
        sa.Column("recognition_extra_prompt", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
