"""Pre-session handoff summary for the psikolog, in the user's own words (Pro tier, 02 §7.1)."""

from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from agents.llm import Models
from agents.local_llm import last_user_text
from agents.run import run_structured
from app.contract import HandoffDraft, HandoffDraftRequest, HandoffDraftResponse
from prompts import ACTIVE, active

DISCLAIMER = "Observasi dari percakapan dengan AI, bukan diagnosis."


def _local(request: LlmRequest) -> dict[str, Any]:
    text = last_user_text(request)
    complaint = next(
        (line[len("Pengguna: ") :] for line in text.splitlines() if line.startswith("Pengguna: ")),
        "Pengguna ingin berbicara dengan psikolog.",
    )
    return {
        "sections": [
            {"id": "keluhan", "title": "Keluhan utama", "body": complaint[:500]},
            {
                "id": "topik",
                "title": "Topik yang disarankan",
                "body": "[model lokal] Lanjutan percakapan.",
            },
        ]
    }


def _brief(request: HandoffDraftRequest) -> str:
    lines = [
        f"Psikolog tujuan: {request.psikolog.name} ({', '.join(request.psikolog.specialists)})",
        f"Alasan rujukan: {request.reason}",
        f"Penanda risiko sesi: {request.risk_level.value}",
    ]
    if request.routines:
        lines.append(
            "Daily Routine: "
            + "; ".join(f"{r.title} ({round(r.adherence_7d * 100)}%)" for r in request.routines)
        )
    if request.assessments:
        lines.append(
            "Asesmen: "
            + "; ".join(
                f"{a.name} ({a.completed_at}): {a.result_category or '-'}"
                for a in request.assessments
            )
        )
    lines.append("Percakapan:")
    lines += [
        f"{'Pengguna' if m.role == 'user' else 'DeepTalk AI'}: {m.content}" for m in request.history
    ]
    return "\n".join(lines)


async def draft(models: Models, request: HandoffDraftRequest) -> HandoffDraftResponse:
    agent = LlmAgent(
        name="handoff",
        model=models.structured("document", _local),
        generate_content_config=models.generate_config("document"),
        instruction=lambda _ctx: active("handoff"),
        output_schema=HandoffDraft,
    )
    result = await run_structured(agent, _brief(request), HandoffDraft)
    return HandoffDraftResponse(
        sections=result.sections,
        disclaimer=DISCLAIMER,
        model=models.name("document"),
        prompt_version=ACTIVE["handoff"],
    )
