"""add checkout order items

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-07-07 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("order_type", sa.String(), nullable=False, server_default="one_click_batch"))
    op.add_column("orders", sa.Column("submission_batch_id", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("client_request_id", sa.String(), nullable=True))
    op.add_column(
        "orders",
        sa.Column(
            "pricing_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("ix_orders_submission_batch_id", "orders", ["submission_batch_id"])
    op.create_index("ix_orders_client_request_id", "orders", ["client_request_id"])
    op.alter_column("orders", "order_type", server_default=None)
    op.alter_column("orders", "pricing_snapshot", server_default=None)

    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.String(), nullable=False),
        sa.Column("submission_id", sa.String(), nullable=True),
        sa.Column("experiment_id", sa.String(), nullable=True),
        sa.Column("item_type", sa.String(), nullable=False, server_default="experiment_one_click"),
        sa.Column("unit_amount", sa.Float(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("total_amount", sa.Float(), nullable=False),
        sa.Column(
            "pricing_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"]),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_submission_id", "order_items", ["submission_id"])
    op.alter_column("order_items", "item_type", server_default=None)
    op.alter_column("order_items", "quantity", server_default=None)
    op.alter_column("order_items", "pricing_snapshot", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_order_items_submission_id", table_name="order_items")
    op.drop_index("ix_order_items_order_id", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("ix_orders_client_request_id", table_name="orders")
    op.drop_index("ix_orders_submission_batch_id", table_name="orders")
    op.drop_column("orders", "pricing_snapshot")
    op.drop_column("orders", "client_request_id")
    op.drop_column("orders", "submission_batch_id")
    op.drop_column("orders", "order_type")
