"""Initial schema — Users, Repositories, FileNodes, GitCommits, UserConversations

Revision ID: 001_initial
Revises:
Create Date: 2025-06-01 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users ──────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id",               postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("github_id",        sa.BigInteger(),  nullable=False, unique=True),
        sa.Column("login",            sa.String(64),    nullable=False, unique=True),
        sa.Column("email",            sa.String(320),   nullable=True),
        sa.Column("display_name",     sa.String(128),   nullable=True),
        sa.Column("avatar_url",       sa.String(512),   nullable=True),
        sa.Column("encrypted_token",  sa.LargeBinary(), nullable=True),
        sa.Column("token_iv",         sa.LargeBinary(16), nullable=True),
        sa.Column("token_tag",        sa.LargeBinary(16), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("plan",             sa.String(32),    nullable=False, server_default="free"),
        sa.Column("is_active",        sa.Boolean(),     nullable=False, server_default="true"),
        sa.Column("created_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_github_id", "users", ["github_id"])
    op.create_index("ix_users_login",     "users", ["login"])

    # ── repositories ──────────────────────────────────────────────────────
    op.create_table(
        "repositories",
        sa.Column("id",               postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id",         postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("github_repo_id",   sa.BigInteger(), nullable=False),
        sa.Column("full_name",        sa.String(256),  nullable=False),
        sa.Column("default_branch",   sa.String(128),  server_default="main"),
        sa.Column("description",      sa.Text(),       nullable=True),
        sa.Column("is_private",       sa.Boolean(),    server_default="false"),
        sa.Column("status",           sa.String(32),   nullable=False, server_default="pending"),
        sa.Column("celery_task_id",   sa.String(64),   nullable=True),
        sa.Column("error_message",    sa.Text(),       nullable=True),
        sa.Column("file_count",       sa.Integer(),    server_default="0"),
        sa.Column("chunk_count",      sa.Integer(),    server_default="0"),
        sa.Column("total_tokens",     sa.BigInteger(), server_default="0"),
        sa.Column("last_commit_sha",  sa.String(40),   nullable=True),
        sa.Column("vector_collection", sa.String(128), nullable=True),
        sa.Column("ingested_at",      sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("owner_id", "github_repo_id", name="uq_repo_owner_github"),
    )
    op.create_index("ix_repos_owner_id", "repositories", ["owner_id"])
    op.create_index("ix_repos_status",   "repositories", ["status"])

    # ── file_nodes ────────────────────────────────────────────────────────
    op.create_table(
        "file_nodes",
        sa.Column("id",              postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id",   postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_path",       sa.String(1024), nullable=False),
        sa.Column("language",        sa.String(32),   nullable=False),
        sa.Column("node_type",       sa.String(32),   nullable=False),
        sa.Column("name",            sa.String(256),  nullable=False),
        sa.Column("parent_name",     sa.String(256),  nullable=True),
        sa.Column("start_line",      sa.Integer(),    nullable=False),
        sa.Column("end_line",        sa.Integer(),    nullable=False),
        sa.Column("raw_content",     sa.Text(),       nullable=False),
        sa.Column("token_count",     sa.Integer(),    nullable=False),
        sa.Column("code_hash",       sa.String(64),   nullable=False),
        sa.Column("imports",         postgresql.JSONB(), nullable=True),
        sa.Column("inward_callers",  postgresql.JSONB(), nullable=True),
        sa.Column("outward_calls",   postgresql.JSONB(), nullable=True),
        sa.Column("vector_point_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_file_nodes_repo_id",   "file_nodes", ["repository_id"])
    op.create_index("ix_file_nodes_file_path", "file_nodes", ["file_path"])
    op.create_index("ix_file_nodes_code_hash", "file_nodes", ["code_hash"])
    op.create_index("ix_file_nodes_node_type", "file_nodes", ["node_type"])

    # ── git_commits ───────────────────────────────────────────────────────
    op.create_table(
        "git_commits",
        sa.Column("id",            postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sha",           sa.String(40),  nullable=False),
        sa.Column("message",       sa.Text(),      nullable=False),
        sa.Column("author_name",   sa.String(256), nullable=False),
        sa.Column("author_email",  sa.String(320), nullable=False),
        sa.Column("committed_at",  sa.DateTime(timezone=True), nullable=False),
        sa.Column("changed_files", postgresql.JSONB(), nullable=True),
        sa.Column("additions",     sa.Integer(), server_default="0"),
        sa.Column("deletions",     sa.Integer(), server_default="0"),
        sa.Column("created_at",    sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("repository_id", "sha", name="uq_commit_repo_sha"),
    )
    op.create_index("ix_commits_repo_id", "git_commits", ["repository_id"])
    op.create_index("ix_commits_sha",     "git_commits", ["sha"])

    # ── user_conversations ────────────────────────────────────────────────
    op.create_table(
        "user_conversations",
        sa.Column("id",                  postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id",             postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("repository_id",       postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("repositories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title",               sa.String(512), nullable=True),
        sa.Column("provider",            sa.String(32),  nullable=False),
        sa.Column("model_name",          sa.String(128), nullable=False),
        sa.Column("messages",            postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("usage_stats",         postgresql.JSONB(), nullable=True),
        sa.Column("context_file_paths",  postgresql.JSONB(), nullable=True),
        sa.Column("is_archived",         sa.Boolean(), server_default="false"),
        sa.Column("created_at",          sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",          sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_conversations_user_id",    "user_conversations", ["user_id"])
    op.create_index("ix_conversations_repo_id",    "user_conversations", ["repository_id"])
    op.create_index("ix_conversations_updated_at", "user_conversations", ["updated_at"])


def downgrade() -> None:
    op.drop_table("user_conversations")
    op.drop_table("git_commits")
    op.drop_table("file_nodes")
    op.drop_table("repositories")
    op.drop_table("users")
