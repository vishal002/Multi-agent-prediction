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
CRICAPI_BASE = "https://api.cricapi.com/v1"

DEFAULT_FETCH_TIMEOUT = 8.0

# Score pattern: "109/2 (11.1" or "254/7 (20)"
_SCORE_RX = re.compile(r"\b\d{1,3}/\d{1,2}\s*\([\d.]+", re.I)
# RRR / required rate
_RRR_RX = re.compile(r"\b(RRR|req(?:uired)?\s*(?:run\s*)?rate)\s*[:\-]?\s*[\d.]+", re.I)
# "need X runs" / "need X in Y balls"
_NEED_RX = re.compile(r"\bneed\s+\d+\s+(runs?|more|in\s+\d+)", re.I)
# "chasing X" or "target: X"
_CHASE_RX = re.compile(r"\b(chasing|target\s*[:\-]?)\s*\d+", re.I)


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


def _score_richness(text: str) -> int:
    """Score how much live match info a headline contains (higher = more live data)."""
    s = 0
    if _SCORE_RX.search(text):
        s += 4
    if _RRR_RX.search(text):
        s += 3
    if _NEED_RX.search(text):
        s += 3
    if _CHASE_RX.search(text):
        s += 2
    if re.search(r"\b(live|score|update|inning|over)\b", text, re.I):
        s += 1
    return s


def _extract_live_score_snippet(bullets: list[str]) -> str:
    """
    Scan news bullets for the richest live-score information.
    Returns the raw bullet text (stripped of source prefix) or empty string.
    """
    best = ""
    best_score = 0
    for b in bullets:
        plain = re.sub(r"^\[[^\]]+\]\s*", "", b).strip()
        s = _score_richness(plain)
        if s > best_score:
            best_score = s
            best = plain
    # Only return if we found at least a score pattern + one more signal
    if best_score >= 5:
        return best[:400]
    return ""


def _format_cricapi_score(match: dict[str, Any]) -> str:
    """Build a human-readable score string from a CricAPI match object."""
    scores = match.get("score") or []
    parts: list[str] = []
    for s in scores:
        inning = str(s.get("inning") or "").strip()
        runs = s.get("r", "")
        wkts = s.get("w", "")
        overs = s.get("o", "")
        if runs != "" and runs is not None:
            parts.append(f"{inning}: {runs}/{wkts} ({overs} ov)")
    return " | ".join(parts)


async def fetch_cricapi_live(
    client: httpx.AsyncClient,
    *,
    tokens: list[str],
    timeout_sec: float,
) -> dict[str, Any]:
    """
    Fetch live/current matches from CricAPI v1.
    Requires CRICAPI_KEY env var. Returns graceful empty result if key is absent.
    """
    api_key = os.environ.get("CRICAPI_KEY", "").strip()
    if not api_key:
        return {"bullets": [], "live_score_snippet": "", "richness": 0, "match_count": 0, "error": None}

    try:
        r = await client.get(
            f"{CRICAPI_BASE}/currentMatches",
            params={"apikey": api_key, "offset": 0},
            timeout=timeout_sec,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        err = str(e).strip()[:300] or type(e).__name__
        return {"bullets": [], "live_score_snippet": "", "richness": 0, "match_count": 0, "error": err}

    if data.get("status") != "success":
        err = str(data.get("status", "unknown_status"))
        return {"bullets": [], "live_score_snippet": "", "richness": 0, "match_count": 0, "error": err}

    all_matches: list[dict[str, Any]] = data.get("data") or []

    def _relevance(m: dict[str, Any]) -> int:
        hay = " ".join(
            filter(None, [m.get("name", ""), m.get("venue", ""), " ".join(m.get("teams") or [])])
        ).lower()
        return sum(1 for t in tokens if t.lower() in hay)

    # Prefer matches that mention our teams/venue; fall back to first 3 live matches
    if tokens:
        relevant = [m for m in all_matches if _relevance(m) > 0]
        relevant.sort(key=_relevance, reverse=True)
        candidates = relevant[:5] or all_matches[:3]
    else:
        candidates = all_matches[:3]

    bullets: list[str] = []
    best_snippet = ""
    best_richness = 0

    for m in candidates:
        name = str(m.get("name") or "").strip()
        status = str(m.get("status") or "").strip()
        score_str = _format_cricapi_score(m)

        line = name
        if score_str:
            line += f" — {score_str}"
        if status:
            line += f" [{status}]"

        bullets.append(f"[CricAPI] {line}")

        # Evaluate richness for snippet selection
        richness = _score_richness(score_str + " " + status)
        # CricAPI structured scores always have the X/Y (ov) format our regex expects
        if score_str:
            richness = max(richness, 5)  # treat any structured CricAPI score as high-quality
        if richness > best_richness:
            best_richness = richness
            best_snippet = line[:400]

    return {
        "bullets": bullets,
        "live_score_snippet": best_snippet,
        "richness": best_richness,
        "match_count": len(all_matches),
        "error": None,
    }


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
        espn, buzz, cricapi = await asyncio.gather(
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
            fetch_cricapi_live(client, tokens=tokens, timeout_sec=timeout),
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

    # CricAPI source metadata
    sources.append(
        {
            "id": "cricapi",
            "name": "CricAPI (live)",
            "url": f"{CRICAPI_BASE}/currentMatches",
            "ok": cricapi.get("error") is None,
            "error": cricapi.get("error"),
            "item_count": len(cricapi.get("bullets") or []),
        }
    )

    # Build RSS-derived news bullets
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

    # Prepend CricAPI live bullets so agents see structured scores first
    cricapi_bullets: list[str] = cricapi.get("bullets") or []
    all_bullets = cricapi_bullets + news_bullets

    pitch_note = _pick_note(
        all_bullets,
        re.compile(r"\b(pitch|wicket|spin|seam|bounce|turn|crack|rough|grass)\b", re.I),
        280,
    )
    weather_note = _pick_note(
        all_bullets,
        re.compile(r"\b(rain|dew|humid|hot|cold|weather|forecast|thunder|overcast)\b", re.I),
        280,
    )

    stats_tables: dict[str, Any] = {}

    # CricAPI structured score takes priority over RSS-scraped snippet
    live_score_snippet = cricapi.get("live_score_snippet") or _extract_live_score_snippet(news_bullets)

    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    payload: dict[str, Any] = {
        "news_bullets": all_bullets,
        "stats_tables": stats_tables,
        "pitch_note": pitch_note,
        "weather_note": weather_note,
        "live_score_snippet": live_score_snippet,
        "sources": sources,
        "fetched_at": fetched_at,
        "query": params,
        "cache": {"hit": False, "key": key},
    }

    if use_cache:
        cache_set(key, payload)

    return payload
