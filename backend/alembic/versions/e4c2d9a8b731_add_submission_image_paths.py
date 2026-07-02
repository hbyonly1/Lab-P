"""add submission image paths

Revision ID: e4c2d9a8b731
Revises: 9f2a7c6d4b10
Create Date: 2026-07-02 21:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e4c2d9a8b731"
down_revision: Union[str, Sequence[str], None] = "9f2a7c6d4b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "image_paths",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default="[]",
        ),
    )
    op.alter_column("submissions", "image_paths", server_default=None)


def downgrade() -> None:
    op.drop_column("submissions", "image_paths")
