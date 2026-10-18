"""End-of-session summary for cross-session memory (02 §6.5)."""

from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest
from pydantic import BaseModel

from agents.llm import Models
from agents.run import run_structured
from app.contract import SummaryRequest, SummaryResponse
from prompts import ACTIVE, active


class _Summary(BaseModel):
    summary: str


def _local(request: LlmRequest) -> dict[str, Any]:
    turns = sum(1 for content in request.contents if content.role == "user")
    return {"summary": f"[model lokal] Ringkasan sesi dengan {turns} pesan pengguna."}


def _transcript(request: SummaryRequest) -> str:
    return "\n".join(
        f"{'Pengguna' if m.role == 'user' else 'DeepTalk AI'}: {m.content}" for m in request.history
    )


async def summarize(models: Models, request: SummaryRequest) -> SummaryResponse:
    agent = LlmAgent(
        name="summary",
        model=models.structured("chat", _local),
        generate_content_config=models.generate_config("chat"),
        instruction=lambda _ctx: active("summary"),
        output_schema=_Summary,
    )
    result = await run_structured(agent, _transcript(request), _Summary)
    return SummaryResponse(
        summary=result.summary.strip()[:2000],
        model=models.name("chat"),
        prompt_version=ACTIVE["summary"],
    )
