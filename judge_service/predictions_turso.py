"""
Turso (libSQL) predictions store for production Judge persistence.
Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN on the Judge process.
"""

from __future__ import annotations

import os
from typing import Optional

from judge_service.predictions_db import AccuracyStats, PredictionRow, _utc_now_iso

_SCHEMA = """
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  predicted_winner TEXT NOT NULL,
  actual_winner TEXT,
  confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at);
""".strip()


def turso_configured() -> bool:
    return bool(
        os.environ.get("TURSO_DATABASE_URL", "").strip()
        and os.environ.get("TURSO_AUTH_TOKEN", "").strip()
    )


class TursoPredictionsStore:
    """Drop-in replacement for PredictionsStore when Turso env is configured."""

    def __init__(self, url: str, auth_token: str) -> None:
        import libsql_client

        self._client = libsql_client.create_client_sync(
            url=url.strip(),
            auth_token=auth_token.strip(),
        )
        for stmt in _SCHEMA.split(";"):
            s = stmt.strip()
            if s:
                self._client.execute(s)

    @property
    def uses_remote_db(self) -> bool:
        return True

    def record_prediction(
        self,
        match_id: str,
        predicted_winner: str,
        confidence: int,
        *,
        created_at: Optional[str] = None,
    ) -> int:
        ts = created_at or _utc_now_iso()
        res = self._client.execute(
            """
            INSERT INTO predictions (match_id, predicted_winner, actual_winner, confidence, created_at)
            VALUES (?, ?, NULL, ?, ?)
            RETURNING id
            """,
            [
                match_id.strip(),
                predicted_winner.strip(),
                int(confidence),
                ts,
            ],
        )
        if not res.rows:
            raise RuntimeError("Turso INSERT returned no id")
        return int(res.rows[0][0])

    def set_actual_winner(self, prediction_id: int, actual_winner: str) -> bool:
        pred = self.get_prediction(prediction_id)
        if not pred or pred.actual_winner:
            return False
        self._client.execute(
            "UPDATE predictions SET actual_winner = ? WHERE id = ?",
            [actual_winner.strip(), int(prediction_id)],
        )
        return True

    def set_actual_winner_by_match(
        self,
        match_id: str,
        actual_winner: str,
        *,
        only_latest: bool = True,
    ) -> int:
        mid = match_id.strip()
        aw = actual_winner.strip()
        if only_latest:
            res = self._client.execute(
                """
                UPDATE predictions SET actual_winner = ?
                WHERE id = (
                  SELECT id FROM predictions
                  WHERE match_id = ? AND actual_winner IS NULL
                  ORDER BY id DESC LIMIT 1
                )
                """,
                [aw, mid],
            )
        else:
            res = self._client.execute(
                """
                UPDATE predictions SET actual_winner = ?
                WHERE match_id = ? AND actual_winner IS NULL
                """,
                [aw, mid],
            )
        return int(res.rows_affected or 0)

    def running_accuracy(self) -> AccuracyStats:
        res = self._client.execute(
            """
            SELECT
              COUNT(*) AS total_settled,
              SUM(CASE WHEN predicted_winner = actual_winner THEN 1 ELSE 0 END) AS correct
            FROM predictions
            WHERE actual_winner IS NOT NULL
            """
        )
        if not res.rows:
            return AccuracyStats(total_settled=0, correct=0, accuracy=None)
        total = int(res.rows[0][0] or 0)
        correct = int(res.rows[0][1] or 0)
        acc = (correct / total) if total else None
        return AccuracyStats(total_settled=total, correct=correct, accuracy=acc)

    def get_prediction(self, prediction_id: int) -> Optional[PredictionRow]:
        res = self._client.execute(
            """
            SELECT id, match_id, predicted_winner, actual_winner, confidence, created_at
            FROM predictions WHERE id = ?
            """,
            [int(prediction_id)],
        )
        if not res.rows:
            return None
        r = res.rows[0]
        return PredictionRow(
            id=int(r[0]),
            match_id=str(r[1]),
            predicted_winner=str(r[2]),
            actual_winner=r[3],
            confidence=int(r[4]),
            created_at=str(r[5]),
        )

    def get_predictions_by_match(self, match_id: str, *, limit: int = 5) -> list[PredictionRow]:
        mid = (match_id or "").strip()
        if not mid:
            return []
        n = max(1, min(int(limit), 50))
        res = self._client.execute(
            """
            SELECT id, match_id, predicted_winner, actual_winner, confidence, created_at
            FROM predictions
            WHERE match_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            [mid, n],
        )
        out: list[PredictionRow] = []
        for r in res.rows or []:
            out.append(
                PredictionRow(
                    id=int(r[0]),
                    match_id=str(r[1]),
                    predicted_winner=str(r[2]),
                    actual_winner=r[3],
                    confidence=int(r[4]),
                    created_at=str(r[5]),
                )
            )
        return out

    def recent_settled_predictions(self, *, limit: int = 20) -> list[PredictionRow]:
        n = max(1, min(int(limit), 100))
        res = self._client.execute(
            """
            SELECT id, match_id, predicted_winner, actual_winner, confidence, created_at
            FROM predictions
            WHERE actual_winner IS NOT NULL
            ORDER BY id DESC
            LIMIT ?
            """,
            [n],
        )
        out: list[PredictionRow] = []
        for r in res.rows or []:
            out.append(
                PredictionRow(
                    id=int(r[0]),
                    match_id=str(r[1]),
                    predicted_winner=str(r[2]),
                    actual_winner=r[3],
                    confidence=int(r[4]),
                    created_at=str(r[5]),
                )
            )
        return out
