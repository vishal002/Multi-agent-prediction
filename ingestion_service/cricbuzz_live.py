"""
Optional Cricbuzz live-score scraper.

Near-real-time supplement to CricAPI/RSS. The default ingestion path falls back
to CricAPI (structured but rate-limited) and RSS (slow), which lag Google's
live card by anywhere from 30 seconds to several minutes. When this module is
enabled it returns a structured live state much closer to ball-by-ball.

OFF BY DEFAULT IN PRODUCTION. Set ``INGESTION_LIVE_SCRAPE_ENABLED=1`` to opt in.
Detection of "production" is best-effort (Vercel/Render env vars). This keeps
the legal posture conservative — the operator opts in explicitly per host.

The parser is deliberately regex-based (no soup/lxml dep) and returns ``None``
on any parse failure rather than guessing. Callers MUST treat it as best-effort.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any

import httpx

CRICBUZZ_LIVE_URL = "https://www.cricbuzz.com/cricket-match/live-scores"

_USER_AGENTS: list[str] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]

_CACHE_TTL_SEC = 25.0
_REQUEST_TIMEOUT_SEC = 8.0

_response_cache: dict[str, tuple[float, str]] = {}


def is_enabled() -> bool:
    """Return True when the scraper should be invoked.

    Defaults to enabled locally and disabled on Vercel/Render so production
    deployments stay on the official APIs. Operators can override either way
    via ``INGESTION_LIVE_SCRAPE_ENABLED``.
    """
    raw = (os.environ.get("INGESTION_LIVE_SCRAPE_ENABLED") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    if os.environ.get("VERCEL") or os.environ.get("RENDER"):
        return False
    return True


_SCORE_RX = re.compile(
    r"\b(?P<runs>\d{1,3})[-/](?P<wkts>\d{1,2})(?:\s*\(\s*(?P<overs>\d+(?:\.\d)?)\s*(?:ov|overs)?\s*\))?",
    re.I,
)
_RRR_RX = re.compile(r"\bRRR\s*[:\-]?\s*(?P<v>[\d.]+)", re.I)
_CRR_RX = re.compile(r"\bCRR\s*[:\-]?\s*(?P<v>[\d.]+)", re.I)
_NEED_RX = re.compile(
    r"\bneed(?:s|ed)?\s+(?P<runs>\d+)\s+runs?\s+(?:in|off|from)\s+(?P<balls>\d+)\s+balls?",
    re.I,
)
_TARGET_RX = re.compile(r"\btarget(?:\s+of)?\s*[:\-]?\s*(?P<v>\d{1,3})", re.I)
_INNINGS_BREAK_RX = re.compile(r"\binnings?\s+break\b", re.I)
_COMPLETED_RX = re.compile(
    r"\b(won by|match (?:tied|drawn|abandoned)|stumps|no result)\b", re.I,
)


def _strip_html(html: str) -> str:
    """Convert HTML to a single-line plain text with ``|`` block separators."""
    s = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", " ", html, flags=re.I)
    s = re.sub(r"<style\b[^>]*>[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"</(?:div|li|p|tr|h\d|section|article|a)>", " | ", s, flags=re.I)
    s = re.sub(r"<br\s*/?>", " | ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    s = re.sub(r"\s*\|\s*(?:\|\s*)+", " | ", s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s


def _split_blocks(plain: str) -> list[str]:
    raw_blocks = [b.strip() for b in plain.split(" | ") if b.strip()]
    if not raw_blocks:
        return []

    blocks: list[str] = []
    window: list[str] = []
    for chunk in raw_blocks:
        window.append(chunk)
        joined = " | ".join(window)
        scores_in_window = _SCORE_RX.findall(joined)
        if len(scores_in_window) >= 2 or len(joined) > 600:
            blocks.append(joined)
            window = []
    if window:
        blocks.append(" | ".join(window))
    return blocks


def _score_relevance(text: str, tokens: list[str]) -> int:
    if not tokens:
        return 0
    low = text.lower()
    score = 0
    for tok in tokens:
        if not tok or len(tok) < 2:
            continue
        if tok.lower() in low:
            score += 2 if len(tok) >= 4 else 1
    return score


def _safe_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def _safe_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _detect_format(block: str) -> str:
    low = block.lower()
    if "test" in low and "test match" in low:
        return "Test"
    if re.search(r"\bt20\b|\btwenty20\b|\bt20i\b", low):
        return "T20"
    if re.search(r"\bodi\b|\bone day\b|\b50[-\s]?over\b", low):
        return "ODI"
    return "T20"


def _detect_status(block: str) -> str:
    if _COMPLETED_RX.search(block):
        return "completed"
    if _INNINGS_BREAK_RX.search(block):
        return "innings_break"
    if re.search(r"\blive\b", block, re.I):
        return "live"
    return "live"


def _extract_team_codes(block: str) -> list[str]:
    """Pull leading 2-4 letter team abbreviations adjacent to scoreline patterns."""
    codes: list[str] = []
    for m in _SCORE_RX.finditer(block):
        start = m.start()
        prefix = block[max(0, start - 80) : start]
        for code_match in re.finditer(r"\b([A-Z]{2,4})\b", prefix):
            codes.append(code_match.group(1))
    seen: set[str] = set()
    out: list[str] = []
    for c in codes:
        if c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out[:6]


def _build_struct(block: str, tokens: list[str]) -> dict[str, Any] | None:
    scores = list(_SCORE_RX.finditer(block))
    if not scores:
        return None

    target = None
    target_match = _TARGET_RX.search(block)
    if target_match:
        target = _safe_int(target_match.group("v"))

    innings_count = len(scores)
    second_innings_present = innings_count >= 2 or target is not None

    last = scores[-1]
    runs = _safe_int(last.group("runs"))
    wkts = _safe_int(last.group("wkts"))
    overs = _safe_float(last.group("overs"))
    if runs is None or wkts is None:
        return None

    rrr = None
    rrr_match = _RRR_RX.search(block)
    if rrr_match:
        rrr = _safe_float(rrr_match.group("v"))

    crr = None
    crr_match = _CRR_RX.search(block)
    if crr_match:
        crr = _safe_float(crr_match.group("v"))
    if crr is None and overs and overs > 0:
        crr = round(runs / overs, 2)

    runs_needed = None
    balls_left = None
    need_match = _NEED_RX.search(block)
    if need_match:
        runs_needed = _safe_int(need_match.group("runs"))
        balls_left = _safe_int(need_match.group("balls"))
        if rrr is None and runs_needed is not None and balls_left and balls_left > 0:
            rrr = round((runs_needed / balls_left) * 6, 2)

    fmt = _detect_format(block)
    status = _detect_status(block)
    if target is not None and runs is not None and runs >= target and second_innings_present:
        status = "completed"

    inning = "2nd" if second_innings_present else "1st"

    codes = _extract_team_codes(block)
    batting_team = codes[-1] if codes else ""
    bowling_team = codes[0] if len(codes) >= 2 and codes[0] != batting_team else ""
    if not bowling_team and len(codes) >= 1 and codes[0] != batting_team:
        bowling_team = codes[0]

    parts: list[str] = []
    if batting_team:
        parts.append(f"{batting_team} {runs}/{wkts}")
    else:
        parts.append(f"{runs}/{wkts}")
    if overs is not None:
        parts[-1] += f" ({overs} ov)"
    if target is not None:
        parts.append(f"chasing {target}")
    if runs_needed is not None and balls_left is not None:
        parts.append(f"need {runs_needed} in {balls_left}")
    if rrr is not None:
        parts.append(f"RRR {rrr}")
    snippet = ", ".join(parts)

    return {
        "runs": runs,
        "wickets": wkts,
        "overs": overs,
        "target": target,
        "inning": inning,
        "format": fmt,
        "batting_team": batting_team,
        "bowling_team": bowling_team,
        "rrr": rrr,
        "crr": crr,
        "balls_left": balls_left,
        "runs_needed": runs_needed,
        "status": status,
        "snippet": snippet,
        "_relevance": _score_relevance(block, tokens),
        "_raw_block": block[:600],
    }


async def _fetch_html(client: httpx.AsyncClient) -> str | None:
    cached = _response_cache.get(CRICBUZZ_LIVE_URL)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]

    ua = _USER_AGENTS[int(time.time()) % len(_USER_AGENTS)]
    try:
        r = await client.get(
            CRICBUZZ_LIVE_URL,
            timeout=_REQUEST_TIMEOUT_SEC,
            headers={
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-IN,en;q=0.9",
            },
        )
    except (httpx.HTTPError, httpx.TimeoutException):
        return None

    if r.status_code != 200:
        return None
    text = r.text
    if not text or len(text) < 500:
        return None
    _response_cache[CRICBUZZ_LIVE_URL] = (time.time(), text)
    return text


async def fetch_cricbuzz_live(
    client: httpx.AsyncClient,
    *,
    tokens: list[str],
) -> dict[str, Any]:
    """Return ``{"struct": ..., "error": ..., "ok": bool}``.

    ``struct`` is None when scraping is disabled, the page is unreachable, or
    no candidate match meets the relevance threshold for the current fixture.
    """
    if not is_enabled():
        return {"struct": None, "error": None, "ok": False, "disabled": True}

    html = await _fetch_html(client)
    if html is None:
        return {"struct": None, "error": "fetch_failed", "ok": False}

    try:
        plain = _strip_html(html)
        blocks = _split_blocks(plain)
    except (re.error, ValueError) as e:  # noqa: BLE001
        return {"struct": None, "error": f"parse_failed: {e}", "ok": False}

    candidates: list[dict[str, Any]] = []
    for block in blocks:
        rel = _score_relevance(block, tokens)
        if rel < 1 and tokens:
            continue
        struct = _build_struct(block, tokens)
        if struct is None:
            continue
        candidates.append(struct)

    if not candidates:
        return {"struct": None, "error": None, "ok": True}

    candidates.sort(key=lambda s: int(s.get("_relevance") or 0), reverse=True)
    best = candidates[0]
    if tokens and int(best.get("_relevance") or 0) < 1:
        return {"struct": None, "error": None, "ok": True}
    return {"struct": best, "error": None, "ok": True}
