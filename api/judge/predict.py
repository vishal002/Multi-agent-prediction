"""
POST /api/judge/predict — Vercel Python serverless function.

Replaces the Node proxy that used to forward to a separate uvicorn Judge
service. Reads { match_id, debate_transcript } → runs the Judge LLM call →
stores the prediction in Supabase → returns { prediction_id, verdict, accuracy }.

Auth: when WAR_ROOM_API_SECRET is set on Vercel, the browser must send
`Authorization: Bearer <that secret>` (already wired in ai_cricket_war_room.js).
"""

from __future__ import annotations

from _shared import JsonHandler, get_store, war_room_bearer_ok

MAX_BODY_BYTES = 200_000  # mirrors MAX_BODY_JUDGE_BYTES on the Node side


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

        match_id = str(body.get("match_id") or "").strip()
        debate_transcript = str(body.get("debate_transcript") or "").strip()
        if not match_id or not debate_transcript:
            self._send_json(
                400,
                {"error": "invalid_input", "message": "match_id and debate_transcript are required"},
            )
            return
        if len(debate_transcript) > MAX_BODY_BYTES:
            self._send_json(413, {"error": "payload_too_large"})
            return

        # Lazy imports keep cold-start cost on the failing-auth path near zero.
        from judge_service.judge import run_judge

        try:
            verdict = run_judge(debate_transcript, match_id)
        except ValueError as e:
            self._send_json(400, {"error": "invalid_verdict", "message": str(e)})
            return
        except RuntimeError as e:
            self._send_json(500, {"error": "judge_misconfigured", "message": str(e)})
            return
        except Exception as e:
            self._send_json(502, {"error": "llm_upstream_failed", "message": str(e)})
            return

        try:
            store = get_store()
            prediction_id = store.record_prediction(match_id, verdict.winner, verdict.confidence)
            stats = store.running_accuracy()
        except RuntimeError as e:
            self._send_json(500, {"error": "store_misconfigured", "message": str(e)})
            return
        except Exception as e:
            self._send_json(500, {"error": "store_write_failed", "message": str(e)})
            return

        self._send_json(
            200,
            {
                "prediction_id": prediction_id,
                "verdict": verdict.model_dump(),
                "accuracy": {
                    "total_settled": stats.total_settled,
                    "correct": stats.correct,
                    "accuracy": stats.accuracy,
                },
            },
        )
