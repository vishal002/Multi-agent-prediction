"""
GET /api/judge/accuracy — Vercel Python serverless function.

Returns running Judge accuracy. Same response shape as the old FastAPI
endpoint and the Node proxy, so the existing front-end keeps working:
  { total_settled, correct, accuracy }

Degrades to a zero-stats payload (HTTP 200) when the upstream store fails,
matching the Node fallback in server.mjs so the UI never sees a hard 503.
"""

from __future__ import annotations

from _shared import JsonHandler, get_store


class handler(JsonHandler):  # noqa: N801
    def do_GET(self) -> None:  # noqa: N802
        try:
            stats = get_store().running_accuracy()
        except Exception:
            self._send_json(
                200,
                {"total_settled": 0, "correct": 0, "accuracy": None},
                extra_headers={"X-Judge-Accuracy-Degraded": "store-unreachable"},
            )
            return

        self._send_json(
            200,
            {
                "total_settled": stats.total_settled,
                "correct": stats.correct,
                "accuracy": stats.accuracy,
            },
        )
