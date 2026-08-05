"""
Module 3 — FastAPI Application
Routes: GitHub OAuth, repo management, ingestion trigger,
        streaming query, test generation, diff/refactor preview.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx
import structlog
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.schema import (
    Repository,
    RepoStatus,
    User,
    UserConversation,
    create_engine,
    create_session_factory,
)
from backend.query_service import QueryService, InferenceProvider
from fastapi import BackgroundTasks
from backend.ingestion_service import ingest_repository
from backend.security import CredentialPurgeService, RateLimiter, TokenEncryptor

log = structlog.get_logger(__name__)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
GITHUB_CLIENT_ID     = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")
raw_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus")
if raw_url.startswith("postgres://"):
    raw_url = raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif raw_url.startswith("postgresql://"):
    raw_url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
DATABASE_URL = raw_url


# ─── App Lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    engine     = create_engine(DATABASE_URL)
    db_factory = create_session_factory(engine)
    encryptor  = TokenEncryptor()
    limiter    = RateLimiter()

    app.state.db_factory = db_factory
    app.state.encryptor  = encryptor
    app.state.limiter    = limiter

    yield


    await engine.dispose()


# ─── App Instance ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="Nexus Repository Context Engine",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    import logging
    logging.error(f"Unhandled exception: {exc}", exc_info=True)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.graph import router as graph_router
app.include_router(graph_router)


# ─── Dependencies ─────────────────────────────────────────────────────────────

async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db_factory() as session:
        yield session


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User:
    auth_header = request.headers.get("Authorization")
    session_token = None
    if auth_header and auth_header.startswith("Bearer "):
        session_token = auth_header[7:]
    else:
        session_token = request.cookies.get("nexus_session")
        
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    stmt = select(User).where(User.session_token == session_token)
    user = (await db.execute(stmt)).scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Session expired or user deactivated.")
    return user


def get_user_groq_key(user: User) -> Optional[str]:
    """Decrypt the user's Groq API key if present."""
    if not user.groq_api_key_enc or not user.groq_api_key_iv or not user.groq_api_key_tag:
        return None
    encryptor = TokenEncryptor()
    return encryptor.decrypt(user.groq_api_key_enc, user.groq_api_key_iv, user.groq_api_key_tag)

async def rate_limit(
    request: Request,
    user: User = Depends(get_current_user),
) -> None:
    await request.app.state.limiter.check_or_raise(str(user.id))


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class RepoImportRequest(BaseModel):
    full_name: str        = Field(..., example="octocat/Hello-World")
    default_branch: str   = Field("main")
    is_private: bool      = Field(False)


class QueryRequest(BaseModel):
    question: str         = Field(..., min_length=1, max_length=4096)
    repository_id: str
    provider: InferenceProvider = "groq"
    system_prompt: Optional[str] = None


class TestGenRequest(BaseModel):
    repository_id: str
    file_path: str
    symbol_name: str
    provider: InferenceProvider = "groq"


class DiffRequest(BaseModel):
    repository_id: str
    file_path: str
    symbol_name: str
    refactor_instruction: str
    provider: InferenceProvider = "groq"

class UserKeyRequest(BaseModel):
    groq_api_key: str


# ─── GitHub OAuth Routes ──────────────────────────────────────────────────────

