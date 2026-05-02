"""
Supabase-backed predictions store (Postgres via supabase-py).
Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the Judge process.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from judge_service.predictions_db import AccuracyStats, PredictionRow


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class SupabasePredictionsStore:
    """Drop-in replacement for PredictionsStore when env is configured."""

    def __init__(self, url: str, key: str) -> None:
        from supabase import create_client

        self._client = create_client(url.strip(), key.strip())

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
        row = {
            "match_id": match_id.strip(),
            "predicted_winner": predicted_winner.strip(),
            "actual_winner": None,
            "confidence": int(confidence),
            "created_at": ts,
        }
        # supabase-py 2.x returns the inserted row(s) in `.data` by default
        # (Prefer: return=representation). Chaining `.select("id")` after
        # `.insert()` was a 1.x pattern and now raises:
        #   'SyncQueryRequestBuilder' object has no attribute 'select'
        res = self._client.table("judge_predictions").insert(row).execute()
        rows = res.data or []
        if not rows or "id" not in rows[0]:
            raise RuntimeError("Supabase insert returned no id")
        return int(rows[0]["id"])

    def set_actual_winner(self, prediction_id: int, actual_winner: str) -> bool:
        pred = self.get_prediction(prediction_id)
        if not pred or pred.actual_winner:
            return False
        aw = actual_winner.strip()
        self._client.table("judge_predictions").update({"actual_winner": aw}).eq(
            "id", int(prediction_id)
        ).execute()
        was_correct = pred.predicted_winner.strip().upper() == aw.upper()
        self._client.table("accuracy_log").insert(
            {
                "prediction_id": int(prediction_id),
                "actual_winner": aw,
                "was_correct": was_correct,
            }
        ).execute()
        return True

    def set_actual_winner_by_match(
        self,
        match_id: str,
        actual_winner: str,
        *,
        only_latest: bool = True,
    ) -> int:
        mid = match_id.strip()
        rows = (
            self._client.table("judge_predictions")
            .select("id")
            .eq("match_id", mid)
            .is_("actual_winner", "null")
            .order("id", desc=True)
            .limit(50)
            .execute()
        )
        data = rows.data or []
        if not data:
            return 0
        targets = [data[0]["id"]] if only_latest else [r["id"] for r in data]
        n = 0
        for pid in targets:
            if self.set_actual_winner(int(pid), actual_winner):
                n += 1
        return n

    def running_accuracy(self) -> AccuracyStats:
        res = (
            self._client.table("judge_predictions")
            .select("predicted_winner, actual_winner")
            .not_.is_("actual_winner", "null")
            .execute()
        )
        rows = res.data or []
        total = len(rows)
        if not total:
            return AccuracyStats(total_settled=0, correct=0, accuracy=None)
        correct = sum(
            1
            for r in rows
            if str(r.get("predicted_winner", "")).strip().upper()
            == str(r.get("actual_winner", "")).strip().upper()
        )
        acc = correct / total if total else None
        return AccuracyStats(total_settled=total, correct=correct, accuracy=acc)

    def get_prediction(self, prediction_id: int) -> Optional[PredictionRow]:
        res = (
            self._client.table("judge_predictions")
            .select("id, match_id, predicted_winner, actual_winner, confidence, created_at")
            .eq("id", int(prediction_id))
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        r = rows[0]
        return PredictionRow(
            id=int(r["id"]),
            match_id=str(r["match_id"]),
            predicted_winner=str(r["predicted_winner"]),
            actual_winner=r.get("actual_winner"),
            confidence=int(r["confidence"]),
            created_at=str(r["created_at"]),
        )

    def get_predictions_by_match(self, match_id: str, *, limit: int = 5) -> list[PredictionRow]:
        mid = (match_id or "").strip()
        if not mid:
            return []
        n = max(1, min(int(limit), 50))
        res = (
            self._client.table("judge_predictions")
            .select("id, match_id, predicted_winner, actual_winner, confidence, created_at")
            .eq("match_id", mid)
            .order("id", desc=True)
            .limit(n)
            .execute()
        )
        out: list[PredictionRow] = []
        for r in res.data or []:
            out.append(
                PredictionRow(
                    id=int(r["id"]),
                    match_id=str(r["match_id"]),
                    predicted_winner=str(r["predicted_winner"]),
                    actual_winner=r.get("actual_winner"),
                    confidence=int(r["confidence"]),
                    created_at=str(r["created_at"]),
                )
            )
        return out

    def recent_settled_predictions(self, *, limit: int = 20) -> list[PredictionRow]:
        n = max(1, min(int(limit), 100))
        res = (
            self._client.table("judge_predictions")
            .select("id, match_id, predicted_winner, actual_winner, confidence, created_at")
            .not_.is_("actual_winner", "null")
            .order("id", desc=True)
            .limit(n)
            .execute()
        )
        out: list[PredictionRow] = []
        for r in res.data or []:
            out.append(
                PredictionRow(
                    id=int(r["id"]),
                    match_id=str(r["match_id"]),
                    predicted_winner=str(r["predicted_winner"]),
                    actual_winner=r.get("actual_winner"),
                    confidence=int(r["confidence"]),
                    created_at=str(r["created_at"]),
                )
            )
        return out


def supabase_configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL", "").strip() and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip())
