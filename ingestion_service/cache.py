from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any


def _cache_dir() -> Path:
    raw = os.environ.get("INGESTION_CACHE_DIR", "").strip()
    base = Path(raw) if raw else Path(__file__).resolve().parent.parent / ".ingestion_cache"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _ttl_sec() -> float:
    raw = os.environ.get("INGESTION_CACHE_TTL_SEC", "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return 900.0


def cache_key(params: dict[str, str]) -> str:
    normalized = {k: v.strip() for k, v in sorted(params.items()) if v and v.strip()}
    blob = json.dumps(normalized, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def cache_get(key: str) -> dict[str, Any] | None:
    ttl = _ttl_sec()
    if ttl <= 0:
        return None
    path = _cache_dir() / f"{key}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    cached_at = float(data.get("cached_at", 0))
    if time.time() - cached_at > ttl:
        return None
    payload = data.get("payload")
    return payload if isinstance(payload, dict) else None


def cache_set(key: str, payload: dict[str, Any]) -> None:
    ttl = _ttl_sec()
    if ttl <= 0:
        return
    path = _cache_dir() / f"{key}.json"
    try:
        path.write_text(
            json.dumps({"cached_at": time.time(), "payload": payload}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass
