"""Internal endpoints (02 §7.1). Only the gateway service account may call this service
(Cloud Run IAM invoker, internal ingress) — there is no public access path.
"""

import json
import logging
import time
import traceback
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from sse_starlette import EventSourceResponse

from agents import evaluation, handoff, persona_draft, summary
from agents import router as persona_router
from agents.llm import Models
from agents.safety import SafetyClassifier
from app.config import Settings
from app.contract import (
    ClassifyRequest,
    EvalRunRequest,
    EvalRunResponse,
    HandoffDraftRequest,
    HandoffDraftResponse,
    PersonaDraftRequest,
    PersonaDraftResponse,
    RouterChoice,
    RouterRequest,
    SummaryRequest,
    SummaryResponse,
    TurnRequest,
)
from app.turn import TurnRunner

router = APIRouter(prefix="/v1")
logger = logging.getLogger("agent.turn")


def _where(error: BaseException) -> str:
    """`file.py:line` of the innermost frame — locates a failure without its message, which
    can echo prompt text (AGENT.md rule 4)."""
    frames = traceback.extract_tb(error.__traceback__)
    if not frames:
        return "unknown"
    frame = frames[-1]
    return f"{frame.filename.rsplit('/', 1)[-1]}:{frame.lineno}"


def _log_duration(step: str, started: float, outcome: str) -> None:
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "%s: outcome=%s %d ms",
        step,
        outcome,
        duration_ms,
        extra={"fields": {"step_timing": {"step": step, "outcome": outcome, "ms": duration_ms}}},
    )


@router.post("/turn")
async def turn(body: TurnRequest, request: Request) -> EventSourceResponse:
    """One conversation turn as SSE: safety → token… → structured* → done, or error."""
    runner: TurnRunner = request.app.state.turn_runner

    async def events() -> AsyncIterator[dict[str, str]]:
        try:
            async for item in runner.stream(body):
                yield {"event": item.event.value, "data": json.dumps(item.data, ensure_ascii=False)}
        except Exception as error:
            # Without this the stream just closed and the gateway saw "no safety verdict".
            # An explicit error lets it fail closed with the right message; type + place only.
            logger.error("turn failed: %s at %s", type(error).__name__, _where(error))
            yield {"event": "error", "data": json.dumps({"code": "AGENT_ERROR"})}

    return EventSourceResponse(events(), ping=15)


@router.post("/router/select")
async def router_select(body: RouterRequest, request: Request) -> RouterChoice:
    """Quick Chat: pick `persona_id`, `reason`, `initial_risk`, `topics`."""
    models: Models = request.app.state.models
    started = time.monotonic()
    outcome = "error"
    try:
        choice = await persona_router.select(models, body)
        outcome = "ok"
        return choice
    finally:
        _log_duration("router", started, outcome)


@router.post("/safety/classify")
async def safety_classify(body: ClassifyRequest, request: Request) -> dict[str, object]:
    """L2 only — for a message without a persona reply (quota exhausted, 02 §6.3)."""
    classifier: SafetyClassifier = request.app.state.classifier
    started = time.monotonic()
    verdict = await classifier.classify(body.message, body.history)
    _log_duration("classify", started, "timeout" if verdict.timed_out else "ok")
    return {
        "level": verdict.level.value,
        "signals": verdict.signals,
        "timed_out": verdict.timed_out,
    }


@router.post("/session/summary")
async def session_summary(body: SummaryRequest, request: Request) -> SummaryResponse:
    """Cross-session memory summary (02 §6.5)."""
    return await summary.summarize(request.app.state.models, body)


@router.post("/handoff/draft")
async def handoff_draft(body: HandoffDraftRequest, request: Request) -> HandoffDraftResponse:
    """Pre-session summary draft for the psikolog (Pro tier)."""
    return await handoff.draft(request.app.state.models, body)


@router.post("/persona/draft")
async def persona_draft_endpoint(
    body: PersonaDraftRequest, request: Request
) -> PersonaDraftResponse:
    """Persona Card draft from questionnaire and case-study answers (Pro tier)."""
    return await persona_draft.draft(request.app.state.models, body)


@router.post("/eval/run")
async def eval_run(body: EvalRunRequest, request: Request) -> EvalRunResponse:
    """Synthetic case studies against one persona version, through L2 and L3 (02 §12.1)."""
    settings: Settings = request.app.state.settings
    return await evaluation.run(
        request.app.state.models,
        request.app.state.classifier,
        body,
        settings.MAX_OUTPUT_TOKENS,
    )
