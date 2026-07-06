"""drop_generation_data_nodes

Revision ID: d4e5f6a7b8c9
Revises: b9f1e2c3d4a5
Create Date: 2026-07-06 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "b9f1e2c3d4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("ai_prompt_templates", "generation_data_nodes")


def downgrade() -> None:
    op.add_column(
        "ai_prompt_templates",
        sa.Column("generation_data_nodes", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
