"""
Module 2 — Async Celery Ingestion Worker
Pipeline: GitHub clone → Tree-sitter AST chunk → Embed → Qdrant upsert → PostgreSQL update

Each repository ingestion is a single Celery task with retry + exponential backoff.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import structlog
from celery import Celery, Task, states
from celery.exceptions import Reject
from git import GitCommandError, InvalidGitRepositoryError, Repo
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import PointStruct
from qdrant_client.http.models import SparseVector
from sqlalchemy.ext.asyncio import AsyncSession

from backend.schema import (
    FileNode,
    Language,
    NodeType,
    Repository,
    RepoStatus,
    User,
    create_engine,
    create_session_factory,
)
from backend.vector_schema import (
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    CodeChunkPayload,
    create_repo_collection,
)
from backend.ast_chunker import ASTChunker, CodeChunk
from backend.query_service import EmbeddingService, BM25Indexer

log = structlog.get_logger(__name__)

# ─── Celery App ───────────────────────────────────────────────────────────────

REDIS_URL = os.environ["REDIS_URL"]          # e.g. redis://redis:6379/0
DATABASE_URL = os.environ["DATABASE_URL"]    # asyncpg URL

celery_app = Celery(
    "nexus_workers",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,                    # Ack only after task completes
    task_reject_on_worker_lost=True,        # Re-queue if worker dies mid-task
    worker_prefetch_multiplier=1,           # One task per worker at a time
    task_track_started=True,
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    task_soft_time_limit=600,              # 10 min soft limit
    task_time_limit=900,                   # 15 min hard kill
)

# ─── Supported file extensions ────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = frozenset({
    ".py", ".ts", ".tsx", ".js", ".jsx",
    ".go", ".rs", ".java",
})

MAX_FILE_SIZE_BYTES = 512 * 1024  # Skip files > 512 KB
UPSERT_BATCH_SIZE   = 64          # Qdrant batch upsert size

# ─── Base Task (handles DB + Qdrant clients lazily) ──────────────────────────

class NexusTask(Task):
    """
    Custom Celery base task that holds lazy singletons for DB and Qdrant.
    Avoids re-initialising connections on every task call.
    """
    _db_factory = None
    _qdrant: Optional[AsyncQdrantClient] = None
    _embedder: Optional[EmbeddingService] = None
    _chunker: Optional[ASTChunker] = None
    _bm25: Optional[BM25Indexer] = None

    @property
    def db_factory(self):
        if self._db_factory is None:
            engine = create_engine(DATABASE_URL)
            self._db_factory = create_session_factory(engine)
        return self._db_factory

    @property
    def qdrant(self) -> AsyncQdrantClient:
        if self._qdrant is None:
            self._qdrant = AsyncQdrantClient(
                url=os.environ["QDRANT_URL"],
                api_key=os.environ.get("QDRANT_API_KEY"),
                timeout=30,
            )
        return self._qdrant

    # Removed embedder property; EmbeddingService is instantiated per-task

    @property
    def chunker(self) -> ASTChunker:
        if self._chunker is None:
            self._chunker = ASTChunker()
        return self._chunker

    @property
    def bm25(self) -> BM25Indexer:
        if self._bm25 is None:
            self._bm25 = BM25Indexer()
        return self._bm25


# ─── Main Ingestion Task ──────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    base=NexusTask,
    name="nexus.ingest_repository",
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def ingest_repository(self: NexusTask, repository_id: str, decrypted_token: str) -> dict:
    """
    Full ingestion pipeline for a single repository.
    Called with: ingest_repository.delay(str(repo.id), decrypted_oauth_token)
    """
    return asyncio.get_event_loop().run_until_complete(
        _run_ingestion(self, repository_id, decrypted_token)
    )


async def _run_ingestion(
    task: NexusTask,
    repository_id: str,
    decrypted_token: str,
) -> dict:
    repo_uuid = uuid.UUID(repository_id)
    tmp_dir: Optional[str] = None

    async with task.db_factory() as session:
        repo: Optional[Repository] = await session.get(Repository, repo_uuid)
        if repo is None:
            raise Reject(f"Repository {repository_id} not found", requeue=False)

        user: Optional[User] = await session.get(User, repo.owner_id)
        api_key = None
        if user and user.openai_api_key_enc and user.openai_api_key_iv and user.openai_api_key_tag:
            from backend.security import TokenEncryptor
            encryptor = TokenEncryptor()
            api_key = encryptor.decrypt(user.openai_api_key_enc, user.openai_api_key_iv, user.openai_api_key_tag)

        embedder = EmbeddingService(api_key=api_key)

        try:
            # ── Phase 1: Update status → CLONING ──────────────────────────
            await _set_status(session, repo, RepoStatus.CLONING)

            clone_url = _build_clone_url(repo.full_name, decrypted_token)
            tmp_dir   = tempfile.mkdtemp(prefix="nexus_clone_")
            log.info("Cloning repository", repo=repo.full_name, dest=tmp_dir)

            git_repo = Repo.clone_from(
                clone_url,
                tmp_dir,
                depth=1,
                single_branch=True,
                branch=repo.default_branch,
                kill_after_timeout=120,
            )
            last_sha = git_repo.head.commit.hexsha
            repo.last_commit_sha = last_sha

            # ── Phase 2: Ensure Qdrant collection ─────────────────────────
            collection_name = f"repo_{repository_id.replace('-', '')}"
            repo.vector_collection = collection_name
            await session.flush()

            await create_repo_collection(
                client=task.qdrant,
                collection_name=collection_name,
                dense_dim=embedder.dense_dim,
            )

            # ── Phase 3: Parse + chunk all files ──────────────────────────
            await _set_status(session, repo, RepoStatus.PARSING)

            all_chunks: list[CodeChunk] = []
            file_paths = _collect_files(tmp_dir)
            repo.file_count = len(file_paths)

            for fp in file_paths:
                try:
                    source = Path(fp).read_text(encoding="utf-8", errors="replace")
                    relative = fp[len(tmp_dir) + 1:]
                    chunks   = task.chunker.chunk_file(relative, source)
                    all_chunks.extend(chunks)
                except Exception as exc:
                    log.warning("Failed to chunk file", file=fp, error=str(exc))

            repo.chunk_count  = len(all_chunks)
            repo.total_tokens = sum(c.token_count for c in all_chunks)
            await session.flush()

            # ── Phase 4: Embed + index ────────────────────────────────────
            await _set_status(session, repo, RepoStatus.EMBEDDING)

            file_node_rows = await _embed_and_index(
                task=task,
                session=session,
                embedder=embedder,
                chunks=all_chunks,
                collection_name=collection_name,
                repository_id=repository_id,
                repo_uuid=repo_uuid,
                last_sha=last_sha,
            )

            session.add_all(file_node_rows)

            # ── Phase 5: Mark READY ───────────────────────────────────────
            from datetime import datetime, timezone
            repo.status      = RepoStatus.READY
            repo.ingested_at = datetime.now(timezone.utc)
            await session.commit()

            log.info(
                "Ingestion complete",
                repo=repo.full_name,
                chunks=repo.chunk_count,
                tokens=repo.total_tokens,
            )
            return {
                "status": "ready",
                "repository_id": repository_id,
                "chunk_count": repo.chunk_count,
            }

        except GitCommandError as exc:
            await _set_status(session, repo, RepoStatus.FAILED, str(exc))
            await session.commit()
            raise

        except Exception as exc:
            await _set_status(session, repo, RepoStatus.FAILED, str(exc))
            await session.commit()
            raise

        finally:
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── Embed + index helper ─────────────────────────────────────────────────────

async def _embed_and_index(
    task: NexusTask,
    session: AsyncSession,
    embedder: EmbeddingService,
    chunks: list[CodeChunk],
    collection_name: str,
    repository_id: str,
    repo_uuid: uuid.UUID,
    last_sha: str,
) -> list[FileNode]:
    """
    For each batch of chunks:
    1. Compute dense embeddings via EmbeddingService.
    2. Compute sparse BM25 vectors via BM25Indexer.
    3. Upsert into Qdrant.
    4. Build FileNode ORM rows for PostgreSQL.
    """
    file_node_rows: list[FileNode] = []

    for batch_start in range(0, len(chunks), UPSERT_BATCH_SIZE):
        batch = chunks[batch_start:batch_start + UPSERT_BATCH_SIZE]
        texts = [c.raw_content for c in batch]

        dense_vectors = await embedder.embed_batch(texts)
        sparse_vectors = task.bm25.vectorize_batch(texts)

        points: list[PointStruct] = []

        for chunk, dense_vec, sparse_vec in zip(batch, dense_vectors, sparse_vectors):
            point_id = str(uuid.uuid4())
            payload  = CodeChunkPayload(
                point_id=point_id,
                file_node_id=point_id,           # will be set after SQL insert
                repository_id=repository_id,
                element_type=chunk.node_type,     # type: ignore[arg-type]
                language=chunk.language,           # type: ignore[arg-type]
                file_path=chunk.file_path,
                start_line=chunk.start_line,
                end_line=chunk.end_line,
                code_hash=chunk.code_hash,
                chunk_content=chunk.raw_content,
                name=chunk.name,
                parent_name=chunk.parent_name,
                imports=chunk.imports,
                inward_callers=chunk.inward_callers,
                outward_calls=chunk.outward_calls,
                token_count=chunk.token_count,
                embedding_model=embedder.model_name,
                embedding_dim=embedder.dense_dim,
                last_commit_sha=last_sha,
            )

            points.append(PointStruct(
                id=point_id,
                vector={
                    DENSE_VECTOR_NAME:  dense_vec,
                    SPARSE_VECTOR_NAME: SparseVector(
                        indices=sparse_vec["indices"],
                        values=sparse_vec["values"],
                    ),
                },
                payload=payload.to_qdrant_payload(),
            ))

            # Build ORM row
            file_node_rows.append(FileNode(
                id=uuid.UUID(point_id),
                repository_id=repo_uuid,
                file_path=chunk.file_path,
                language=Language(chunk.language if chunk.language in [l.value for l in Language] else "python"),
                node_type=NodeType(chunk.node_type if chunk.node_type in [n.value for n in NodeType] else "block"),
                name=chunk.name,
                parent_name=chunk.parent_name,
                start_line=chunk.start_line,
                end_line=chunk.end_line,
                raw_content=chunk.raw_content,
                token_count=chunk.token_count,
                code_hash=chunk.code_hash,
                imports={"items": chunk.imports},
                inward_callers={"items": chunk.inward_callers},
                outward_calls={"items": chunk.outward_calls},
                vector_point_id=uuid.UUID(point_id),
            ))

        await task.qdrant.upsert(
            collection_name=collection_name,
            points=points,
            wait=True,
        )
        log.debug("Upserted batch", size=len(batch), collection=collection_name)

    return file_node_rows


# ─── Utilities ────────────────────────────────────────────────────────────────

async def _set_status(
    session: AsyncSession,
    repo: Repository,
    status: RepoStatus,
    error: Optional[str] = None,
) -> None:
    repo.status = status
    if error:
        repo.error_message = error[:4096]
    await session.flush()


def _build_clone_url(full_name: str, token: str) -> str:
    return f"https://x-access-token:{token}@github.com/{full_name}.git"


def _collect_files(root: str) -> list[str]:
    """Walk directory, returning paths of parsable files under size limit."""
    results: list[str] = []
    skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fname in filenames:
            if Path(fname).suffix.lower() in SUPPORTED_EXTENSIONS:
                full = os.path.join(dirpath, fname)
                try:
                    if os.path.getsize(full) <= MAX_FILE_SIZE_BYTES:
                        results.append(full)
                except OSError:
                    pass
    return results
