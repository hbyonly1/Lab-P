"""drop image recognition retry model

Revision ID: f9a0b1c2d3e4
Revises: f8a9b0c1d2e3
Create Date: 2026-07-09 07:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("ai_config", "image_recognition_retry_model")


def downgrade() -> None:
    op.add_column(
        "ai_config",
        sa.Column("image_recognition_retry_model", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
