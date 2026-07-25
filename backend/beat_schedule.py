"""
Celery beat periodic task schedule.
Tasks:
  - purge_expired_tokens  → hourly credential wipe
  - sync_repo_webhooks    → daily webhook re-registration
  - prune_stale_ingestions → requeue CLONING/PARSING tasks stuck > 1 hour
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from celery import Celery
from celery.schedules import crontab
from sqlalchemy import select, and_, update

log = structlog.get_logger(__name__)


def register_beat_schedule(celery_app: Celery) -> None:
    """Call once during app startup to register all periodic tasks."""
    celery_app.conf.beat_schedule = {
        # ── Purge expired OAuth tokens every hour ─────────────────────────
        "purge-expired-tokens": {
            "task":     "nexus.purge_expired_tokens",
            "schedule": crontab(minute=0),     # top of every hour
        },
        # ── Requeue stuck ingestion tasks every 30 minutes ────────────────
        "prune-stale-ingestions": {
            "task":     "nexus.prune_stale_ingestions",
            "schedule": crontab(minute="*/30"),
        },
    }
    celery_app.conf.timezone = "UTC"


# ── Task: purge_expired_tokens ────────────────────────────────────────────────

def make_purge_task(celery_app: Celery, db_factory) -> None:
    @celery_app.task(name="nexus.purge_expired_tokens", ignore_result=True)
    def purge_expired_tokens() -> dict:
        return asyncio.get_event_loop().run_until_complete(
            _run_purge(db_factory)
        )


async def _run_purge(db_factory) -> dict:
    from backend.workers.security import CredentialPurgeService
    async with db_factory() as session:
        purged = await CredentialPurgeService.purge_expired_tokens(session)
    return {"purged": purged}


# ── Task: prune_stale_ingestions ──────────────────────────────────────────────

def make_prune_task(celery_app: Celery, db_factory) -> None:
    @celery_app.task(name="nexus.prune_stale_ingestions", ignore_result=True)
    def prune_stale_ingestions() -> dict:
        return asyncio.get_event_loop().run_until_complete(
            _run_prune(db_factory)
        )


async def _run_prune(db_factory) -> dict:
    from backend.models.schema import Repository, RepoStatus

    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)

    async with db_factory() as session:
        # Find repositories stuck in transient states for > 1 hour
        stmt = select(Repository).where(
            and_(
                Repository.status.in_([
                    RepoStatus.CLONING,
                    RepoStatus.PARSING,
                    RepoStatus.EMBEDDING,
                ]),
                Repository.updated_at < cutoff,
            )
        )
        result = await session.execute(stmt)
        stale_repos = result.scalars().all()

        reset_ids = []
        for repo in stale_repos:
            repo.status        = RepoStatus.FAILED
            repo.error_message = "Ingestion timed out after 1 hour. Marked for retry."
            reset_ids.append(str(repo.id))

        await session.commit()

    log.info("Pruned stale ingestions", count=len(reset_ids), repo_ids=reset_ids)
    return {"pruned": len(reset_ids), "repo_ids": reset_ids}
