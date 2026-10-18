"""Decides whether a turn offers a routine, an assessment, a handoff, or a psikolog
recommendation (02 §7.4).

Only IDs from the catalog the gateway sent are allowed; the gateway validates again anyway.
"""

import logging
from collections.abc import Callable
from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from agents.llm import Models
from agents.local_llm import topics_in
from agents.run import run_structured
from app.contract import (
    MAX_RECOMMENDED_PSIKOLOGS,
    CardDecision,
    RecommendationCard,
    TurnRequest,
)
from prompts import active

logger = logging.getLogger("agent.cards")


def _local(turn: TurnRequest) -> Callable[[LlmRequest], dict[str, Any]]:
    def respond(_request: LlmRequest) -> dict[str, Any]:
        text = turn.message.lower()
        decision: dict[str, Any] = {
            "routine": None,
            "assessment": None,
            "handoff": None,
            "recommendation": None,
        }
        catalog = turn.catalog
        if (
            turn.state.allow_routine
            and ("rutinitas" in text or "routine" in text)
            and catalog.routine_items
        ):
            wanted = topics_in(text) or [catalog.routine_items[0].topic]
            items = [i for i in catalog.routine_items if i.topic == wanted[0]][
                :2
            ] or catalog.routine_items[:1]
            decision["routine"] = {
                "topic": items[0].topic,
                "items": [{"library_item_id": i.id} for i in items],
                "personalization_note": "[model lokal] Disesuaikan dengan ceritamu.",
            }
        if (
            turn.state.allow_assessment
            and ("tes" in text or "asesmen" in text)
            and catalog.assessments
        ):
            item = catalog.assessments[0]
            decision["assessment"] = {
                "assessment_id": item.id,
                "topic": item.topic,
                "reason": "[model lokal] Tes ini bisa membantumu memahami dirimu.",
            }
        if turn.state.allow_recommendation and "psikolog" in text and catalog.directory:
            decision["recommendation"] = {
                "reason": "[model lokal] Psikolog yang mungkin cocok untukmu.",
                "items": [
                    {"psikolog_id": p.id, "reason": "[model lokal] Spesialisasinya relevan."}
                    for p in catalog.directory[:2]
                ],
            }
        if turn.state.allow_handoff and "psikolog" in text and catalog.psikologs:
            decision["handoff"] = {
                "psikolog_id": catalog.psikologs[0].id,
                "reason": "[model lokal] Psikolog ini bisa membantu lebih dalam.",
            }
        return decision

    return respond


def _brief(turn: TurnRequest, reply: str) -> str:
    catalog = turn.catalog
    lines = [
        f"Keadaan: risiko={turn.state.risk_level.value}, "
        f"boleh_routine={turn.state.allow_routine}, boleh_asesmen={turn.state.allow_assessment}, "
        f"boleh_handoff={turn.state.allow_handoff}, "
        f"boleh_rekomendasi={turn.state.allow_recommendation}",
    ]
    if catalog.routine_items:
        lines.append(
            "Katalog routine:\n"
            + "\n".join(
                f"- id={i.id}; topik={i.topic}; {i.title}: {i.description}"
                for i in catalog.routine_items
            )
        )
    if catalog.assessments:
        lines.append(
            "Katalog asesmen:\n"
            + "\n".join(f"- id={a.id}; topik={a.topic}; {a.title}" for a in catalog.assessments)
        )
    if catalog.psikologs:
        lines.append(
            "Psikolog:\n"
            + "\n".join(
                f"- id={p.id}; {p.name}; spesialis: {', '.join(p.specialists)}"
                for p in catalog.psikologs
            )
        )
    if catalog.directory:
        lines.append("Psikolog DeepTalk untuk rekomendasi:\n" + directory_lines(turn))
    recent = turn.history[-6:]
    lines.append("Percakapan terakhir:")
    lines += [f"{'Pengguna' if m.role == 'user' else 'DeepTalk AI'}: {m.content}" for m in recent]
    lines.append(f"Pengguna: {turn.message}")
    lines.append(f"DeepTalk AI: {reply}")
    return "\n".join(lines)


async def decide(models: Models, turn: TurnRequest, reply: str) -> CardDecision:
    state = turn.state
    if not (
        state.allow_routine
        or state.allow_assessment
        or state.allow_handoff
        or state.allow_recommendation
    ):
        return CardDecision()
    agent = LlmAgent(
        name="cards",
        model=models.structured("chat", _local(turn)),
        generate_content_config=models.generate_config("chat"),
        instruction=lambda _ctx: active("cards"),
        output_schema=CardDecision,
    )
    try:
        decision = await run_structured(agent, _brief(turn, reply), CardDecision)
    except Exception as error:
        # Cards are optional; a failure never breaks the reply.
        logger.warning("card decision failed: %s", type(error).__name__)
        return CardDecision()
    # Drop anything not allowed this turn or not in the catalog.
    routine_ids = {i.id for i in turn.catalog.routine_items}
    if not state.allow_routine or (
        decision.routine
        and any(i.library_item_id not in routine_ids for i in decision.routine.items)
    ):
        decision.routine = None
    if not state.allow_assessment or (
        decision.assessment
        and decision.assessment.assessment_id not in {a.id for a in turn.catalog.assessments}
    ):
        decision.assessment = None
    if not state.allow_handoff or (
        decision.handoff
        and decision.handoff.psikolog_id not in {p.id for p in turn.catalog.psikologs}
    ):
        decision.handoff = None
    decision.recommendation = _valid_recommendation(turn, decision)
    return decision


def _valid_recommendation(turn: TurnRequest, decision: CardDecision) -> RecommendationCard | None:
    """Only shortlisted IDs, no repeats, at most three; nothing left means no card."""
    card = decision.recommendation
    if card is None or not turn.state.allow_recommendation:
        return None
    known = {p.id for p in turn.catalog.directory}
    seen: set[str] = set()
    items = []
    for item in card.items:
        if item.psikolog_id in known and item.psikolog_id not in seen:
            seen.add(item.psikolog_id)
            items.append(item)
    if not items:
        return None
    return RecommendationCard(reason=card.reason, items=items[:MAX_RECOMMENDED_PSIKOLOGS])


def directory_lines(turn: TurnRequest) -> str:
    """The shortlist as prompt lines, shared by the persona and the card decision."""
    lines = []
    for p in turn.catalog.directory:
        parts = [f"id={p.id}", p.name]
        if p.specialists:
            parts.append("spesialis: " + ", ".join(p.specialists))
        if p.year_experience:
            parts.append(f"pengalaman {p.year_experience} tahun")
        if p.rating is not None and p.reviews:
            parts.append(f"rating {p.rating:.1f} dari {p.reviews} ulasan")
        if p.persona:
            topics = ", ".join(p.persona.focus_topics)
            parts.append(
                f"punya pendekatan DeepTalk AI ({p.persona.label}): {p.persona.approach}"
                + (f" Fokus: {topics}." if topics else "")
            )
        lines.append("- " + "; ".join(parts))
    return "\n".join(lines)
