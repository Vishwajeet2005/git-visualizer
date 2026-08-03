"""rename to groq keys

Revision ID: 005_rename_to_groq_keys
Revises: 004_add_session_token
Create Date: 2026-08-03 20:55:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "005_rename_to_groq_keys"
down_revision = "004_add_session_token"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.alter_column("users", "openai_api_key_enc", new_column_name="groq_api_key_enc")
    op.alter_column("users", "openai_api_key_iv", new_column_name="groq_api_key_iv")
    op.alter_column("users", "openai_api_key_tag", new_column_name="groq_api_key_tag")
    op.execute("ALTER TABLE vector_chunks ALTER COLUMN dense_vector TYPE vector(384);")

def downgrade() -> None:
    op.alter_column("users", "groq_api_key_tag", new_column_name="openai_api_key_tag")
    op.alter_column("users", "groq_api_key_iv", new_column_name="openai_api_key_iv")
    op.alter_column("users", "groq_api_key_enc", new_column_name="openai_api_key_enc")