@app.get("/api/auth/github")
async def github_oauth_init():
    """Redirect user to GitHub OAuth consent screen."""
    state = secrets.token_urlsafe(32)
    url   = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&scope=repo,read:user,user:email"
        f"&state={state}"
    )
    response = Response(status_code=302)
    response.headers["Location"] = url
    response.set_cookie("oauth_state", state, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/api/auth/github/callback")
async def github_oauth_callback(
    code: str,
    state: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Exchange code for token, upsert user, create session cookie."""
    stored_state = request.cookies.get("oauth_state")
    if not stored_state or stored_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state.")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id":     GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code":          code,
            },
            headers={"Accept": "application/json"},
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="GitHub token exchange failed.")

        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        github_user = user_resp.json()

    encryptor = request.app.state.encryptor
    ct, iv, tag = encryptor.encrypt(access_token)

    stmt   = select(User).where(User.github_id == github_user["id"])
    result = await db.execute(stmt)
    user   = result.scalar_one_or_none()

    from datetime import datetime, timezone, timedelta
    expires = datetime.now(timezone.utc) + timedelta(hours=8)

    if user is None:
        user = User(
            github_id=github_user["id"],
            login=github_user["login"],
            email=github_user.get("email"),
            display_name=github_user.get("name"),
            avatar_url=github_user.get("avatar_url"),
            encrypted_token=ct,
            token_iv=iv,
            token_tag=tag,
            token_expires_at=expires,
        )
        db.add(user)
    else:
        user.encrypted_token  = ct
        user.token_iv         = iv
        user.token_tag        = tag
        user.token_expires_at = expires
        user.login            = github_user["login"]

    await db.commit()
    await db.refresh(user)

    session_token = secrets.token_urlsafe(48)
    user.session_token = session_token
    await db.commit()
    response = Response(status_code=302)
    response.headers["Location"] = f"{FRONTEND_URL}/dashboard?token={session_token}"
    response.set_cookie(
        "nexus_session", session_token,
        httponly=True, secure=True, samesite="none", max_age=28800,
    )
    response.delete_cookie("oauth_state")
    return response


@app.post("/api/auth/logout")
async def logout(request: Request, db: AsyncSession = Depends(get_db)):
    session_token = request.cookies.get("nexus_session")
    if session_token:
        stmt = select(User).where(User.session_token == session_token)
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user:
            user.session_token = None
            await db.commit()
    response = Response(status_code=200)
    response.delete_cookie("nexus_session", samesite="none", secure=True)
    return response


@app.get("/api/user")
async def get_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_github_session(db, user)
    return await session.get("/user")

@app.post("/api/user/key")
async def update_key(
    body: UserKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    if body.groq_api_key:
        encryptor = TokenEncryptor()
        enc, iv, tag = encryptor.encrypt(body.groq_api_key)
        user.groq_api_key_enc = enc
        user.groq_api_key_iv = iv
        user.groq_api_key_tag = tag
        db.add(user)
        await db.commit()
    
    return {"status": "ok"}


# ─── Repositories ─────────────────────────────────────────────────────────────

@app.get("/api/github/repos")
async def list_github_repos(
    request: Request,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit),
):
    """Fetch the user's repositories directly from GitHub."""
    encryptor = request.app.state.encryptor
    plain_token = encryptor.decrypt(user.encrypted_token, user.token_iv, user.token_tag)
    
    async with httpx.AsyncClient() as client:
        gh_resp = await client.get(
            "https://api.github.com/user/repos?per_page=100&sort=updated",
            headers={
                "Authorization": f"Bearer {plain_token}",
                "User-Agent": "Nexus/1.0"
            }
        )
        if gh_resp.status_code != 200:
            print(f"GitHub API Error: {gh_resp.status_code} {gh_resp.text}")
            raise HTTPException(status_code=400, detail="Failed to fetch repositories from GitHub.")
            
        repos = gh_resp.json()
        
    return [
        {
            "full_name": r["full_name"],
            "private": r["private"],
            "html_url": r["html_url"],
            "updated_at": r["updated_at"]
        } for r in repos
    ]

@app.get("/api/repos")
async def list_repos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    stmt    = select(Repository).where(Repository.owner_id == user.id)
    result  = await db.execute(stmt)
    repos   = result.scalars().all()
    return [
        {
            "id":             str(r.id),
            "full_name":      r.full_name,
            "status":         r.status.value,
            "chunk_count":    r.chunk_count,
            "file_count":     r.file_count,
            "ingested_at":    r.ingested_at.isoformat() if r.ingested_at else None,
        }
        for r in repos
    ]


@app.post("/api/repos", status_code=201)
async def import_repo(
    body: RepoImportRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    encryptor    = request.app.state.encryptor
    plain_token  = encryptor.decrypt(user.encrypted_token, user.token_iv, user.token_tag)

    stmt = select(Repository).where(
        Repository.owner_id == user.id,
        Repository.full_name == body.full_name,
    )
    existing = (await db.execute(stmt)).scalars().first()

    if existing:
        if existing.status == RepoStatus.FAILED:
            existing.status        = RepoStatus.PENDING
            existing.error_message = None
            await db.commit()
            repo = existing
        else:
            raise HTTPException(status_code=409, detail="Repository already imported.")
    else:
        async with httpx.AsyncClient() as client:
            gh_resp = await client.get(
                f"https://api.github.com/repos/{body.full_name}",
                headers={"Authorization": f"Bearer {plain_token}"},
            )
            if gh_resp.status_code == 404:
                raise HTTPException(status_code=404, detail="GitHub repository not found.")
            gh_data = gh_resp.json()

        repo = Repository(
            owner_id=user.id,
            github_repo_id=gh_data["id"],
            full_name=body.full_name,
            default_branch=body.default_branch,
            description=gh_data.get("description"),
            is_private=gh_data.get("private", False),
        )
        db.add(repo)
        await db.commit()
        await db.refresh(repo)

    task_id = "bg-" + str(uuid.uuid4())
    background_tasks.add_task(ingest_repository, str(repo.id), plain_token)
    repo.celery_task_id = task_id
    await db.commit()

    return {"repository_id": str(repo.id), "task_id": task_id, "status": "queued"}


@app.get("/api/repos/{repo_id}")
async def get_repo(
    repo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await db.get(Repository, uuid.UUID(repo_id))
    if not repo or repo.owner_id != user.id:
        raise HTTPException(status_code=404)
    return {
        "id":             str(repo.id),
        "full_name":      repo.full_name,
        "status":         repo.status,
        "chunk_count":    repo.chunk_count,
        "file_count":     repo.file_count,
        "total_tokens":   repo.total_tokens,
        "error_message":  repo.error_message,
        "ingested_at":    repo.ingested_at.isoformat() if repo.ingested_at else None,
        "vector_collection": repo.vector_collection,
    }


@app.delete("/api/repos/{repo_id}")
async def delete_repo(
    repo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await db.get(Repository, uuid.UUID(repo_id))
    if not repo or repo.owner_id != user.id:
        raise HTTPException(status_code=404)
    await db.delete(repo)
    await db.commit()
    return {"status": "deleted"}


# ─── Query / Chat Route (streaming SSE) ──────────────────────────────────────

@app.post("/api/query/stream")
async def stream_query(
    body: QueryRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    repo = await db.get(Repository, uuid.UUID(body.repository_id))
    if not repo or repo.owner_id != user.id:
        raise HTTPException(status_code=404)
    if repo.status != RepoStatus.READY.value:
        raise HTTPException(status_code=400, detail=f"Repository not ready: {repo.status}")

    api_key = get_user_groq_key(user)
    query_svc = QueryService(api_key=api_key)

    async def token_stream():
        gen = await query_svc.query(
            question=body.question,
            collection_name=repo.vector_collection,
            repository_id=body.repository_id,
            provider=body.provider,
            system_prompt=body.system_prompt,
        )
        async for token in gen:
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        token_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Test Suite Generation ────────────────────────────────────────────────────

@app.post("/api/tools/generate-tests")
async def generate_tests(
    body: TestGenRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    repo = await db.get(Repository, uuid.UUID(body.repository_id))
    if not repo or repo.owner_id != user.id:
        raise HTTPException(status_code=404)

    system = (
        "You are a senior test engineer. Given a code symbol and its implementation, "
        "generate a complete, idiomatic unit test suite using the standard testing "
        "framework for the language. Include: happy path, edge cases, and error cases. "
        "Return only executable test code with no explanation."
    )

    question = (
        f"Generate a complete unit test suite for `{body.symbol_name}` "
        f"in file `{body.file_path}`. "
        "Use pytest for Python, Jest/Vitest for TypeScript/JavaScript."
    )

    api_key = get_user_groq_key(user)
    query_svc = QueryService(api_key=api_key)

    async def stream():
        gen = await query_svc.query(
            question=question,
            collection_name=repo.vector_collection,
            repository_id=body.repository_id,
            provider=body.provider,
            system_prompt=system,
        )
        async for token in gen:
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─── Diff / Refactor Preview ──────────────────────────────────────────────────

@app.post("/api/tools/refactor-diff")
async def refactor_diff(
    body: DiffRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit),
):
    repo = await db.get(Repository, uuid.UUID(body.repository_id))
    if not repo or repo.owner_id != user.id:
        raise HTTPException(status_code=404)

    system = (
        "You are a senior software engineer. The user will provide a refactoring instruction. "
        "Respond ONLY with a JSON object in this exact format:\n"
        '{"before": "<original code>", "after": "<refactored code>", '
        '"explanation": "<one-paragraph rationale>"}\n'
        "The before/after fields must contain complete, syntactically valid code blocks."
    )

    question = (
        f"Refactor `{body.symbol_name}` in `{body.file_path}`.\n"
        f"Instruction: {body.refactor_instruction}"
    )

    api_key = get_user_groq_key(user)
    query_svc = QueryService(api_key=api_key)

    async def stream():
        gen = await query_svc.query(
            question=question,
            collection_name=repo.vector_collection,
            repository_id=body.repository_id,
            provider=body.provider,
            system_prompt=system,
        )
        async for token in gen:
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/test-bg")
async def test_bg():
    import asyncio
    import time
    def heavy_work():
        time.sleep(10) # Simulate 10 seconds of blocking work
    asyncio.create_task(asyncio.to_thread(heavy_work))
    return {"status": "started", "service": "nexus-api"}


@app.post("/api/test-crash")
async def test_crash():
    data = {}
    return data["id"]


# needed for oauth_state in the callback
import secrets
print("Starting Nexus API...")
