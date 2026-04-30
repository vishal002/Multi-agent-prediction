"""
Prompt-injection sanitisation for the Vercel Python /api/judge/* handlers.

Mirrors lib/sanitize.js so the Python and Node sides apply identical rules
(Phase 4.1 in the migration plan). Centralised here so both predict.py and
any future Python handler can reuse it.

Raises InvalidInput on hits — caller should surface as HTTP 400 invalid_input
(same shape as /api/messages on the Node side).
"""

from __future__ import annotations

import re

# Same regexes as lib/sanitize.js — keep these two lists in sync.
_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ignore (previous|all|prior) instructions", re.IGNORECASE),
    re.compile(r"you are now", re.IGNORECASE),
    re.compile(r"act as (a|an|the)", re.IGNORECASE),
    re.compile(r"system prompt", re.IGNORECASE),
    re.compile(r"\bDAN\b"),
    re.compile(r"forget (everything|what|your)", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"bypass", re.IGNORECASE),
]


class InvalidInput(ValueError):
    """Raised when an input string trips the injection allow-list."""


def sanitize_input(value: object, *, max_len: int = 280) -> str:
    """Return a trimmed/clamped string. Raises InvalidInput on injection hits."""
    if value is None or not isinstance(value, str):
        return ""
    if any(p.search(value) for p in _INJECTION_PATTERNS):
        raise InvalidInput("invalid_input")
    return value.strip()[:max_len]


def sanitize_match_id(value: object) -> str:
    """`match_id` is a fixture label like 'CSK vs MI' — short, no injection."""
    return sanitize_input(value, max_len=512)


def clamp_transcript(value: object, *, max_len: int = 200_000) -> str:
    """Debate transcripts are LLM-generated, so we only enforce a length cap.

    Pattern-checking the transcript would produce false positives on legitimate
    cricket commentary (e.g. 'ignore the spin advantage'). The user-supplied
    notes that *feed* into the transcript are sanitized upstream by
    `sanitizeAnthropicMessagesBody` on the Node /api/messages endpoint.
    """
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]
