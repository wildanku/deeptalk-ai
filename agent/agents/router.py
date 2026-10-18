"""Quick Chat router: choose a persona and initial risk for an open conversation (02 §7.1)."""

from collections.abc import Callable
from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from agents.llm import Models
from agents.local_llm import last_user_text, topics_in
from agents.run import run_structured
from app.contract import RouterChoice, RouterRequest
from prompts import active


def _local(personas: list[dict[str, Any]], locale: str) -> Callable[[LlmRequest], dict[str, Any]]:
    def respond(request: LlmRequest) -> dict[str, Any]:
        found = topics_in(last_user_text(request))
        match = next(
            (p for p in personas if any(t in p["focus_topics"] for t in found)), personas[0]
        )
        topic = next((t for t in found if t in match["focus_topics"]), match["focus_topics"][0])
        if locale == "en":
            reason = (
                f"I'm connecting you with the {match['display_name']} approach "
                "based on what you shared."
            )
        else:
            reason = (
                f"Aku hubungkan kamu dengan pendekatan {match['display_name']} "
                f"karena fokus pada {topic.replace('_', ' ')}."
            )
        return {
            "persona_id": match["id"],
            "reason": reason,
            "initial_risk": "normal",
            "topics": [topic],
        }

    return respond


async def select(models: Models, request: RouterRequest) -> RouterChoice:
    personas = [p.model_dump() for p in request.personas]
    listing = "\n".join(
        f"- id={p['id']}; nama={p['display_name']}; pendekatan={p['approach']}; "
        f"fokus={', '.join(p['focus_topics'])}"
        for p in personas
    )
    agent = LlmAgent(
        name="router",
        model=models.structured("chat", _local(personas, request.locale)),
        generate_content_config=models.generate_config("chat"),
        instruction=lambda _ctx: (
            f"{active('router')}\n\n"
            f"Locale pengguna: {request.locale}. "
            "Tulis reason sepenuhnya dalam bahasa yang sesuai dengan locale ini. "
            "Pertahankan nama pendekatan atau istilah budaya yang tidak pasti "
            "alih bahasakan; jangan menebak maknanya.\n\n"
            f"Daftar persona:\n{listing}"
        ),
        output_schema=RouterChoice,
    )
    choice = await run_structured(agent, request.message, RouterChoice)
    if choice.persona_id not in {p.id for p in request.personas}:
        # The gateway also checks; keep the contract honest here too.
        first = request.personas[0]
        reason = (
            f"I'm connecting you with the {first.display_name} approach."
            if request.locale == "en"
            else f"Aku hubungkan kamu dengan pendekatan {first.display_name}."
        )
        choice = RouterChoice(
            persona_id=first.id,
            reason=reason,
            initial_risk=choice.initial_risk,
            topics=first.focus_topics[:1],
        )
    return choice
