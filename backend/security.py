"""
Module 2+6 — Security: AES-256-GCM token encryption, Redis token-bucket rate limiting,
automated credential purging.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Optional

import redis.asyncio as aioredis
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ─── AES-256-GCM Encryption ───────────────────────────────────────────────────

class TokenEncryptor:
    """
    Encrypts / decrypts OAuth tokens using AES-256-GCM.
    Key is loaded from AES_SECRET_KEY env var (32 bytes, base64-encoded).
    IV is generated fresh per encrypt call and stored alongside ciphertext.
    """

    def __init__(self) -> None:
        import base64
        raw = os.environ["AES_SECRET_KEY"]
        key_bytes = base64.b64decode(raw)
        if len(key_bytes) != 32:
            raise ValueError("AES_SECRET_KEY must decode to exactly 32 bytes.")
        self._aesgcm = AESGCM(key_bytes)

    def encrypt(self, plaintext: str) -> tuple[bytes, bytes, bytes]:
        """
        Returns (ciphertext, iv, tag).
        Tag is embedded in ciphertext by AESGCM; split for DB storage.
        """
        iv = secrets.token_bytes(12)   # 96-bit nonce for GCM
        ct = self._aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
        # AESGCM appends 16-byte auth tag at the end
        ciphertext = ct[:-16]
        tag        = ct[-16:]
        return ciphertext, iv, tag

    def decrypt(self, ciphertext: bytes, iv: bytes, tag: bytes) -> str:
        """Reconstructs and decrypts the combined ciphertext+tag blob."""
        combined = ciphertext + tag
        plaintext = self._aesgcm.decrypt(iv, combined, None)
        return plaintext.decode("utf-8")


# ─── Redis Token-Bucket Rate Limiter ─────────────────────────────────────────

RATE_LIMIT_SCRIPT = """
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens     = tonumber(data[1]) or capacity
local last_refill = tonumber(data[2]) or now

local elapsed = math.max(0, now - last_refill)
local new_tokens = math.min(capacity, tokens + elapsed * refill)
new_tokens = new_tokens - cost

if new_tokens < 0 then
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 86400)
    return 0
end

redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
redis.call('EXPIRE', key, 86400)
return 1
"""


class RateLimiter:
    """
    Per-user token-bucket rate limiter backed by Redis.
    Default: 60 requests/min (capacity=60, refill=1 token/sec).
    """

    def __init__(
        self,
        redis_url: str,
        capacity: int = 60,
        refill_rate: float = 1.0,   # tokens per second
    ) -> None:
        self._redis       = aioredis.from_url(redis_url, decode_responses=False)
        self._capacity    = capacity
        self._refill_rate = refill_rate
        self._script: Optional[aioredis.client.Script] = None

    async def _get_script(self):
        if self._script is None:
            self._script = self._redis.register_script(RATE_LIMIT_SCRIPT)
        return self._script

    async def is_allowed(self, user_id: str, cost: int = 1) -> bool:
        """Returns True if the request is within rate limits."""
        script = await self._get_script()
        key    = f"ratelimit:{user_id}"
        now    = time.time()
        result = await script(
            keys=[key],
            args=[self._capacity, self._refill_rate, now, cost],
        )
        return bool(result)

    async def check_or_raise(self, user_id: str, cost: int = 1) -> None:
        """Raise HTTP 429 if rate limit exceeded."""
        from fastapi import HTTPException
        if not await self.is_allowed(user_id, cost):
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please retry after a moment.",
                headers={"Retry-After": "60"},
            )


# ─── Credential Purge Service ─────────────────────────────────────────────────

class CredentialPurgeService:
    """
    Scans the users table for expired OAuth tokens and wipes encrypted
    credential bytes. Run as a periodic Celery beat task (every hour).
    """

    @staticmethod
    async def purge_expired_tokens(session) -> int:
        """
        Sets encrypted_token, token_iv, token_tag, token_expires_at to NULL
        for all users whose token has expired. Returns count purged.
        """
        from datetime import datetime, timezone
        from sqlalchemy import update, and_
        from backend.schema import User

        now = datetime.now(timezone.utc)
        stmt = (
            update(User)
            .where(
                and_(
                    User.token_expires_at.isnot(None),
                    User.token_expires_at < now,
                    User.encrypted_token.isnot(None),
                )
            )
            .values(
                encrypted_token=None,
                token_iv=None,
                token_tag=None,
                token_expires_at=None,
            )
            .execution_options(synchronize_session="fetch")
        )
        result = await session.execute(stmt)
        await session.commit()
        purged = result.rowcount
        if purged > 0:
            import structlog
            structlog.get_logger(__name__).info(
                "Purged expired OAuth tokens", count=purged
            )
        return purged
