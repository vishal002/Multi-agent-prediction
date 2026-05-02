"""
GET /api/judge/recent-settled?limit=<n> — Vercel Python.

Returns latest Judge predictions that already have actual_winner set,
for the public accuracy ledger (same shape as Node proxy → FastAPI).
"""

from __future__ import annotations

import os as _os
import sys as _sys

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.abspath(_os.path.join(_HERE, "..", ".."))
for _p in (_HERE, _ROOT):
    if _p not in _sys.path:
        _sys.path.insert(0, _p)

from urllib.parse import parse_qs, urlparse

from _shared import JsonHandler, capture_exception, get_store


class handler(JsonHandler):  # noqa: N801
    def do_GET(self) -> None:  # noqa: N802
        qs = parse_qs(urlparse(self.path).query)
        limit_raw = (qs.get("limit", ["20"])[0] or "20").strip()
        try:
            limit = max(1, min(int(limit_raw), 100))
        except ValueError:
            limit = 20

        try:
            rows = get_store().recent_settled_predictions(limit=limit)
        except RuntimeError as e:
            capture_exception(e, stage="recent_settled")
            self._send_json(500, {"error": "store_misconfigured", "message": str(e)})
            return
        except Exception as e:
            capture_exception(e, stage="recent_settled")
            self._send_json(500, {"error": "store_read_failed", "message": str(e)})
            return

        self._send_json(
            200,
            {
                "predictions": [
                    {
                        "id": r.id,
                        "match_id": r.match_id,
                        "predicted_winner": r.predicted_winner,
                        "actual_winner": r.actual_winner,
                        "confidence": r.confidence,
                        "created_at": r.created_at,
                        "correct": str(r.predicted_winner).strip().upper()
                        == str(r.actual_winner or "").strip().upper(),
                    }
                    for r in rows
                ],
            },
        )
