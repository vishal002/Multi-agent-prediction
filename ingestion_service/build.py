from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from ingestion_service.cache import cache_get, cache_key as make_cache_key, cache_set
from ingestion_service.rss import fetch_feed

ESPN_FEED = os.environ.get(
    "INGESTION_ESPN_RSS_URL",
    "https://www.espncricinfo.com/rss/content/story/feeds/0.xml",
).strip()
CRICBUZZ_FEED = os.environ.get(
    "INGESTION_CRICBUZZ_RSS_URL",
    "https://feeds.feedburner.com/CricbuzzFeed",
).strip()

DEFAULT_FETCH_TIMEOUT = 8.0


def _timeout_sec() -> float:
    raw = os.environ.get("INGESTION_FETCH_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            return max(1.0, min(60.0, float(raw)))
        except ValueError:
            pass
    return DEFAULT_FETCH_TIMEOUT


def _tokenize_context(label: str, teams_csv: str, venue: str) -> list[str]:
    parts: list[str] = []
    if label.strip():
        parts.append(label)
    if teams_csv.strip():
        parts.append(teams_csv.replace(",", " "))
    if venue.strip():
        parts.append(venue)
    blob = " ".join(parts)
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", blob)
    seen: set[str] = set()
    out: list[str] = []
    for t in tokens:
        low = t.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(t)
    return out[:24]


def _item_text(it: dict[str, Any]) -> str:
    title = str(it.get("title") or "").strip()
    summary = str(it.get("summary") or "").strip()
    if title and summary:
        return f"{title} — {summary}"
    return title or summary


def _relevant_items(
    items: list[dict[str, Any]],
    tokens: list[str],
    *,
    limit: int,
    fallback: int,
) -> list[dict[str, Any]]:
    if not items:
        return []
    if not tokens:
        return items[:fallback]

    def score(it: dict[str, Any]) -> int:
        hay = _item_text(it).lower()
        s = 0
        for tok in tokens:
            if tok.lower() in hay:
                s += 2 if len(tok) >= 4 else 1
        return s

    ranked = sorted(items, key=score, reverse=True)
    top = [it for it in ranked if score(it) > 0][:limit]
    if top:
        return top
    return ranked[:fallback]


def _pick_note(bullets: list[str], pattern: re.Pattern[str], max_len: int) -> str:
    for b in bullets:
        if pattern.search(b):
            plain = re.sub(r"^\[[^\]]+\]\s*", "", b)
            return plain[:max_len].strip()
    return ""


async def build_match_context(
    *,
    label: str,
    teams: str,
    venue: str,
    date: str,
    use_cache: bool = True,
) -> dict[str, Any]:
    params = {
        "label": label.strip(),
        "teams": teams.strip(),
        "venue": venue.strip(),
        "date": date.strip(),
    }
    key = make_cache_key(params)
    if use_cache:
        hit = cache_get(key)
        if hit is not None:
            hit = dict(hit)
            hit["cache"] = {"hit": True, "key": key}
            return hit

    timeout = _timeout_sec()
    tokens = _tokenize_context(label, teams, venue)

    limits = httpx.Limits(max_keepalive_connections=4, max_connections=8)
    async with httpx.AsyncClient(
        follow_redirects=True,
        headers={"User-Agent": "CricketWarRoom-Ingestion/1.0 (+local dev)"},
        limits=limits,
    ) as client:
        espn, buzz = await asyncio.gather(
            fetch_feed(
                client,
                source_id="espncricinfo",
                display_name="ESPNcricinfo RSS",
                feed_url=ESPN_FEED,
                timeout_sec=timeout,
            ),
            fetch_feed(
                client,
                source_id="cricbuzz",
                display_name="Cricbuzz (FeedBurner)",
                feed_url=CRICBUZZ_FEED,
                timeout_sec=timeout,
            ),
        )

    sources: list[dict[str, Any]] = []
    all_items: list[tuple[str, str, dict[str, Any]]] = []

    for outcome in (espn, buzz):
        sources.append(
            {
                "id": outcome.source_id,
                "name": outcome.display_name,
                "url": outcome.feed_url,
                "ok": outcome.ok,
                "error": outcome.error,
                "item_count": len(outcome.items),
            }
        )
        prefix = "ESPNcricinfo" if outcome.source_id == "espncricinfo" else "Cricbuzz"
        picked = _relevant_items(outcome.items, tokens, limit=8, fallback=6)
        for it in picked:
            all_items.append((outcome.source_id, prefix, it))

    news_bullets: list[str] = []
    seen_text: set[str] = set()
    for _sid, prefix, it in all_items:
        line = _item_text(it)
        if not line:
            continue
        b = f"[{prefix}] {line}"
        key_line = b[:240].lower()
        if key_line in seen_text:
            continue
        seen_text.add(key_line)
        news_bullets.append(b)
        if len(news_bullets) >= 20:
            break

    pitch_note = _pick_note(
        news_bullets,
        re.compile(r"\b(pitch|wicket|spin|seam|bounce|turn|crack|rough|grass)\b", re.I),
        280,
    )
    weather_note = _pick_note(
        news_bullets,
        re.compile(r"\b(rain|dew|humid|hot|cold|weather|forecast|thunder|overcast)\b", re.I),
        280,
    )

    stats_tables: dict[str, Any] = {}

    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    payload: dict[str, Any] = {
        "news_bullets": news_bullets,
        "stats_tables": stats_tables,
        "pitch_note": pitch_note,
        "weather_note": weather_note,
        "sources": sources,
        "fetched_at": fetched_at,
        "query": params,
        "cache": {"hit": False, "key": key},
    }

    if use_cache:
        cache_set(key, payload)

    return payload
