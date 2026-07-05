"""rework ai_config as non-secret profiles

Revision ID: 7d8e9f101112
Revises: 6c7d8e9f1011
Create Date: 2026-07-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "7d8e9f101112"
down_revision: Union[str, Sequence[str], None] = "6c7d8e9f1011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("ai_config")
    op.create_table(
        "ai_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("base_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("default_model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("default_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("default_temperature", sa.Float(), nullable=False),
        sa.Column("default_max_images_per_task", sa.Integer(), nullable=False),
        sa.Column("auto_recognize", sa.Boolean(), nullable=False),
        sa.Column("image_recognition_model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("image_recognition_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("image_recognition_temperature", sa.Float(), nullable=False),
        sa.Column("image_recognition_max_images_per_task", sa.Integer(), nullable=False),
        sa.Column("answer_generation_model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("answer_generation_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("answer_generation_temperature", sa.Float(), nullable=False),
        sa.Column("captcha_model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("captcha_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("captcha_temperature", sa.Float(), nullable=False),
        sa.Column("captcha_prompt", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ai_config")
    op.create_table(
        "ai_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("fallback_model", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("api_key_encrypted", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("max_images_per_task", sa.Integer(), nullable=False),
        sa.Column("max_concurrent_tasks", sa.Integer(), nullable=False),
        sa.Column("auto_recognize", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
