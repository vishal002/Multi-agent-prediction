"""
GET /api/match-context — RSS-backed match_context bundle (ESPNcricinfo + Cricbuzz).

Query: label, teams (comma-separated), venue, date — all optional; used to rank headlines.
nocache=1 skips read-through cache (still writes unless INGESTION_CACHE_TTL_SEC=0).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from ingestion_service.build import build_match_context

logger = logging.getLogger(__name__)
if not logging.root.handlers:
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Cricket War Room — Ingestion", version="0.1.0")

_EXPOSE_INGESTION_ERRORS = os.environ.get("INGESTION_EXPOSE_ERRORS", "").strip().lower() in (
    "1",
    "true",
    "yes",
)


@app.get("/api/match-context")
async def match_context(
    label: str = Query("", max_length=500),
    teams: str = Query("", max_length=500),
    venue: str = Query("", max_length=300),
    date: str = Query("", max_length=80),
    nocache: bool = Query(False),
) -> JSONResponse:
    if os.environ.get("INGESTION_DISABLE", "").strip().lower() in ("1", "true", "yes"):
        return JSONResponse(
            status_code=503,
            content={
                "error": "ingestion_disabled",
                "message": "INGESTION_DISABLE is set; match context is unavailable.",
            },
        )

    use_cache = not nocache
    try:
        payload = await build_match_context(
            label=label,
            teams=teams,
            venue=venue,
            date=date,
            use_cache=use_cache,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("ingestion build_match_context failed")
        msg = str(e).strip() or type(e).__name__
        return JSONResponse(
            status_code=502,
            content={
                "error": "ingestion_failed",
                "message": msg if _EXPOSE_INGESTION_ERRORS else "ingestion_failed",
            },
        )

    return JSONResponse(content=payload)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
