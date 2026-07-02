"""add experiment config timestamps

Revision ID: f72a8d93a4b6
Revises: e4c2d9a8b731
Create Date: 2026-07-02 21:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "f72a8d93a4b6"
down_revision: Union[str, Sequence[str], None] = "e4c2d9a8b731"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("experiments", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.add_column("experiments", sa.Column("config_file_mtime", sa.DateTime(), nullable=True))
    op.add_column("experiments", sa.Column("config_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.execute("UPDATE experiments SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL")
    op.alter_column("experiments", "updated_at", nullable=False)


def downgrade() -> None:
    op.drop_column("experiments", "config_hash")
    op.drop_column("experiments", "config_file_mtime")
    op.drop_column("experiments", "updated_at")
