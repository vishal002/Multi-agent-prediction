"""
Judge agent: one LLM call over the full debate transcript → structured Verdict.

Provider priority:
  1. Anthropic Claude  — if ANTHROPIC_API_KEY is set
  2. Groq (OpenAI-compatible) — if GROQ_API_KEY is set
"""

import json
import os
import re
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from pydantic import ValidationError

from judge_service.models import Verdict

JUDGE_SYSTEM_PROMPT = """You are the Judge for an AI cricket war room. Multiple specialist agents have debated which team is more likely to win a specific match.

Your job is to read the ENTIRE debate transcript (all rounds, Bull vs Bear or equivalent) and output a single JSON object ONLY — no markdown fences, no commentary before or after.

The JSON must have exactly these keys and string/number types as shown:
- "winner": the name of the team you predict will win (short official name, e.g. "India", "Australia", "MI", "RCB").
- "confidence": integer from 0 to 100 meaning how confident you are in that winner.
- "score_range": a brief plausible scoreband or margin description for that format (e.g. "15–25 runs" or "2–4 wickets" or "innings victory" for Tests) — one short phrase.
- "key_player": one player name who most shifts the outcome if they perform.
- "swing_factor": one short phrase for the main uncertainty or match-defining variable (weather, toss, injury, powerplay, etc.).
- "summary": 2–4 sentences explaining why the winner edges it, grounded in points both sides raised.

Rules:
- Base your verdict only on the transcript; do not invent live data not implied there.
- If the transcript does not name teams clearly, infer the two sides from context; if impossible, use "Uncertain" for winner and confidence 0.
- Output must be valid JSON parseable by a strict parser. Use double quotes for all keys and string values."""


def _extract_json_object(text: str) -> str:
    """Strip optional markdown code fences and isolate a JSON object."""
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.IGNORECASE)
    if fence:
        s = fence.group(1).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        return s[start : end + 1]
    return s


_MAX_GROQ_BACKOFF_MS = 60_000
_MAX_GROQ_429_RETRIES = 2  # 3 attempts total; mirrors server.mjs Groq gate


def _call_anthropic(debate_transcript: str, api_key: str) -> str:
    """Call Anthropic Claude and return raw text response."""
    from anthropic import Anthropic  # imported lazily so Groq path works without anthropic

    model = os.environ.get("ANTHROPIC_JUDGE_MODEL", "claude-sonnet-4-20250514").strip()
    client = Anthropic(api_key=api_key)
    user_content = (
        "DEBATE TRANSCRIPT (complete):\n\n"
        + debate_transcript.strip()
        + "\n\nRespond with ONLY the JSON object described in your instructions."
    )
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        temperature=0.2,
        system=JUDGE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    parts: list[str] = []
    for block in message.content:
        if hasattr(block, "text"):
            parts.append(block.text)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)


def _parse_groq_retry_after_ms(response: httpx.Response) -> int | None:
    """Parse Retry-After header or Groq body hints into milliseconds (capped)."""
    h = (response.headers.get("retry-after") or "").strip()
    if h.isdigit():
        sec = int(h)
        if sec > 0:
            return min(_MAX_GROQ_BACKOFF_MS, sec * 1000)
    if h:
        try:
            dt = parsedate_to_datetime(h)
            if dt is not None:
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                delta_ms = int((dt.timestamp() - time.time()) * 1000)
                if delta_ms > 0:
                    return min(_MAX_GROQ_BACKOFF_MS, delta_ms)
        except (TypeError, ValueError, OSError):
            pass
    body = response.text or ""
    m = re.search(r"try again in\s+([\d.]+)\s*(ms|s)\b", body, re.I)
    if m:
        val = float(m.group(1))
        unit = m.group(2).lower()
        ms = val if unit == "ms" else val * 1000
        if ms > 0:
            return min(_MAX_GROQ_BACKOFF_MS, int(ms))
    return None


def _call_groq(debate_transcript: str, api_key: str) -> str:
    """Call Groq via its OpenAI-compatible endpoint and return raw text response."""
    model = os.environ.get("GROQ_JUDGE_MODEL", os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")).strip()
    user_content = (
        "DEBATE TRANSCRIPT (complete):\n\n"
        + debate_transcript.strip()
        + "\n\nRespond with ONLY the JSON object described in your instructions."
    )
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
    }
    for attempt in range(_MAX_GROQ_429_RETRIES + 1):
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code == 429 and attempt < _MAX_GROQ_429_RETRIES:
            wait_ms = _parse_groq_retry_after_ms(r) or min(
                _MAX_GROQ_BACKOFF_MS, 1000 * (attempt + 1) ** 2
            )
            time.sleep(wait_ms / 1000.0)
            continue
        r.raise_for_status()
        data = r.json()
        return str(data["choices"][0]["message"]["content"])


def run_judge(debate_transcript: str) -> Verdict:
    """
    Call the best available LLM (Anthropic → Groq fallback) with the full debate.
    Returns a validated Verdict.

    Requires ANTHROPIC_API_KEY or GROQ_API_KEY to be set in the environment.
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()

    if not anthropic_key and not groq_key:
        raise RuntimeError(
            "No LLM key found for the Judge. Set ANTHROPIC_API_KEY (Claude) "
            "or GROQ_API_KEY (Groq — free tier at console.groq.com)."
        )

    if anthropic_key:
        raw = _call_anthropic(debate_transcript, anthropic_key)
    else:
        raw = _call_groq(debate_transcript, groq_key)

    json_str = _extract_json_object(raw)

    try:
        return Verdict.model_validate_json(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Judge returned non-JSON: {e!s}\n---\n{raw[:2000]}") from e
    except ValidationError as e:
        raise ValueError(f"Judge JSON did not match Verdict: {e}\n---\n{raw[:2000]}") from e
