"""
FastAPI service: POST /predict runs the Judge and stores a row; result hooks update accuracy.
"""

import os
from pathlib import Path
from typing import Annotated, Any, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from judge_service.judge import run_judge
from judge_service.models import Verdict
from judge_service.predictions_db import PredictionsStore

app = FastAPI(title="Cricket War Room — Judge", version="0.1.0")

_store: Optional[PredictionsStore] = None


def _judge_secret_expected() -> str | None:
    s = os.environ.get("JUDGE_SERVICE_SECRET", "").strip()
    return s or None


def verify_judge_service_auth(
    authorization: Annotated[str | None, Header()] = None,
    x_judge_secret: Annotated[str | None, Header(alias="X-Judge-Secret")] = None,
) -> None:
    """When JUDGE_SERVICE_SECRET is set, require Bearer token or X-Judge-Secret header."""
    expected = _judge_secret_expected()
    if not expected:
        return
    token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_judge_secret and x_judge_secret.strip():
        token = x_judge_secret.strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


JudgeAuth = Annotated[None, Depends(verify_judge_service_auth)]


def get_store() -> PredictionsStore:
    global _store
    if _store is None:
        path = os.environ.get("WAR_ROOM_DB_PATH", "").strip() or None
        _store = PredictionsStore(path)
    return _store


class PredictRequest(BaseModel):
    match_id: str = Field(..., min_length=1, max_length=512)
    debate_transcript: str = Field(..., min_length=1, max_length=200_000)


class PredictResponse(BaseModel):
    prediction_id: int
    verdict: Verdict
    accuracy: dict[str, Any]


class SetResultRequest(BaseModel):
    actual_winner: str = Field(..., min_length=1)


class SetResultByMatchRequest(BaseModel):
    match_id: str
    actual_winner: str
    only_latest: bool = True


@app.post("/predict", response_model=PredictResponse)
def predict(_auth: JudgeAuth, body: PredictRequest) -> PredictResponse:
    verdict = run_judge(body.debate_transcript)
    store = get_store()
    pid = store.record_prediction(
        body.match_id,
        verdict.winner,
        verdict.confidence,
    )
    stats = store.running_accuracy()
    return PredictResponse(
        prediction_id=pid,
        verdict=verdict,
        accuracy={
            "total_settled": stats.total_settled,
            "correct": stats.correct,
            "accuracy": stats.accuracy,
        },
    )


@app.patch("/predictions/{prediction_id}/result")
def patch_result(_auth: JudgeAuth, prediction_id: int, body: SetResultRequest) -> dict[str, Any]:
    store = get_store()
    if not store.set_actual_winner(prediction_id, body.actual_winner):
        raise HTTPException(status_code=404, detail="prediction not found")
    stats = store.running_accuracy()
    return {
        "prediction_id": prediction_id,
        "actual_winner": body.actual_winner.strip(),
        "running_accuracy": {
            "total_settled": stats.total_settled,
            "correct": stats.correct,
            "accuracy": stats.accuracy,
        },
    }


@app.post("/predictions/result-by-match")
def result_by_match(_auth: JudgeAuth, body: SetResultByMatchRequest) -> dict[str, Any]:
    store = get_store()
    n = store.set_actual_winner_by_match(
        body.match_id,
        body.actual_winner,
        only_latest=body.only_latest,
    )
    if n == 0:
        raise HTTPException(
            status_code=404,
            detail="no unset prediction for that match_id",
        )
    stats = store.running_accuracy()
    return {
        "updated_rows": n,
        "running_accuracy": {
            "total_settled": stats.total_settled,
            "correct": stats.correct,
            "accuracy": stats.accuracy,
        },
    }


@app.get("/accuracy")
def accuracy(_auth: JudgeAuth) -> dict[str, Any]:
    stats = get_store().running_accuracy()
    return {
        "total_settled": stats.total_settled,
        "correct": stats.correct,
        "accuracy": stats.accuracy,
    }
