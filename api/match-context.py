"""
GET /api/match-context — Vercel Python serverless function.

Replaces the Node proxy that used to forward to a separate uvicorn ingestion
service. Wraps `ingestion_service.build.build_match_context`, which fetches
ESPNcricinfo + Cricbuzz RSS in parallel with CricAPI live scores.

Why this matters for war room flow:
  The front-end calls /api/match-context BEFORE running the agent chain to
  ground the prompts in real-world news + live scores. Without this endpoint
  every war room run reasons from match_id alone — no recent injury news,
  no live powerplay info, no pitch reports.

Caching:
  ingestion_service.cache writes to a filesystem cache (`.ingestion_cache/`),
  which doesn't work on Vercel's read-only Lambda filesystem. We bypass it
  (use_cache=False on every call) and cache at the wrapper level using the
  same Upstash Redis client we built for the Judge endpoints. TTL = 5 min,
  enough to absorb the ~3-5 fetches a single war room run triggers without
  serving stale headlines during a live match.
"""

from __future__ import annotations

# ── sys.path bootstrap ────────────────────────────────────────────────────
# See api/judge/predict.py for full rationale. Vercel's Python runtime puts
# /var/task on sys.path but not the function file's own directory, and we
# need to reach both `judge/_cache.py` (for Redis) and `ingestion_service.*`.
import os as _os
import sys as _sys

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.abspath(_os.path.join(_HERE, ".."))
_JUDGE_DIR = _os.path.join(_HERE, "judge")
for _p in (_HERE, _JUDGE_DIR, _ROOT):
    if _p not in _sys.path:
        _sys.path.insert(0, _p)
# ──────────────────────────────────────────────────────────────────────────

import asyncio
import hashlib
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# Re-use the helpers we already debugged for the Judge endpoints. They live
# under api/judge/ which we just put on sys.path above.
from _cache import cache_get, cache_setex
from _shared import capture_exception, cors_headers

CACHE_TTL_SECONDS = 300  # 5 min — short enough for live matches, long enough
#                         to absorb the 3-5 fetches per war room run.
MAX_AGENT_CHAIN_BUDGET_SEC = 25.0  # Vercel maxDuration is 30s; leave headroom.


def _redis_key(label: str, teams: str, venue: str, date: str) -> str:
    """Hash the four query params into a stable cache key."""
    blob = json.dumps(
        {"label": label.strip(), "teams": teams.strip(), "venue": venue.strip(), "date": date.strip()},
        sort_keys=True,
    ).encode("utf-8")
    digest = hashlib.sha256(blob).hexdigest()[:24]
    return f"warroom:match-context:v1:{digest}"


class handler(BaseHTTPRequestHandler):  # noqa: N801
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return  # silence the default access log on Vercel

    def _send_json(self, status: int, payload: dict, extra: dict | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Cache-Control public/short — front-end may also use the response;
        # safe because each query-param combo gets its own URL.
        self.send_header("Cache-Control", "public, max-age=60")
        for k, v in cors_headers(self.headers.get("Origin")).items():
            self.send_header(k, v)
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        for k, v in cors_headers(self.headers.get("Origin")).items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        qs = parse_qs(urlparse(self.path).query)
        label = (qs.get("label", [""])[0] or "")[:500]
        teams = (qs.get("teams", [""])[0] or "")[:500]
        venue = (qs.get("venue", [""])[0] or "")[:300]
        date = (qs.get("date", [""])[0] or "")[:80]
        nocache = (qs.get("nocache", ["0"])[0] or "0").strip().lower() in ("1", "true", "yes")

        # 1. Read-through cache (Upstash Redis).
        key = _redis_key(label, teams, venue, date)
        if not nocache:
            try:
                cached = cache_get(key)
                if cached:
                    payload = json.loads(cached)
                    payload["cache"] = {"hit": True, "key": key}
                    self._send_json(200, payload, extra={"X-Match-Context-Cache": "hit"})
                    return
            except (json.JSONDecodeError, TypeError):
                pass  # corrupt entry — recompute

        # 2. Build fresh context. Lazy import keeps cold-start lean for cache hits.
        try:
            from ingestion_service.build import build_match_context
        except Exception as e:
            capture_exception(e, stage="ingestion_import")
            self._send_json(
                502,
                {"error": "ingestion_unavailable", "message": f"failed to import ingestion: {e!s}"},
            )
            return

        try:
            payload = asyncio.run(
                _build_with_budget(
                    build_match_context,
                    label=label,
                    teams=teams,
                    venue=venue,
                    date=date,
                    timeout_sec=MAX_AGENT_CHAIN_BUDGET_SEC,
                )
            )
        except asyncio.TimeoutError:
            self._send_json(
                504,
                {"error": "ingestion_timeout", "message": "RSS/CricAPI fetch exceeded budget"},
            )
            return
        except Exception as e:
            capture_exception(e, stage="ingestion_build", label=label or "")
            self._send_json(
                502,
                {"error": "ingestion_failed", "message": str(e)},
            )
            return

        # 3. Write-through. Best-effort.
        try:
            cache_setex(key, CACHE_TTL_SECONDS, json.dumps(payload))
        except Exception:
            pass

        payload["cache"] = {"hit": False, "key": key}
        self._send_json(200, payload, extra={"X-Match-Context-Cache": "miss"})


async def _build_with_budget(build_fn, **kwargs) -> dict:
    """Run build_match_context with an outer timeout; force use_cache=False
    because the filesystem cache it would otherwise hit doesn't survive a
    Lambda restart. We cache at the Redis layer in the handler instead."""
    timeout_sec = kwargs.pop("timeout_sec")
    return await asyncio.wait_for(build_fn(use_cache=False, **kwargs), timeout=timeout_sec)
