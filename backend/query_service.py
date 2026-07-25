"""
Module 3 — Hybrid Search, RAG Router & Dual Inference Engine

Hybrid search: Dense cosine (text-embedding-3-small) + Sparse BM25 (Qdrant named vectors)
RAG Router:    Resolves dependency graphs (callers + callees) for structural context
Inference:     Cloud (OpenAI / Anthropic with prompt caching) + Local (Ollama / vLLM)
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import AsyncIterator, Literal, Optional

import httpx
import openai
import structlog
from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Filter,
    FieldCondition,
    MatchValue,
    FusionQuery,
    NearestQuery,
    Prefetch,
    Query,
    SearchParams,
    SparseVector,
)
from sentence_transformers import SentenceTransformer  # local fallback

from backend.models.vector_schema import (
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    CodeChunkPayload,
)
from backend.workers.bm25_index import BM25Indexer

log = structlog.get_logger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

OPENAI_MODEL         = os.environ.get("OPENAI_MODEL", "gpt-4o")
ANTHROPIC_MODEL      = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6")
OLLAMA_BASE_URL      = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL         = os.environ.get("OLLAMA_MODEL", "deepseek-coder:6.7b")
LOCAL_EMBED_MODEL    = os.environ.get("LOCAL_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
OPENAI_EMBED_MODEL   = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")

HYBRID_TOP_K         = 20          # candidates retrieved before reranking
FINAL_TOP_K          = 8           # results returned to inference context
DEPENDENCY_DEPTH     = 2           # hops for dependency graph expansion
MAX_CONTEXT_TOKENS   = 8192        # max tokens in inference context window
OLLAMA_CTX_TOKENS    = 4096        # Ollama sliding context budget


# ─── Embedding Service ────────────────────────────────────────────────────────

class EmbeddingService:
    """
    Dual-mode embedder:
      - Cloud: OpenAI text-embedding-3-small (1536-dim)
      - Local: bge-small-en-v1.5 via SentenceTransformers (384-dim)
    Selects based on EMBED_PROVIDER env var.
    """

    def __init__(self) -> None:
        self._provider = os.environ.get("EMBED_PROVIDER", "openai")
        if self._provider == "openai":
            self._client   = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            self.model_name = OPENAI_EMBED_MODEL
            self.dense_dim  = 1536
        else:
            self._local    = SentenceTransformer(LOCAL_EMBED_MODEL)
            self.model_name = LOCAL_EMBED_MODEL
            self.dense_dim  = 384

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if self._provider == "openai":
            response = await self._client.embeddings.create(
                input=texts,
                model=self.model_name,
                dimensions=self.dense_dim,
            )
            return [item.embedding for item in response.data]
        else:
            loop = asyncio.get_event_loop()
            vectors = await loop.run_in_executor(
                None, lambda: self._local.encode(texts, normalize_embeddings=True).tolist()
            )
            return vectors

    async def embed_single(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]


# ─── BM25 Sparse Indexer ──────────────────────────────────────────────────────

class BM25Indexer:
    """
    Wraps rank_bm25 to produce Qdrant-compatible sparse vectors.
    Each document is tokenized; the output is {indices, values} for named vector upsert.
    """

    def __init__(self) -> None:
        from rank_bm25 import BM25Okapi
        import re
        self._re = re.compile(r"\w+")
        self._BM25 = BM25Okapi

    def _tokenize(self, text: str) -> list[str]:
        return self._re.findall(text.lower())

    def vectorize_batch(self, texts: list[str]) -> list[dict]:
        """Return list of {indices: [...], values: [...]} sparse dicts."""
        corpus = [self._tokenize(t) for t in texts]
        bm25   = self._BM25(corpus)
        results = []
        for tokens in corpus:
            scores = bm25.get_scores(tokens)
            non_zero = [(i, float(s)) for i, s in enumerate(scores) if s > 0]
            if non_zero:
                idxs, vals = zip(*non_zero)
            else:
                idxs, vals = [], []
            results.append({"indices": list(idxs), "values": list(vals)})
        return results

    def vectorize_query(self, query: str, vocab_size: int) -> dict:
        tokens = self._tokenize(query)
        scores = {}
        for i, tok in enumerate(tokens):
            scores[i % vocab_size] = scores.get(i % vocab_size, 0.0) + 1.0
        return {
            "indices": list(scores.keys()),
            "values":  list(scores.values()),
        }


# ─── Hybrid Search Service ────────────────────────────────────────────────────

@dataclass
class SearchResult:
    point_id: str
    score: float
    payload: CodeChunkPayload


class HybridSearchService:
    """
    Combines dense cosine search and BM25 sparse search using Qdrant's
    native Reciprocal Rank Fusion (RRF) to merge ranked lists.
    """

    def __init__(
        self,
        qdrant: AsyncQdrantClient,
        embedder: EmbeddingService,
        bm25: BM25Indexer,
    ) -> None:
        self._qdrant   = qdrant
        self._embedder = embedder
        self._bm25     = bm25

    async def search(
        self,
        query: str,
        collection_name: str,
        repository_id: str,
        top_k: int = HYBRID_TOP_K,
        filter_language: Optional[str] = None,
        filter_node_type: Optional[str] = None,
    ) -> list[SearchResult]:
        """
        Hybrid retrieval:
        1. Dense prefetch with cosine similarity
        2. Sparse prefetch with BM25
        3. RRF fusion via Qdrant Query API
        4. Optional payload filter by language / node_type
        """
        dense_vec  = await self._embedder.embed_single(query)
        sparse_vec = self._bm25.vectorize_query(query, vocab_size=30000)

        must_conditions = [
            FieldCondition(key="repository_id", match=MatchValue(value=repository_id))
        ]
        if filter_language:
            must_conditions.append(
                FieldCondition(key="language", match=MatchValue(value=filter_language))
            )
        if filter_node_type:
            must_conditions.append(
                FieldCondition(key="element_type", match=MatchValue(value=filter_node_type))
            )

        qdrant_filter = Filter(must=must_conditions)

        response = await self._qdrant.query_points(
            collection_name=collection_name,
            prefetch=[
                Prefetch(
                    query=dense_vec,
                    using=DENSE_VECTOR_NAME,
                    filter=qdrant_filter,
                    limit=top_k * 2,
                ),
                Prefetch(
                    query=SparseVector(
                        indices=sparse_vec["indices"],
                        values=sparse_vec["values"],
                    ),
                    using=SPARSE_VECTOR_NAME,
                    filter=qdrant_filter,
                    limit=top_k * 2,
                ),
            ],
            query=FusionQuery(fusion="rrf"),
            limit=top_k,
            with_payload=True,
        )

        results = []
        for point in response.points:
            if point.payload:
                results.append(SearchResult(
                    point_id=str(point.id),
                    score=point.score,
                    payload=CodeChunkPayload.from_qdrant_payload(point.payload),
                ))
        return results


# ─── RAG Router (dependency graph expansion) ──────────────────────────────────

class RAGRouter:
    """
    Structural dependency retrieval:
    Given a set of initial search results, expand context by fetching
    upstream callers and downstream callees from Qdrant payload.
    """

    def __init__(
        self,
        qdrant: AsyncQdrantClient,
        search_service: HybridSearchService,
    ) -> None:
        self._qdrant  = qdrant
        self._search  = search_service

    async def expand_context(
        self,
        query: str,
        initial_results: list[SearchResult],
        collection_name: str,
        repository_id: str,
        depth: int = DEPENDENCY_DEPTH,
    ) -> list[SearchResult]:
        """
        For each initial result:
        - Collect outward_calls (downstream dependencies)
        - Collect inward_callers (upstream dependents)
        - Hybrid-search for each by symbol name to retrieve their chunks
        Returns deduplicated list with initial results prioritised.
        """
        seen_ids:  set[str]         = {r.point_id for r in initial_results}
        expanded:  list[SearchResult] = list(initial_results)

        for _ in range(depth):
            expansion_queries: list[str] = []
            for result in expanded[:FINAL_TOP_K]:
                expansion_queries.extend(result.payload.outward_calls[:3])
                expansion_queries.extend(result.payload.inward_callers[:3])

            if not expansion_queries:
                break

            fetch_tasks = [
                self._search.search(
                    query=sym_name,
                    collection_name=collection_name,
                    repository_id=repository_id,
                    top_k=3,
                )
                for sym_name in set(expansion_queries)
            ]

            batch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
            for res_list in batch_results:
                if isinstance(res_list, Exception):
                    continue
                for r in res_list:
                    if r.point_id not in seen_ids:
                        seen_ids.add(r.point_id)
                        expanded.append(r)

        return expanded[:HYBRID_TOP_K]

    def build_context_window(
        self,
        results: list[SearchResult],
        max_tokens: int = MAX_CONTEXT_TOKENS,
    ) -> str:
        """
        Assemble ordered code context string from search results.
        Truncates at token budget, keeping highest-scored results first.
        """
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        parts: list[str] = []
        total = 0

        for r in sorted(results, key=lambda x: x.score, reverse=True):
            header = (
                f"### {r.payload.file_path}:{r.payload.start_line}-{r.payload.end_line} "
                f"[{r.payload.element_type}: {r.payload.name}]\n"
            )
            block  = header + r.payload.chunk_content + "\n\n"
            tokens = len(enc.encode(block))
            if total + tokens > max_tokens:
                break
            parts.append(block)
            total += tokens

        return "".join(parts)


# ─── Inference Layer ──────────────────────────────────────────────────────────

InferenceProvider = Literal["openai", "anthropic", "ollama"]


@dataclass
class InferenceRequest:
    system_prompt: str
    user_message: str
    code_context: str
    provider: InferenceProvider = "openai"
    temperature: float = 0.2
    max_tokens: int = 2048


class InferenceEngine:
    """
    Dual-path inference:
      - Cloud path (OpenAI / Anthropic): full context, prompt caching headers.
      - Local path (Ollama): sliding context window to fit within ctx budget.
    """

    def __init__(self) -> None:
        self._openai = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        self._http   = httpx.AsyncClient(timeout=120.0)

    async def stream(
        self,
        request: InferenceRequest,
    ) -> AsyncIterator[str]:
        if request.provider == "openai":
            async for token in self._stream_openai(request):
                yield token
        elif request.provider == "anthropic":
            async for token in self._stream_anthropic(request):
                yield token
        elif request.provider == "ollama":
            async for token in self._stream_ollama(request):
                yield token
        else:
            raise ValueError(f"Unknown provider: {request.provider}")

    # ── OpenAI streaming ─────────────────────────────────────────────────────

    async def _stream_openai(self, req: InferenceRequest) -> AsyncIterator[str]:
        messages = [
            {"role": "system", "content": req.system_prompt},
            {"role": "user",   "content": f"<code_context>\n{req.code_context}\n</code_context>\n\n{req.user_message}"},
        ]

        stream = await self._openai.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            stream=True,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    # ── Anthropic streaming (with prompt caching) ─────────────────────────────

    async def _stream_anthropic(self, req: InferenceRequest) -> AsyncIterator[str]:
        """
        Uses Anthropic Messages API directly with cache_control breakpoints.
        The system prompt and code context are marked as ephemeral cache blocks
        so repeated queries over the same repository incur minimal cost.
        """
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

        system_blocks = [
            {
                "type": "text",
                "text": req.system_prompt,
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": f"<code_context>\n{req.code_context}\n</code_context>",
                "cache_control": {"type": "ephemeral"},
            },
        ]

        async with client.messages.stream(
            model=ANTHROPIC_MODEL,
            max_tokens=req.max_tokens,
            system=system_blocks,
            messages=[{"role": "user", "content": req.user_message}],
            temperature=req.temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    # ── Ollama (local SLM) with sliding context ───────────────────────────────

    async def _stream_ollama(self, req: InferenceRequest) -> AsyncIterator[str]:
        """
        Sends to Ollama /api/chat with sliding context optimization.
        If the combined prompt exceeds OLLAMA_CTX_TOKENS, the code context
        is truncated from the bottom to fit the budget.
        """
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")

        system_tokens  = len(enc.encode(req.system_prompt))
        user_tokens    = len(enc.encode(req.user_message))
        budget         = OLLAMA_CTX_TOKENS - system_tokens - user_tokens - 256

        # Trim code context to fit
        ctx_lines = req.code_context.split("\n")
        while budget > 0 and ctx_lines:
            trimmed_ctx = "\n".join(ctx_lines)
            if len(enc.encode(trimmed_ctx)) <= budget:
                break
            ctx_lines = ctx_lines[:-10]

        full_user = f"<code_context>\n{chr(10).join(ctx_lines)}\n</code_context>\n\n{req.user_message}"

        payload = {
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": req.system_prompt},
                {"role": "user",   "content": full_user},
            ],
            "stream": True,
            "options": {
                "temperature": req.temperature,
                "num_ctx": OLLAMA_CTX_TOKENS,
                "num_predict": req.max_tokens,
            },
        }

        async with self._http.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                import json
                try:
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue

    async def aclose(self) -> None:
        await self._http.aclose()


# ─── Integrated Query Service (search → route → infer) ────────────────────────

class QueryService:
    """
    High-level API used by FastAPI route handlers.
    Combines hybrid search → dependency expansion → context assembly → inference.
    """

    def __init__(self) -> None:
        self._embedder = EmbeddingService()
        self._bm25     = BM25Indexer()
        self._qdrant   = AsyncQdrantClient(
            url=os.environ["QDRANT_URL"],
            api_key=os.environ.get("QDRANT_API_KEY"),
        )
        self._search  = HybridSearchService(self._qdrant, self._embedder, self._bm25)
        self._router  = RAGRouter(self._qdrant, self._search)
        self._engine  = InferenceEngine()

    async def query(
        self,
        question: str,
        collection_name: str,
        repository_id: str,
        provider: InferenceProvider = "openai",
        system_prompt: Optional[str] = None,
    ) -> AsyncIterator[str]:
        sp = system_prompt or (
            "You are a senior software engineer. "
            "Answer questions about the codebase using only the provided context. "
            "Cite file paths and line numbers when referencing specific code. "
            "Be precise and technical."
        )

        # 1. Retrieve initial candidates
        initial = await self._search.search(
            query=question,
            collection_name=collection_name,
            repository_id=repository_id,
            top_k=HYBRID_TOP_K,
        )

        # 2. Expand with dependency graph
        expanded = await self._router.expand_context(
            query=question,
            initial_results=initial,
            collection_name=collection_name,
            repository_id=repository_id,
        )

        # 3. Assemble context string
        context = self._router.build_context_window(expanded)

        # 4. Stream inference
        req = InferenceRequest(
            system_prompt=sp,
            user_message=question,
            code_context=context,
            provider=provider,
        )
        return self._engine.stream(req)

    async def aclose(self) -> None:
        await self._qdrant.close()
        await self._engine.aclose()
