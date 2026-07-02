"""add generation_data_nodes

Revision ID: bd316b60d165
Revises: c8ce0acca9cc
Create Date: 2026-07-01 22:16:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision = 'bd316b60d165'
down_revision = 'c8ce0acca9cc'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('ai_prompt_templates', sa.Column('generation_data_nodes', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

def downgrade() -> None:
    op.drop_column('ai_prompt_templates', 'generation_data_nodes')
