"""
Shared helpers for the Vercel Python serverless functions under /api/judge/*.

These run on Vercel's Python runtime (one Lambda per file) and reuse the
Judge logic from judge_service/ at the repo root. The sys.path shim makes
that import work whether the bundler places this file at /var/task/api/judge/
or anywhere else under the function package.

Front-end auth contract (mirrors server.mjs):
  - POST /predict requires `Authorization: Bearer <WAR_ROOM_API_SECRET>` when set.
  - GET endpoints are unauthenticated (same as the Node proxy today).

CORS contract (mirrors server.mjs `corsHeaders()`):
  - When ALLOWED_ORIGINS is set, only echo the request's Origin if it matches.
  - When unset (dev), echo the Origin (or `*`).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# Make `judge_service/...` importable regardless of how Vercel structures the
# bundle. `__file__` points at .../api/judge/_shared.py; the repo root sits
# three levels up. Idempotent — safe under Lambda warm reuse.
_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _allowed_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "") or ""
    return [o.strip() for o in raw.split(",") if o.strip()]


def cors_headers(request_origin: str | None) -> dict[str, str]:
    allowed = _allowed_origins()
    headers = {
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Judge-Secret",
        "Access-Control-Max-Age": "86400",
    }
    if not allowed:
        headers["Access-Control-Allow-Origin"] = request_origin or "*"
        return headers
    if request_origin and request_origin in allowed:
        headers["Access-Control-Allow-Origin"] = request_origin
    return headers


def war_room_bearer_ok(authorization: str | None) -> bool:
    """True when the request matches WAR_ROOM_API_SECRET (or it isn't set)."""
    expected = (os.environ.get("WAR_ROOM_API_SECRET") or "").strip()
    if not expected:
        return True
    if not authorization:
        return False
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return False
    return parts[1].strip() == expected


def get_store():
    """Return a SupabasePredictionsStore. Raises clearly if env is missing."""
    # Local imports so the bundle only pays for them on first invocation.
    from judge_service.predictions_supabase import (
        SupabasePredictionsStore,
        supabase_configured,
    )

    if not supabase_configured():
        raise RuntimeError(
            "supabase_not_configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
        )

    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    if key.startswith("sb_publishable_") or key.startswith("eyJpc3MiOiJzdXBh"):
        # Catches the most common foot-gun: pasting the anon/publishable key
        # into the service-role slot. Inserts will silently fail under RLS.
        raise RuntimeError(
            "supabase_wrong_key: SUPABASE_SERVICE_ROLE_KEY looks like a "
            "publishable/anon key. Copy the *service_role* secret from "
            "Supabase → Project Settings → API."
        )

    return SupabasePredictionsStore(os.environ["SUPABASE_URL"].strip(), key)


class JsonHandler(BaseHTTPRequestHandler):
    """Tiny base class — JSON responses, CORS, and OPTIONS handled once."""

    # Keep the standard `BaseHTTPRequestHandler.log_message` quiet on Vercel.
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return

    # ── helpers ───────────────────────────────────────────────────────────

    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _send_json(self, status: int, payload: dict, extra_headers: dict | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in cors_headers(self._origin()).items():
            self.send_header(k, v)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self, max_bytes: int = 200_000) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > max_bytes:
            raise ValueError(f"payload_too_large:{length}")
        raw = self.rfile.read(length)
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"invalid_json:{e!s}") from e
        if not isinstance(data, dict):
            raise ValueError("invalid_json:not_object")
        return data

    # ── default verbs ─────────────────────────────────────────────────────

    def do_OPTIONS(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler convention)
        self.send_response(204)
        for k, v in cors_headers(self._origin()).items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()
