"""
Module 1 — Qdrant Vector DB Payload Schema & Collection Management

Vector payload contains all metadata required for filtered search,
dependency graph resolution, and source attribution without joining SQL.

Dense vector: 1536-dim (text-embedding-3-small) or 384-dim (bge-small-en-v1.5)
Sparse vector: BM25 via Qdrant Named Vectors for hybrid search
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Literal, Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Distance,
    HnswConfigDiff,
    OptimizersConfigDiff,
    PayloadSchemaType,
    ScalarQuantizationConfig,
    ScalarType,
    SparseIndexParams,
    SparseVectorParams,
    VectorParams,
    VectorsConfig,
)


# ─── Payload Dataclass ────────────────────────────────────────────────────────

@dataclass
class CodeChunkPayload:
    """
    Structured payload stored alongside each vector point in Qdrant.
    All fields are indexed for efficient filtered retrieval.
    """
    # Identity
    point_id: str                  # UUID string matching FileNode.vector_point_id
    file_node_id: str              # UUID of the PostgreSQL FileNode row
    repository_id: str             # UUID of the parent Repository

    # Code element classification
    element_type: Literal[
        "function", "class", "method", "module", "block"
    ]
    language: Literal[
        "python", "typescript", "javascript", "go", "rust", "java"
    ]

    # Source location
    file_path: str
    start_line: int
    end_line: int

    # Content fingerprint
    code_hash: str                 # SHA-256 of raw_content for dedup / change detection
    chunk_content: str             # Full raw source text of the code element

    # Symbol info
    name: str
    parent_name: Optional[str]     # Enclosing class name if this is a method

    # Dependency graph (inlined for zero-join retrieval)
    imports: list[str]             # module-level imports used by this node
    inward_callers: list[str]      # names of symbols that call this element
    outward_calls: list[str]       # names of symbols this element calls

    # Embedding metadata
    token_count: int
    embedding_model: str           # e.g. "text-embedding-3-small"
    embedding_dim: int             # 1536 or 384

    # Optional: git provenance
    last_commit_sha: Optional[str] = None
    committed_at: Optional[str]    = None  # ISO-8601

    def to_qdrant_payload(self) -> dict:
        """Serialize to Qdrant-compatible flat dict (no nested objects)."""
        return {
            "point_id":        self.point_id,
            "file_node_id":    self.file_node_id,
            "repository_id":   self.repository_id,
            "element_type":    self.element_type,
            "language":        self.language,
            "file_path":       self.file_path,
            "start_line":      self.start_line,
            "end_line":        self.end_line,
            "code_hash":       self.code_hash,
            "chunk_content":   self.chunk_content,
            "name":            self.name,
            "parent_name":     self.parent_name,
            "imports":         self.imports,
            "inward_callers":  self.inward_callers,
            "outward_calls":   self.outward_calls,
            "token_count":     self.token_count,
            "embedding_model": self.embedding_model,
            "embedding_dim":   self.embedding_dim,
            "last_commit_sha": self.last_commit_sha,
            "committed_at":    self.committed_at,
        }

    @classmethod
    def from_qdrant_payload(cls, payload: dict) -> "CodeChunkPayload":
        return cls(**{k: payload.get(k) for k in cls.__dataclass_fields__})


# ─── Collection Factory ────────────────────────────────────────────────────────

DENSE_VECTOR_NAME  = "dense"
SPARSE_VECTOR_NAME = "sparse"

COLLECTION_CONFIG = {
    "dense_dim_openai": 1536,
    "dense_dim_local":  384,
    "distance":         Distance.COSINE,
}


async def create_repo_collection(
    client: AsyncQdrantClient,
    collection_name: str,
    dense_dim: int = 1536,
    use_scalar_quantization: bool = True,
) -> None:
    """
    Create a Qdrant collection for a single repository with:
    - Named dense vector (cosine, HNSW)
    - Named sparse vector (BM25)
    - Scalar quantization for memory efficiency
    - Payload indexes on all filterable fields
    """
    existing = await client.get_collections()
    if collection_name in {c.name for c in existing.collections}:
        return

    vectors_config = VectorsConfig(
        vectors={
            DENSE_VECTOR_NAME: VectorParams(
                size=dense_dim,
                distance=Distance.COSINE,
                hnsw_config=HnswConfigDiff(
                    m=16,
                    ef_construct=200,
                    full_scan_threshold=10_000,
                ),
                quantization_config=ScalarQuantizationConfig(
                    scalar=ScalarType.INT8,
                    quantile=0.99,
                    always_ram=True,
                ) if use_scalar_quantization else None,
            )
        }
    )

    sparse_vectors_config = {
        SPARSE_VECTOR_NAME: SparseVectorParams(
            index=SparseIndexParams(on_disk=False)
        )
    }

    await client.create_collection(
        collection_name=collection_name,
        vectors_config=vectors_config,
        sparse_vectors_config=sparse_vectors_config,
        optimizers_config=OptimizersConfigDiff(
            default_segment_number=4,
            indexing_threshold=20_000,
        ),
    )

    # Create payload indexes for all filterable fields
    payload_indexes: list[tuple[str, PayloadSchemaType]] = [
        ("repository_id",  PayloadSchemaType.KEYWORD),
        ("element_type",   PayloadSchemaType.KEYWORD),
        ("language",       PayloadSchemaType.KEYWORD),
        ("file_path",      PayloadSchemaType.KEYWORD),
        ("name",           PayloadSchemaType.KEYWORD),
        ("parent_name",    PayloadSchemaType.KEYWORD),
        ("start_line",     PayloadSchemaType.INTEGER),
        ("end_line",       PayloadSchemaType.INTEGER),
        ("token_count",    PayloadSchemaType.INTEGER),
        ("code_hash",      PayloadSchemaType.KEYWORD),
    ]

    for field_name, field_type in payload_indexes:
        await client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=field_type,
        )


async def delete_repo_collection(
    client: AsyncQdrantClient,
    collection_name: str,
) -> None:
    """Remove a repository's vector collection entirely (e.g. on repo delete)."""
    try:
        await client.delete_collection(collection_name)
    except Exception:
        pass  # Already deleted or never created
