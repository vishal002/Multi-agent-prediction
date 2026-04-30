"""
GET /api/judge/accuracy — Vercel Python serverless function.

Returns running Judge accuracy. Same response shape as the old FastAPI
endpoint and the Node proxy, so the existing front-end keeps working:
  { total_settled, correct, accuracy }

Caching (Phase 3.3): reads/writes Upstash Redis under the same key the Node
side used (`warroom:judge:accuracy:v1`, 1h TTL). The front-end polls this on
every page load — without the cache every load was a Supabase aggregation.

Degrades to a zero-stats payload (HTTP 200) when both cache and store fail,
matching the Node fallback in server.mjs so the UI never sees a hard 503.
"""

from __future__ import annotations

# Vercel Python sys.path bootstrap — see predict.py for rationale.
import os as _os
import sys as _sys

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.abspath(_os.path.join(_HERE, "..", ".."))
for _p in (_HERE, _ROOT):
    if _p not in _sys.path:
        _sys.path.insert(0, _p)

import json

from _cache import cache_get, cache_setex
from _shared import JsonHandler, capture_exception, get_store

REDIS_KEY = "warroom:judge:accuracy:v1"
TTL_SECONDS = 3600


class handler(JsonHandler):  # noqa: N801
    def do_GET(self) -> None:  # noqa: N802
        # 1. Try Redis first — failures degrade silently (cache_get returns None).
        cached = cache_get(REDIS_KEY)
        if cached:
            try:
                payload = json.loads(cached)
                self._send_json(200, payload, extra_headers={"X-Judge-Accuracy-Cache": "hit"})
                return
            except (json.JSONDecodeError, TypeError):
                # Corrupt cache entry — fall through to recompute.
                pass

        # 2. Fall back to Supabase aggregation.
        try:
            stats = get_store().running_accuracy()
        except Exception as e:
            capture_exception(e, stage="accuracy")
            self._send_json(
                200,
                {"total_settled": 0, "correct": 0, "accuracy": None},
                extra_headers={"X-Judge-Accuracy-Degraded": "store-unreachable"},
            )
            return

        payload = {
            "total_settled": stats.total_settled,
            "correct": stats.correct,
            "accuracy": stats.accuracy,
        }

        # 3. Write-through so the next caller is fast. Best-effort.
        try:
            cache_setex(REDIS_KEY, TTL_SECONDS, json.dumps(payload))
        except Exception:
            pass

        self._send_json(200, payload, extra_headers={"X-Judge-Accuracy-Cache": "miss"})
