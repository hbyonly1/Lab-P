"""add submission drafts

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-07 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "submission_drafts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submission_id", sa.String(), nullable=False),
        sa.Column("draft_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("image_paths", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("image_slots", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("local_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("submission_id", name="uq_submission_drafts_submission_id"),
    )
    op.create_index(op.f("ix_submission_drafts_submission_id"), "submission_drafts", ["submission_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_submission_drafts_submission_id"), table_name="submission_drafts")
    op.drop_table("submission_drafts")
