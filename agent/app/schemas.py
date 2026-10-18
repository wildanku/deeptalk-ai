"""Shared contract types between gateway and agent (02 §7)."""

from enum import StrEnum

from pydantic import BaseModel, Field


class RiskLevel(StrEnum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    CRISIS = "crisis"


class TurnEvent(StrEnum):
    """SSE event names emitted by `POST /v1/turn`."""

    SAFETY = "safety"
    TOKEN = "token"  # noqa: S105 — SSE event name, not a credential
    STRUCTURED = "structured"
    DONE = "done"
    ERROR = "error"


class SafetyVerdict(BaseModel):
    """L2 classifier output. On timeout or error the verdict is `elevated` (fail closed)."""

    level: RiskLevel
    signals: list[str] = Field(default_factory=list)
    rationale: str = ""


class DoneEvent(BaseModel):
    """Every turn reports which model and prompt produced it, so responses are traceable."""

    message_id: str
    model: str
    prompt_version: str
