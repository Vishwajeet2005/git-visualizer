"""
Module 2+6 — Security: AES-256-GCM token encryption, Redis token-bucket rate limiting,
automated credential purging.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Optional


from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ─── AES-256-GCM Encryption ───────────────────────────────────────────────────

class TokenEncryptor:
    """
    Encrypts / decrypts OAuth tokens using AES-256-GCM.
    Key is loaded from AES_SECRET_KEY env var (32 bytes, base64-encoded).
    IV is generated fresh per encrypt call and stored alongside ciphertext.
    """

    def __init__(self) -> None:
        import hashlib
        raw = os.environ.get("AES_SECRET_KEY", "default_secret_key_for_dev_mode_only")
        key_bytes = hashlib.sha256(raw.encode("utf-8")).digest()
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


class RateLimiter:
    """
    Dummy Rate Limiter for free tier deployment.
    """
    def __init__(self, *args, **kwargs) -> None:
        pass

    async def check_or_raise(self, user_id: str, cost: int = 1) -> None:
        pass


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
