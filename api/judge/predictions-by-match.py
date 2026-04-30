"""
GET /api/judge/predictions-by-match?match_id=<label>&limit=<n> — Vercel Python.

Powers the "View AI pre-match prediction" affordance on completed match
cards. Returns 404 when nothing is on file (so the UI can render a distinct
empty state instead of treating an empty list as a load error — matches the
old FastAPI behaviour).
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from _shared import JsonHandler, capture_exception, get_store


class handler(JsonHandler):  # noqa: N801
    def do_GET(self) -> None:  # noqa: N802
        qs = parse_qs(urlparse(self.path).query)
        match_id = (qs.get("match_id", [""])[0] or "").strip()
        limit_raw = (qs.get("limit", ["5"])[0] or "5").strip()

        if not match_id:
            self._send_json(400, {"error": "missing_match_id"})
            return

        try:
            limit = max(1, min(int(limit_raw), 50))
        except ValueError:
            limit = 5

        try:
            rows = get_store().get_predictions_by_match(match_id, limit=limit)
        except RuntimeError as e:
            capture_exception(e, stage="predictions_by_match", match_id=match_id)
            self._send_json(500, {"error": "store_misconfigured", "message": str(e)})
            return
        except Exception as e:
            capture_exception(e, stage="predictions_by_match", match_id=match_id)
            self._send_json(500, {"error": "store_read_failed", "message": str(e)})
            return

        if not rows:
            self._send_json(404, {"error": "no_predictions", "match_id": match_id})
            return

        self._send_json(
            200,
            {
                "match_id": match_id,
                "predictions": [
                    {
                        "id": r.id,
                        "match_id": r.match_id,
                        "predicted_winner": r.predicted_winner,
                        "actual_winner": r.actual_winner,
                        "confidence": r.confidence,
                        "created_at": r.created_at,
                    }
                    for r in rows
                ],
            },
        )
