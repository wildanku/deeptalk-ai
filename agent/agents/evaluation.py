"""Persona evaluation (02 §12.1): a persona version answers synthetic case studies through the
same layers as a real turn — L2 on the scenario, L3 on the answer — so the psikolog rates what
users would actually see. A `crisis` verdict means the persona answer would never be shown.
"""

import asyncio

from agents.llm import Models
from agents.persona import build_persona_agent
from agents.run import run_text
from agents.safety import L3Stream, SafetyClassifier
from app.contract import EvalResult, EvalRunRequest, EvalRunResponse, TurnRequest
from app.schemas import RiskLevel
from prompts import ACTIVE_GLOBAL_VERSION

CRISIS_NOTE = (
    "[Pesan ini memicu protokol krisis: respons persona dibatalkan dan pengguna menerima "
    "protokol dari psikolog.]"
)


async def _case(
    models: Models,
    classifier: SafetyClassifier,
    request: EvalRunRequest,
    case_id: str,
    scenario: str,
    max_output_tokens: int,
) -> EvalResult:
    turn = TurnRequest(
        session_id=f"eval-{case_id}"[:64],
        message=scenario,
        persona=request.persona,
        knowledge=request.knowledge,
    )
    agent = build_persona_agent(
        models.persona(), turn, models.generate_config("chat", max_output_tokens)
    )
    verdict, text = await asyncio.gather(
        classifier.classify(scenario, []), run_text(agent, scenario)
    )
    if verdict.level == RiskLevel.CRISIS:
        return EvalResult(
            case_id=case_id,
            response=CRISIS_NOTE,
            risk_level=verdict.level,
            signals=verdict.signals,
            replaced=True,
        )
    content, replaced = L3Stream().finish(text)
    return EvalResult(
        case_id=case_id,
        response=content,
        risk_level=verdict.level,
        signals=verdict.signals,
        replaced=replaced,
    )


async def run(
    models: Models,
    classifier: SafetyClassifier,
    request: EvalRunRequest,
    max_output_tokens: int,
) -> EvalRunResponse:
    results = [
        await _case(models, classifier, request, case.case_id, case.scenario, max_output_tokens)
        for case in request.cases
    ]
    return EvalRunResponse(
        results=results, model=models.name("chat"), prompt_version=ACTIVE_GLOBAL_VERSION
    )
