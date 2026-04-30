"""Clamp and sanity-check Judge verdict before persistence."""

from __future__ import annotations

import re

from judge_service.models import Verdict


def _team_tokens_from_match_id(match_id: str) -> set[str]:
    """Tokens derived from a fixture label (codes like CSK + headline words)."""
    s = (match_id or "").strip()
    out: set[str] = set()
    if not s:
        return out
    parts = re.split(r"\s+vs\.?\s+", s, maxsplit=1, flags=re.I)
    chunks = parts if len(parts) >= 2 else [s]
    for chunk in chunks:
        for m in re.finditer(r"\b[A-Z]{2,4}\b", chunk.upper()):
            out.add(m.group(0))
        for m in re.finditer(r"\b[A-Za-z]{2,}\b", chunk):
            out.add(m.group(0).upper())
    return {t for t in out if t and t not in {"IPL", "THE", "AND", "MATCH"}}


def validate_verdict_for_match(verdict: Verdict, match_id: str) -> Verdict:
    tokens = _team_tokens_from_match_id(match_id)
    w = verdict.winner.strip()
    wu = w.upper()
    if tokens and wu not in ("UNCERTAIN", "TIE", "DRAW"):
        if not any(wu == t or wu in t or t in wu for t in tokens):
            raise ValueError(f"invalid_winner:{w!r}")

    c = int(verdict.confidence)
    c = max(35, min(95, c))

    return verdict.model_copy(update={"confidence": c})
