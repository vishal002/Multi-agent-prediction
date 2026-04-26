"""
Persistence for predictions and running accuracy.

Backends:
  - **Turso / libSQL (recommended for serverless):** set `TURSO_DATABASE_URL` and
    `TURSO_AUTH_TOKEN`. Requires `pip install libsql`. Data survives process restarts.
  - **File SQLite (default):** `WAR_ROOM_DB_PATH` or `data/war_room.db` under the repo.

Schema (table `predictions`):
  id, match_id, predicted_winner, actual_winner, confidence, created_at
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "war_room.db"

SCHEMA_STMTS = [
    """
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  predicted_winner TEXT NOT NULL,
  actual_winner TEXT,
  confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
""".strip(),
    "CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);",
    "CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at);",
]


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


def _turso_config() -> tuple[str, str] | None:
    url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
    if url and token:
        return (url, token)
    return None


class PredictionsStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._turso = _turso_config()

    @property
    def uses_remote_db(self) -> bool:
        return self._turso is not None

    @contextmanager
    def _conn(self) -> Generator[sqlite3.Connection | object, None, None]:
        if self._turso:
            try:
                import libsql
            except ImportError as e:  # pragma: no cover
                raise RuntimeError(
                    "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set but `libsql` is not "
                    "installed. Run: pip install libsql"
                ) from e

            url, token = self._turso
            conn = libsql.connect(database=url, auth_token=token)
            try:
                for stmt in SCHEMA_STMTS:
                    conn.execute(stmt)
                conn.commit()
                yield conn
            finally:
                closer = getattr(conn, "close", None)
                if callable(closer):
                    closer()

        else:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self._path)
            conn.row_factory = sqlite3.Row
            try:
                conn.executescript("\n".join(SCHEMA_STMTS))
                conn.commit()
                yield conn
            finally:
                conn.close()

    @staticmethod
    def _rowcount(cur: object) -> int:
        rc = getattr(cur, "rowcount", None)
        if isinstance(rc, int) and rc >= 0:
            return rc
        return 0

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
                RETURNING id
                """,
                (match_id.strip(), predicted_winner.strip(), int(confidence), ts),
            )
            row = cur.fetchone()
            conn.commit()
            if not row:
                raise RuntimeError("INSERT returned no id")
            return int(row[0])

    def set_actual_winner(self, prediction_id: int, actual_winner: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE predictions SET actual_winner = ? WHERE id = ?
                """,
                (actual_winner.strip(), int(prediction_id)),
            )
            n = self._rowcount(cur)
            conn.commit()
            return n > 0

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
            n = self._rowcount(cur)
            conn.commit()
            return n

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
        if not row:
            return AccuracyStats(total_settled=0, correct=0, accuracy=None)
        total = int(row[0] or 0)
        correct = int(row[1] or 0)
        acc = (correct / total) if total else None
        return AccuracyStats(total_settled=total, correct=correct, accuracy=acc)

    def get_prediction(self, prediction_id: int) -> Optional[PredictionRow]:
        with self._conn() as conn:
            r = conn.execute(
                """
                SELECT id, match_id, predicted_winner, actual_winner, confidence, created_at
                FROM predictions WHERE id = ?
                """,
                (int(prediction_id),),
            ).fetchone()
        if not r:
            return None
        return PredictionRow(
            id=int(r[0]),
            match_id=str(r[1]),
            predicted_winner=str(r[2]),
            actual_winner=r[3],
            confidence=int(r[4]),
            created_at=str(r[5]),
        )
