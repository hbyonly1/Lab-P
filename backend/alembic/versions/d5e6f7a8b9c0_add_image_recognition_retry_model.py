"""add image recognition retry model

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
Create Date: 2026-07-07 08:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ai_config",
        sa.Column("image_recognition_retry_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "ai_config",
        sa.Column("image_recognition_retry_model", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.alter_column("ai_config", "image_recognition_retry_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("ai_config", "image_recognition_retry_model")
    op.drop_column("ai_config", "image_recognition_retry_enabled")
