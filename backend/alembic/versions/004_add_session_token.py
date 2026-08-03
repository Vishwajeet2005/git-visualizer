"""add session_token

Revision ID: 004_add_session_token
Revises: 003_add_pgvector_chunks
Create Date: 2026-08-03 20:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "004_add_session_token"
down_revision = "003_add_pgvector_chunks"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("users", sa.Column("session_token", sa.String(length=128), nullable=True))
    op.create_index(op.f("ix_users_session_token"), "users", ["session_token"], unique=True)

def downgrade() -> None:
    op.drop_index(op.f("ix_users_session_token"), table_name="users")
    op.drop_column("users", "session_token")
