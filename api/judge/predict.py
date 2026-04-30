"""
POST /api/judge/predict — Vercel Python serverless function.

Replaces the Node proxy that used to forward to a separate uvicorn Judge
service. Reads { match_id, debate_transcript } → runs the Judge LLM call →
stores the prediction in Supabase → returns { prediction_id, verdict, accuracy }.

Auth: when WAR_ROOM_API_SECRET is set on Vercel, the browser must send
`Authorization: Bearer <that secret>` (already wired in ai_cricket_war_room.js).

Hardening (Phase 4 in migration plan):
  - Prompt-injection check on `match_id` (Phase 4.1).
  - Length cap on `debate_transcript` (Phase 4.1).
  - Server-side verdict validation runs inside `judge_service.judge.run_judge`
    (clamps confidence 35–95, asserts winner is one of the two playing teams).
  - Unhandled exceptions reported to Sentry when SENTRY_DSN is set (Phase 4.3).
"""

from __future__ import annotations

import json

from _cache import cache_setex
from _sanitize import InvalidInput, clamp_transcript, sanitize_match_id
from _shared import JsonHandler, capture_exception, get_store, war_room_bearer_ok

MAX_BODY_BYTES = 200_000  # mirrors MAX_BODY_JUDGE_BYTES on the Node side
ACCURACY_REDIS_KEY = "warroom:judge:accuracy:v1"
ACCURACY_TTL_SECONDS = 3600


class handler(JsonHandler):  # noqa: N801 (Vercel requires lowercase `handler`)
    def do_POST(self) -> None:  # noqa: N802
        if not war_room_bearer_ok(self.headers.get("Authorization")):
            self._send_json(401, {"error": {"message": "unauthorized"}})
            return

        try:
            body = self._read_json_body(max_bytes=MAX_BODY_BYTES)
        except ValueError as e:
            code = str(e).split(":", 1)[0]
            status = 413 if code == "payload_too_large" else 400
            self._send_json(status, {"error": code, "message": str(e)})
            return

        try:
            match_id = sanitize_match_id(body.get("match_id"))
            debate_transcript = clamp_transcript(body.get("debate_transcript"))
        except InvalidInput:
            self._send_json(
                400,
                {"error": "invalid_input", "message": "match_id failed injection check"},
            )
            return

        if not match_id or not debate_transcript:
            self._send_json(
                400,
                {"error": "invalid_input", "message": "match_id and debate_transcript are required"},
            )
            return

        # Lazy imports keep cold-start cost on the failing-auth path near zero.
        from judge_service.judge import run_judge

        try:
            verdict = run_judge(debate_transcript, match_id)
        except ValueError as e:
            # Judge ran but produced unusable output (bad JSON, wrong team, etc).
            # Not worth a Sentry alert — these are model misbehaviour, not bugs.
            self._send_json(400, {"error": "invalid_verdict", "message": str(e)})
            return
        except RuntimeError as e:
            # Misconfiguration (no LLM key) — alert ops.
            capture_exception(e, stage="judge_run", match_id=match_id)
            self._send_json(500, {"error": "judge_misconfigured", "message": str(e)})
            return
        except Exception as e:
            capture_exception(e, stage="judge_run", match_id=match_id)
            self._send_json(502, {"error": "llm_upstream_failed", "message": str(e)})
            return

        try:
            store = get_store()
            prediction_id = store.record_prediction(match_id, verdict.winner, verdict.confidence)
            stats = store.running_accuracy()
        except RuntimeError as e:
            capture_exception(e, stage="store", match_id=match_id)
            self._send_json(500, {"error": "store_misconfigured", "message": str(e)})
            return
        except Exception as e:
            capture_exception(e, stage="store_write", match_id=match_id)
            self._send_json(500, {"error": "store_write_failed", "message": str(e)})
            return

        accuracy_payload = {
            "total_settled": stats.total_settled,
            "correct": stats.correct,
            "accuracy": stats.accuracy,
        }

        # Refresh the accuracy cache opportunistically. We just computed fresh
        # stats anyway, so push them to Redis to absorb the next /accuracy poll
        # without an extra Supabase round-trip.
        try:
            cache_setex(ACCURACY_REDIS_KEY, ACCURACY_TTL_SECONDS, json.dumps(accuracy_payload))
        except Exception:
            pass

        self._send_json(
            200,
            {
                "prediction_id": prediction_id,
                "verdict": verdict.model_dump(),
                "accuracy": accuracy_payload,
            },
        )
