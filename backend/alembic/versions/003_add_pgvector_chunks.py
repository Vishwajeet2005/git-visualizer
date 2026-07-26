"""add pgvector chunks

Revision ID: 003_add_pgvector_chunks
Revises: 002_add_byok_fields
Create Date: 2026-07-26 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import pgvector
from pgvector.sqlalchemy import Vector

revision = "003_add_pgvector_chunks"
down_revision = "002_add_byok_fields"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # 1. Ensure the vector extension is created in the database.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # 2. Create the vector_chunks table.
    op.create_table("vector_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("repository_id", postgresql.UUID(as_uuid=True), nullable=False),
        
        sa.Column("element_type", sa.String(length=50), nullable=False),
        sa.Column("language", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        
        sa.Column("inward_callers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outward_calls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        
        sa.Column("raw_content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("embedding_model", sa.String(length=100), nullable=False),
        sa.Column("embedding_dim", sa.Integer(), nullable=False),
        sa.Column("last_commit_sha", sa.String(length=40), nullable=False),
        
        sa.Column("dense_vector", Vector(dim=1536), nullable=False),
        sa.Column("sparse_vector", postgresql.TSVECTOR(), nullable=True),
        
        sa.ForeignKeyConstraint(["file_node_id"], ["file_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["repository_id"], ["repositories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id")
    )
    
    op.create_index("ix_vector_chunks_repo_id", "vector_chunks", ["repository_id"], unique=False)
    op.create_index("ix_vector_chunks_file_id", "vector_chunks", ["file_node_id"], unique=False)

def downgrade() -> None:
    op.drop_index("ix_vector_chunks_file_id", table_name="vector_chunks")
    op.drop_index("ix_vector_chunks_repo_id", table_name="vector_chunks")
    op.drop_table("vector_chunks")

