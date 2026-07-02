"""add identity and automation foundation

Revision ID: 9f2a7c6d4b10
Revises: 0628eb01b92b
Create Date: 2026-07-02 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9f2a7c6d4b10'
down_revision: Union[str, Sequence[str], None] = '0628eb01b92b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('student_no', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('users', sa.Column('real_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.create_index(op.f('ix_users_student_no'), 'users', ['student_no'], unique=True)

    op.create_table(
        'automation_engine_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('config_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('schema_version', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_automation_engine_configs_name'), 'automation_engine_configs', ['name'], unique=True)

    op.create_table(
        'automation_jobs',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('submission_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('experiment_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('actor_user_id', sa.Integer(), nullable=True),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=False),
        sa.Column('request_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('result_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error_code', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('error_message', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('screenshot_keys', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['experiment_id'], ['experiments.id']),
        sa.ForeignKeyConstraint(['submission_id'], ['submissions.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'submission_versions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('submission_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('snapshot_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('school_snapshot_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.ForeignKeyConstraint(['submission_id'], ['submissions.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_submission_versions_submission_id'), 'submission_versions', ['submission_id'], unique=False)

    op.create_table(
        'school_sync_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('submission_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('experiment_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('snapshot_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('summary_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.Column('automation_job_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['automation_job_id'], ['automation_jobs.id']),
        sa.ForeignKeyConstraint(['experiment_id'], ['experiments.id']),
        sa.ForeignKeyConstraint(['submission_id'], ['submissions.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_school_sync_snapshots_submission_id'), 'school_sync_snapshots', ['submission_id'], unique=False)
    op.create_index(op.f('ix_school_sync_snapshots_user_id'), 'school_sync_snapshots', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_school_sync_snapshots_user_id'), table_name='school_sync_snapshots')
    op.drop_index(op.f('ix_school_sync_snapshots_submission_id'), table_name='school_sync_snapshots')
    op.drop_table('school_sync_snapshots')

    op.drop_index(op.f('ix_submission_versions_submission_id'), table_name='submission_versions')
    op.drop_table('submission_versions')

    op.drop_table('automation_jobs')

    op.drop_index(op.f('ix_automation_engine_configs_name'), table_name='automation_engine_configs')
    op.drop_table('automation_engine_configs')

    op.drop_index(op.f('ix_users_student_no'), table_name='users')
    op.drop_column('users', 'real_name')
    op.drop_column('users', 'student_no')
