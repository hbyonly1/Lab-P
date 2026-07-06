"""add_encrypted_school_password

Revision ID: b9f1e2c3d4a5
Revises: 7d8e9f101112
Create Date: 2026-07-06 03:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "b9f1e2c3d4a5"
down_revision: Union[str, Sequence[str], None] = "7d8e9f101112"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("encrypted_school_password", sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "encrypted_school_password")
