"""
Tiny Upstash Redis REST client for the Python serverless functions.

Why not the official `upstash-redis` Python package?
  - We already ship `httpx` for the Groq calls; pulling in another HTTP client
    just to GET/SETEX a few keys doubles the bundle size and cold start.
  - The REST surface is two endpoints; this wrapper is ~30 lines.

Reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — same env vars the
Node side uses (lib/redis.js), so the cache is shared across runtimes.

TTLs mirror lib/redis.js so changing one updates both call-sites manually
(if these drift, the worst case is staleness, not correctness).
"""

from __future__ import annotations

import os
from typing import Final

import httpx

# Match lib/redis.js TTL constants. Keep these aligned by hand; if you find
# yourself changing them often, lift TTLs into a shared JSON config.
TTL_JUDGE_ACCURACY: Final[int] = 3600  # 1 hour — accuracy moves slowly


def _config() -> tuple[str, str] | None:
    url = (os.environ.get("UPSTASH_REDIS_REST_URL") or "").strip().rstrip("/")
    token = (os.environ.get("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    if not url or not token:
        return None
    return url, token


def cache_enabled() -> bool:
    return _config() is not None


def cache_get(key: str) -> str | None:
    """Return cached string value or None on miss / disabled / network error."""
    cfg = _config()
    if cfg is None:
        return None
    url, token = cfg
    try:
        with httpx.Client(timeout=2.5) as c:
            r = c.get(f"{url}/get/{key}", headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            return None
        result = r.json().get("result")
    except Exception:
        # Cache failures must never break the request path — degrade silently.
        return None
    if result is None:
        return None
    return str(result)


def cache_setex(key: str, ttl_seconds: int, value: str) -> None:
    """Best-effort SET with TTL. Swallows network errors."""
    cfg = _config()
    if cfg is None:
        return
    url, token = cfg
    try:
        with httpx.Client(timeout=2.5) as c:
            # Upstash REST: POST /setex/{key}/{seconds} with body=value
            c.post(
                f"{url}/setex/{key}/{int(ttl_seconds)}",
                headers={"Authorization": f"Bearer {token}"},
                content=value.encode("utf-8"),
            )
    except Exception:
        return
