from pydantic import BaseModel


class Verdict(BaseModel):
    winner: str
    confidence: int
    score_range: str
    key_player: str
    swing_factor: str
    summary: str
