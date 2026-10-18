"""Persona Card draft from a psikolog's questionnaire and case-study answers (Pro tier).

The psikolog corrects and approves the draft in the dashboard (Konsep §3.2); few-shot examples
are added by the gateway from the psikolog's own answers, never rewritten by the model.
"""

from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from agents.llm import Models
from agents.run import run_structured
from app.contract import PersonaDraftCard, PersonaDraftRequest, PersonaDraftResponse
from prompts import ACTIVE, active


def _local(_request: LlmRequest) -> dict[str, Any]:
    # Deterministic stand-in; topics come from the psikolog's answer in the gateway.
    return {
        "approach": "[model lokal] Draft pendekatan dari jawaban kuesioner.",
        "focus_topics": [],
        "tone": "[model lokal] Hangat dan tenang.",
        "techniques": ["[model lokal] Refleksi perasaan"],
        "questioning_style": "[model lokal] Satu pertanyaan terbuka per giliran.",
        "always_say": [],
        "never_say": [],
        "opening": "[model lokal] Hai, aku di sini untuk mendengarkan.",
    }


def _brief(request: PersonaDraftRequest) -> str:
    lines = [f"Nama pendekatan: {request.display_name}", "", "Jawaban kuesioner:"]
    for item in request.answers:
        lines += [f"T: {item.question}", f"J: {item.answer}", ""]
    if request.few_shots:
        lines.append("Contoh jawaban psikolog terhadap studi kasus:")
        for shot in request.few_shots:
            lines += [f"Kasus: {shot.scenario}", f"Jawaban: {shot.response}", ""]
    return "\n".join(lines)


async def draft(models: Models, request: PersonaDraftRequest) -> PersonaDraftResponse:
    agent = LlmAgent(
        name="persona_draft",
        model=models.structured("document", _local),
        generate_content_config=models.generate_config("document"),
        instruction=lambda _ctx: active("persona_draft"),
        output_schema=PersonaDraftCard,
    )
    card = await run_structured(agent, _brief(request), PersonaDraftCard)
    return PersonaDraftResponse(
        card=card, model=models.name("document"), prompt_version=ACTIVE["persona_draft"]
    )
