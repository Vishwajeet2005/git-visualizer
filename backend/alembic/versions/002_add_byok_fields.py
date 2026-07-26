"""Add BYOK fields

Revision ID: 002_add_byok_fields
Revises: 001_initial
Create Date: 2026-07-26 14:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "002_add_byok_fields"
down_revision = "001_initial"

def upgrade() -> None:
    op.add_column("users", sa.Column("openai_api_key_enc", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("openai_api_key_iv", sa.LargeBinary(length=16), nullable=True))
    op.add_column("users", sa.Column("openai_api_key_tag", sa.LargeBinary(length=16), nullable=True))

def downgrade() -> None:
    op.drop_column("users", "openai_api_key_tag")
    op.drop_column("users", "openai_api_key_iv")
    op.drop_column("users", "openai_api_key_enc")

