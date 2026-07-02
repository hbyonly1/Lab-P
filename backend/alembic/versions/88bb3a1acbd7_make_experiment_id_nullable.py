"""make_experiment_id_nullable

Revision ID: 88bb3a1acbd7
Revises: a9db03851265
Create Date: 2026-07-01 13:11:10.634579

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '88bb3a1acbd7'
down_revision: Union[str, Sequence[str], None] = 'a9db03851265'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('orders', 'experiment_id',
               existing_type=sa.VARCHAR(),
               nullable=True)
    op.execute("UPDATE orders SET experiment_id = NULL WHERE experiment_id = 'UPGRADE_PLAN'")
    op.execute("DELETE FROM experiments WHERE id = 'UPGRADE_PLAN'")
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('orders', 'experiment_id',
               existing_type=sa.VARCHAR(),
               nullable=False)
    op.execute("INSERT INTO experiments (id, title, version, config_json, mapping_json, created_at) VALUES ('UPGRADE_PLAN', '系统套餐升级', '1.0', '{}', '{}', NOW()) ON CONFLICT (id) DO NOTHING;")
    op.execute("UPDATE orders SET experiment_id = 'UPGRADE_PLAN' WHERE experiment_id IS NULL")
    # ### end Alembic commands ###
