"""
SQLite persistence for predictions and running accuracy.

Schema (table `predictions`):
  id, match_id, predicted_winner, actual_winner, confidence, created_at
"""

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "war_room.db"

CREATE_SQL = """
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
"""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class PredictionRow:
    id: int
    match_id: str
    predicted_winner: str
    actual_winner: Optional[str]
    confidence: int
    created_at: str


@dataclass
class AccuracyStats:
    """Counts among rows where the match has an actual result recorded."""

    total_settled: int
    correct: int
    accuracy: Optional[float]


class PredictionsStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._path = Path(db_path) if db_path else DEFAULT_DB_PATH

    @contextmanager
    def _conn(self) -> Generator[sqlite3.Connection, None, None]:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        try:
            conn.executescript(CREATE_SQL)
            conn.commit()
            yield conn
        finally:
            conn.close()

    def record_prediction(
        self,
        match_id: str,
        predicted_winner: str,
        confidence: int,
        *,
        created_at: Optional[str] = None,
    ) -> int:
        ts = created_at or _utc_now_iso()
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO predictions (match_id, predicted_winner, actual_winner, confidence, created_at)
                VALUES (?, ?, NULL, ?, ?)
                """,
                (match_id.strip(), predicted_winner.strip(), int(confidence), ts),
            )
            conn.commit()
            return int(cur.lastrowid)

    def set_actual_winner(self, prediction_id: int, actual_winner: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE predictions SET actual_winner = ? WHERE id = ?
                """,
                (actual_winner.strip(), int(prediction_id)),
            )
            conn.commit()
            return cur.rowcount > 0

    def set_actual_winner_by_match(
        self,
        match_id: str,
        actual_winner: str,
        *,
        only_latest: bool = True,
    ) -> int:
        """Attach the real result to prediction row(s) for this match. Returns rows updated."""
        mid = match_id.strip()
        aw = actual_winner.strip()
        with self._conn() as conn:
            if only_latest:
                cur = conn.execute(
                    """
                    UPDATE predictions SET actual_winner = ?
                    WHERE id = (
                      SELECT id FROM predictions
                      WHERE match_id = ? AND actual_winner IS NULL
                      ORDER BY id DESC LIMIT 1
                    )
                    """,
                    (aw, mid),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE predictions SET actual_winner = ?
                    WHERE match_id = ? AND actual_winner IS NULL
                    """,
                    (aw, mid),
                )
            conn.commit()
            return cur.rowcount

    def running_accuracy(self) -> AccuracyStats:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT
                  COUNT(*) AS total_settled,
                  SUM(CASE WHEN predicted_winner = actual_winner THEN 1 ELSE 0 END) AS correct
                FROM predictions
                WHERE actual_winner IS NOT NULL
                """
            ).fetchone()
        total = int(row["total_settled"] or 0)
        correct = int(row["correct"] or 0)
        acc = (correct / total) if total else None
        return AccuracyStats(total_settled=total, correct=correct, accuracy=acc)

    def get_prediction(self, prediction_id: int) -> Optional[PredictionRow]:
        with self._conn() as conn:
            r = conn.execute(
                "SELECT * FROM predictions WHERE id = ?",
                (int(prediction_id),),
            ).fetchone()
        if not r:
            return None
        return PredictionRow(
            id=int(r["id"]),
            match_id=str(r["match_id"]),
            predicted_winner=str(r["predicted_winner"]),
            actual_winner=r["actual_winner"],
            confidence=int(r["confidence"]),
            created_at=str(r["created_at"]),
        )
