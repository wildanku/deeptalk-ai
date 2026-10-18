"""L2 risk classification and L3 output checks (02 §7.2).

L2 runs in parallel with the persona; its verdict decides whether persona tokens may be shown
(safety gate). Timeout or error → `elevated`, never `normal` (fail closed).
L3 checks the reply as it streams: medication names, dosages, and diagnostic statements are
replaced with a safe template before they reach the user.
"""

import asyncio
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass

from google.adk.agents import LlmAgent
from pydantic import BaseModel, Field

from agents.llm import Models
from agents.local_llm import local_safety
from agents.run import run_structured
from app.contract import HistoryMessage
from app.schemas import RiskLevel, SafetyVerdict
from prompts import ACTIVE, active

logger = logging.getLogger("agent.safety")

SAFETY_PROMPT_VERSION = ACTIVE["safety"]
_RANK = {RiskLevel.NORMAL: 0, RiskLevel.ELEVATED: 1, RiskLevel.CRISIS: 2}


class _Verdict(BaseModel):
    level: RiskLevel
    signals: list[str] = Field(default_factory=list, max_length=10)
    rationale: str = ""


@dataclass(frozen=True)
class Classification:
    level: RiskLevel
    signals: list[str]
    timed_out: bool


def higher(a: RiskLevel, b: RiskLevel) -> RiskLevel:
    return a if _RANK[a] >= _RANK[b] else b


class SafetyClassifier:
    def __init__(self, models: Models, timeout_ms: int) -> None:
        self._models = models
        self._timeout = timeout_ms / 1000

    def _agent(self) -> LlmAgent:
        return LlmAgent(
            name="safety",
            model=self._models.structured("chat", local_safety),
            generate_content_config=self._models.generate_config("chat"),
            instruction=lambda _ctx: active("safety"),
            output_schema=_Verdict,
        )

    async def classify(
        self, message: str, history: Sequence[HistoryMessage] = ()
    ) -> Classification:
        try:
            verdict = await asyncio.wait_for(
                run_structured(self._agent(), message, _Verdict, history[-10:]),
                timeout=self._timeout,
            )
        except TimeoutError:
            logger.warning("L2 timed out")
            return Classification(RiskLevel.ELEVATED, ["l2:timeout"], timed_out=True)
        except Exception as error:
            logger.error("L2 failed: %s", type(error).__name__)
            return Classification(RiskLevel.ELEVATED, ["l2:error"], timed_out=False)
        signals = [signal[:64] for signal in verdict.signals]
        return Classification(verdict.level, signals, timed_out=False)


# --- L3 ------------------------------------------------------------------------------------------

L3_VERSION = "l3-v0-draft"

# DRAFT engineering list; the clinical list is reviewed with psikolog.
_MEDICATIONS = (
    "sertraline|sertralin|fluoxetine|fluoksetin|paroxetine|paroksetin|escitalopram|citalopram|"
    "fluvoxamine|venlafaxine|duloxetine|bupropion|mirtazapine|amitriptyline|amitriptilin|"
    "alprazolam|xanax|diazepam|valium|clonazepam|klonazepam|lorazepam|zolpidem|quetiapine|"
    "risperidone|olanzapine|aripiprazole|haloperidol|lithium|litium|valproate|lamotrigine|"
    "methylphenidate|ritalin|tramadol"
)
_DIAGNOSES = (
    "depresi|depresi mayor|bipolar|skizofrenia|ocd|ptsd|adhd|borderline|gangguan kecemasan|"
    "gangguan panik|gangguan kepribadian|gangguan mental|anxiety disorder"
)

L3_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("medication", re.compile(rf"\b(?:{_MEDICATIONS})\b", re.IGNORECASE)),
    (
        "dosage",
        re.compile(
            r"\b\d+(?:[.,]\d+)?\s?(?:mg|miligram|mcg|ml|tablet|kapsul|butir|pil)\b", re.IGNORECASE
        ),
    ),
    (
        "diagnosis",
        re.compile(
            rf"\b(?:kamu|anda|kau)\s+(?:\w+\s+){{0,2}}"
            rf"(?:mengalami|menderita|mengidap|terkena|terdiagnosis|didiagnosis)\s+(?:{_DIAGNOSES})\b",
            re.IGNORECASE,
        ),
    ),
    (
        "diagnosis",
        re.compile(
            rf"\b(?:kamu|anda|kau)\s+"
            rf"(?:pasti|jelas|kemungkinan besar|sepertinya)\s+(?:{_DIAGNOSES})\b",
            re.IGNORECASE,
        ),
    ),
)

L3_TEMPLATE = (
    "Maaf, aku tidak bisa memberi diagnosis atau saran obat. Untuk hal itu, psikolog atau dokter "
    "adalah orang yang tepat, dan psikolog DeepTalk siap membantu. Aku tetap di sini kalau kamu "
    "ingin bercerita."
)


def l3_violations(text: str) -> list[str]:
    return sorted({kind for kind, pattern in L3_PATTERNS if pattern.search(text)})


_BOUNDARY = re.compile(r"[\s.,!?;:)\]]")


class L3Stream:
    """Releases streamed text only up to the last word boundary, after checking everything
    released so far plus that chunk — so a flagged word is never released."""

    def __init__(self) -> None:
        self.released = ""
        self._pending = ""
        self.violations: list[str] = []

    def feed(self, delta: str) -> str | None:
        """Returns text safe to release now, or None once a violation was found."""
        if self.violations:
            return None
        self._pending += delta
        cut = max((m.end() for m in _BOUNDARY.finditer(self._pending)), default=0)
        if cut == 0:
            return ""
        candidate = self._pending[:cut]
        found = l3_violations(self.released + candidate)
        if found:
            self.violations = found
            return None
        self.released += candidate
        self._pending = self._pending[cut:]
        return candidate

    def finish(self, final_text: str) -> tuple[str, bool]:
        """Checks the complete reply. Returns (content to store, replaced)."""
        found = self.violations or l3_violations(final_text)
        if found:
            self.violations = found
            return L3_TEMPLATE, True
        return final_text, False

    def rest(self, final_text: str) -> str:
        """Unreleased tail of an approved reply."""
        return final_text[len(self.released) :] if final_text.startswith(self.released) else ""


__all__ = [
    "L3_TEMPLATE",
    "L3_VERSION",
    "SAFETY_PROMPT_VERSION",
    "Classification",
    "L3Stream",
    "SafetyClassifier",
    "SafetyVerdict",
    "higher",
    "l3_violations",
]
