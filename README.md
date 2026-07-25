# Git Visualizer (Nexus) — Enterprise Repository Context Engine

> **AST-powered ingestion · Hybrid RAG retrieval · 3D dependency visualisation**

Git Visualizer (formerly Nexus) lets you chat with any GitHub codebase. It ingests repositories via Tree-sitter AST chunking, indexes them into a hybrid vector store (dense + BM25 sparse), resolves dependency graphs at query time, and streams answers through a cloud or local LLM — all surfaced in a cinematic Next.js 14 dashboard with a live 3D force-directed dependency graph.

---

## Architecture at a glance

```text
GitHub Webhook / OAuth
        │
        ▼
  FastAPI Gateway  ──►  Redis (session · rate-limit · cache)
        │
        ▼
  Celery Workers
    ├── git clone
    ├── Tree-sitter AST chunking (Python · TypeScript · …)
    ├── Dense embed  (OpenAI text-embedding-3-small  OR  bge-small-en-v1.5)
    ├── Sparse BM25  (rank_bm25 → Qdrant named vector)
    └── Qdrant upsert + PostgreSQL FileNode insert
        │
        ▼
  Hybrid Search (dense cosine + BM25 RRF fusion)
        │
        ▼
  RAG Router (dependency graph expansion — inward callers + outward calls)
        │
        ▼
  Inference Engine
    ├── Cloud:  OpenAI GPT-4o  |  Anthropic claude-opus-4-6 (prompt cache)
    └── Local:  Ollama DeepSeek-Coder  (sliding context window)
        │
        ▼
  Next.js 14 Frontend
    ├── / — Cinematic landing (full-screen video, Framer Motion)
    └── /dashboard
          ├── Left:   File tree + instant search
          ├── Centre: Chat (SSE streaming) · Diff viewer (split before/after)
          └── Right:  3D force-graph (react-force-graph-3d)
                      Impact Analysis Mode (amber highlight on node click)
```

---

## Repository Structure

| Path | Description |
|---|---|
| `backend/schema.py` | SQLAlchemy 2.x async ORM |
| `backend/vector_schema.py` | Qdrant payload dataclass + collection factory |
| `backend/ast_chunker.py` | Tree-sitter chunker (Python + TypeScript) |
| `backend/ingestion_worker.py` | Celery ingestion pipeline |
| `backend/security.py` | AES-256-GCM encryption + Redis rate limiter |
| `backend/beat_schedule.py` | Periodic tasks (token purge, stale prune) |
| `backend/query_service.py` | Hybrid search + RAG router + inference |
| `backend/graph.py` | Graph API — nodes + directed dependency edges |
| `backend/main.py` | FastAPI app — all routes (auth, repos, query, tools) |
| `backend/observability.py` | Prometheus + structlog JSON middleware |
| `backend/alembic/` | Database migrations |
| `frontend/app/page.tsx` | Cinematic landing page |
| `frontend/app/dashboard/page.tsx` | Developer dashboard (3-pane layout) |
| `frontend/lib/api.ts` | Type-safe API client + SSE stream helpers |
| `frontend/lib/hooks.ts` | useStream, useRepos, useGraph, useDiff |
| `infra/prometheus.yml` | Prometheus scrape config |
| `docker-compose.yml` | All services orchestration |

---

## Quick Start

### Prerequisites
- Docker + Docker Compose v2
- Node 20+ (for local frontend dev)
- Python 3.11+ (for local backend dev)

### 1. Clone and Configure

```bash
git clone https://github.com/Vishwajeet2005/git-visualizer.git
cd git-visualizer
cp .env.example .env
# Edit .env — fill in all required values (see comments in file)
```

### 2. Generate the AES Key

```bash
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
# Paste output into .env → AES_SECRET_KEY
```

### 3. Create a GitHub OAuth App

- Go to: https://github.com/settings/developers → OAuth Apps → New OAuth App
- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:8000/api/auth/github/callback`
- Copy Client ID + Secret into `.env`

### 4. Run all services

```bash
docker-compose up --build
```

Services accessible at:
- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:8000/api/docs
- **Flower (Celery)**: http://localhost:5555
- **Grafana**: http://localhost:3001

### 5. Run Database Migrations

```bash
docker-compose exec api alembic upgrade head
```

---

## Local Development (Without Docker)

**Backend:**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# In a second terminal:
celery -A ingestion_worker.celery_app worker --loglevel=info
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

See `.env.example` for the full annotated list. Required keys include:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `REDIS_PASSWORD` | Redis AUTH password |
| `QDRANT_API_KEY` | Qdrant service key |
| `AES_SECRET_KEY` | Base64-encoded 32-byte AES key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `OPENAI_API_KEY` | OpenAI API key |

---

## Scaling & Security

- **Scaling:** Increase `deploy.replicas` for `worker` in `docker-compose.yml`. Switch `EMBED_PROVIDER=local` for air-gapped usage. Use `dense_dim=384` with `bge-small-en-v1.5` to reduce memory.
- **Security:** OAuth tokens encrypted at rest with AES-256-GCM. Session tokens use `httpOnly`, `Secure`, `SameSite=Strict`. Redis token-bucket rate limiting applies per user.

---

## License

MIT © 2025 Vishwajeet2005
