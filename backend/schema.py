"""
Module 1 — PostgreSQL Schema (SQLAlchemy 2.x Async ORM)
Covers: Users, Repositories, FileNodes, GitCommits, UserConversations
All timestamps are UTC. Tokens are AES-256 encrypted at rest (see security.py).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, TSVECTOR
from pgvector.sqlalchemy import Vector
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

import enum


# ─── Base & Engine ────────────────────────────────────────────────────────────

class Base(AsyncAttrs, DeclarativeBase):
    pass


def create_engine(database_url: str):
    """
    Returns a production-configured async engine.
    Pool: 10 persistent + 20 overflow, 30-minute recycle.
    """
    return create_async_engine(
        database_url,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        echo=False,
    )


def create_session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


# ─── Enums ────────────────────────────────────────────────────────────────────

class RepoStatus(str, enum.Enum):
    PENDING    = "pending"
    CLONING    = "cloning"
    PARSING    = "parsing"
    EMBEDDING  = "embedding"
    READY      = "ready"
    FAILED     = "failed"


class NodeType(str, enum.Enum):
    FUNCTION   = "function"
    CLASS      = "class"
    METHOD     = "method"
    MODULE     = "module"
    BLOCK      = "block"


class Language(str, enum.Enum):
    PYTHON     = "python"
    TYPESCRIPT = "typescript"
    JAVASCRIPT = "javascript"
    GO         = "go"
    RUST       = "rust"
    JAVA       = "java"


class MessageRole(str, enum.Enum):
    USER       = "user"
    ASSISTANT  = "assistant"
    SYSTEM     = "system"


class InferenceProvider(str, enum.Enum):
    OPENAI     = "openai"
    ANTHROPIC  = "anthropic"
    OLLAMA     = "ollama"
    VLLM       = "vllm"


# ─── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    login: Mapped[str]     = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[Optional[str]]   = mapped_column(String(512), nullable=True)

    # AES-256-GCM encrypted OAuth token (see security.py)
    encrypted_token: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    token_iv: Mapped[Optional[bytes]]        = mapped_column(LargeBinary(16), nullable=True)
    token_tag: Mapped[Optional[bytes]]       = mapped_column(LargeBinary(16), nullable=True)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    session_token: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, unique=True, index=True)

    # BYOK: AES-256-GCM encrypted Groq API key
    groq_api_key_enc: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    groq_api_key_iv: Mapped[Optional[bytes]]  = mapped_column(LargeBinary(16), nullable=True)
    groq_api_key_tag: Mapped[Optional[bytes]] = mapped_column(LargeBinary(16), nullable=True)

    plan: Mapped[str] = mapped_column(String(32), default="free", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False
    )

    repositories: Mapped[List["Repository"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    conversations: Mapped[List["UserConversation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_users_github_id", "github_id"),
        Index("ix_users_login", "login"),
    )


# ─── Repositories ─────────────────────────────────────────────────────────────

class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    github_repo_id: Mapped[int]  = mapped_column(BigInteger, nullable=False)
    full_name: Mapped[str]       = mapped_column(String(256), nullable=False)
    default_branch: Mapped[str]  = mapped_column(String(128), default="main")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_private: Mapped[bool]     = mapped_column(Boolean, default=False)

    status: Mapped[RepoStatus] = mapped_column(
        Enum(RepoStatus), default=RepoStatus.PENDING, nullable=False
    )
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    error_message: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)

    # Ingestion statistics
    file_count: Mapped[int]     = mapped_column(Integer, default=0)
    chunk_count: Mapped[int]    = mapped_column(Integer, default=0)
    total_tokens: Mapped[int]   = mapped_column(BigInteger, default=0)
    last_commit_sha: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    # Qdrant collection name for this repo's vectors
    vector_collection: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    ingested_at: Mapped[Optional[datetime]]  = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False
    )

    owner: Mapped["User"] = relationship(back_populates="repositories")
    file_nodes: Mapped[List["FileNode"]] = relationship(
        back_populates="repository", cascade="all, delete-orphan"
    )
    commits: Mapped[List["GitCommit"]] = relationship(
        back_populates="repository", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "github_repo_id", name="uq_repo_owner_github"),
        Index("ix_repos_owner_id", "owner_id"),
        Index("ix_repos_status", "status"),
    )


# ─── FileNodes ────────────────────────────────────────────────────────────────

class FileNode(Base):
    """
    Represents a single parsed code element extracted by Tree-sitter.
    One row per function / class / block chunk.
    """
    __tablename__ = "file_nodes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )

    # Source location
    file_path: Mapped[str]   = mapped_column(String(1024), nullable=False)
    language: Mapped[Language] = mapped_column(Enum(Language), nullable=False)
    node_type: Mapped[NodeType] = mapped_column(Enum(NodeType), nullable=False)

    # Symbol info
    name: Mapped[str]       = mapped_column(String(256), nullable=False)
    parent_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int]   = mapped_column(Integer, nullable=False)

    # Content
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    code_hash: Mapped[str]   = mapped_column(String(64), nullable=False)

    # Dependency graph (stored as JSON for flexibility)
    imports: Mapped[Optional[dict]]       = mapped_column(JSONB, nullable=True)
    inward_callers: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    outward_calls: Mapped[Optional[dict]]  = mapped_column(JSONB, nullable=True)

    # Qdrant vector point ID (same UUID used in Qdrant payload)
    vector_point_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    repository: Mapped["Repository"] = relationship(back_populates="file_nodes")

    __table_args__ = (
        Index("ix_file_nodes_repo_id", "repository_id"),
        Index("ix_file_nodes_file_path", "file_path"),
        Index("ix_file_nodes_code_hash", "code_hash"),
        Index("ix_file_nodes_node_type", "node_type"),
    )


# ─── GitCommits ───────────────────────────────────────────────────────────────

class GitCommit(Base):
    __tablename__ = "git_commits"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    sha: Mapped[str]          = mapped_column(String(40), nullable=False)
    message: Mapped[str]      = mapped_column(Text, nullable=False)
    author_name: Mapped[str]  = mapped_column(String(256), nullable=False)
    author_email: Mapped[str] = mapped_column(String(320), nullable=False)
    committed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Files changed in this commit (list of paths)
    changed_files: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    repository: Mapped["Repository"] = relationship(back_populates="commits")

    __table_args__ = (
        UniqueConstraint("repository_id", "sha", name="uq_commit_repo_sha"),
        Index("ix_commits_repo_id", "repository_id"),
        Index("ix_commits_sha", "sha"),
    )


# ─── UserConversations ────────────────────────────────────────────────────────

class UserConversation(Base):
    __tablename__ = "user_conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    repository_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="SET NULL"), nullable=True
    )

    title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    provider: Mapped[InferenceProvider] = mapped_column(
        Enum(InferenceProvider), nullable=False
    )
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)

    # Full message history stored as JSONB array for efficient retrieval
    messages: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Metadata: token usage, latency, context file paths used
    usage_stats: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    context_file_paths: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="conversations")

    __table_args__ = (
        Index("ix_conversations_user_id", "user_id"),
        Index("ix_conversations_repo_id", "repository_id"),
        Index("ix_conversations_updated_at", "updated_at"),
    )

# ─── Vector DB Chunks ─────────────────────────────────────────────────────────

class VectorChunk(Base):
    """
    Replaces Qdrant. Stores code chunks with dense embeddings (pgvector)
    and sparse search capability (tsvector).
    """
    __tablename__ = "vector_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_node_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("file_nodes.id", ondelete="CASCADE"), index=True)
    repository_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), index=True)

    # Core attributes
    element_type: Mapped[str] = mapped_column(String(50), nullable=False) # function, class, etc.
    language: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)

    # Relationships (AST derived)
    inward_callers: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    outward_calls: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # Raw content and metrics
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding_dim: Mapped[int] = mapped_column(Integer, nullable=False)
    last_commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)

    # Vector representations
    dense_vector: Mapped[list[float]] = mapped_column(Vector(384), nullable=False)
    sparse_vector = mapped_column(TSVECTOR, nullable=True)

    # Relationships
    file_node: Mapped["FileNode"] = relationship("FileNode")
    repository: Mapped["Repository"] = relationship("Repository")

    __table_args__ = (
        Index("ix_vector_chunks_repo_id", "repository_id"),
        Index("ix_vector_chunks_file_id", "file_node_id"),
    )
