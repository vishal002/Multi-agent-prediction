"""
Judge agent: one Claude call over the full debate transcript → structured Verdict.
"""

import json
import os
import re

from anthropic import Anthropic
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


def run_judge(debate_transcript: str, *, client: Anthropic | None = None) -> Verdict:
    """
    Call Claude once with the full debate, return a validated Verdict.

    Environment: ANTHROPIC_API_KEY must be set unless `client` is injected (tests).
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if client is None and not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required for the Judge (Claude).")

    anthropic = client or Anthropic(api_key=api_key)
    model = os.environ.get("ANTHROPIC_JUDGE_MODEL", "claude-sonnet-4-20250514").strip()

    user_content = (
        "DEBATE TRANSCRIPT (complete):\n\n"
        + (debate_transcript or "").strip()
        + "\n\nRespond with ONLY the JSON object described in your instructions."
    )

    message = anthropic.messages.create(
        model=model,
        max_tokens=1024,
        temperature=0.2,
        system=JUDGE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    text_parts: list[str] = []
    for block in message.content:
        if hasattr(block, "text"):
            text_parts.append(block.text)
        elif isinstance(block, dict) and block.get("type") == "text":
            text_parts.append(str(block.get("text", "")))
    raw = "".join(text_parts)
    json_str = _extract_json_object(raw)

    try:
        return Verdict.model_validate_json(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Judge returned non-JSON: {e!s}\n---\n{raw[:2000]}") from e
    except ValidationError as e:
        raise ValueError(f"Judge JSON did not match Verdict: {e}\n---\n{raw[:2000]}") from e
