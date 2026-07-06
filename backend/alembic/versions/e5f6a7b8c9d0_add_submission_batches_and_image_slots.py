"""add_submission_batches_and_image_slots

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-06 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "image_slots",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column("submissions", sa.Column("submission_batch_id", sa.String(), nullable=True))
    op.add_column("submissions", sa.Column("preprocess_status", sa.String(), nullable=True))
    op.add_column("submissions", sa.Column("preprocess_error", sa.String(), nullable=True))
    op.create_index("ix_submissions_submission_batch_id", "submissions", ["submission_batch_id"])
    op.alter_column("submissions", "image_slots", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_submissions_submission_batch_id", table_name="submissions")
    op.drop_column("submissions", "preprocess_error")
    op.drop_column("submissions", "preprocess_status")
    op.drop_column("submissions", "submission_batch_id")
    op.drop_column("submissions", "image_slots")
