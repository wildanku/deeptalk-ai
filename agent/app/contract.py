"""Gateway ↔ agent contract (02 §7.1). Mirrors `gateway/src/agent-client/agent-events.ts`.

The agent never calls v3 or the database: everything it needs arrives here, already resolved
and validated by the gateway (catalogs, persona card, memory).
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import RiskLevel

Role = Literal["user", "assistant"]


class HistoryMessage(BaseModel):
    role: Role
    content: str = Field(min_length=1, max_length=8000)


class PersonaCard(BaseModel):
    approach: str
    focus_topics: list[str]
    tone: str
    techniques: list[str] = Field(default_factory=list)
    questioning_style: str
    always_say: list[str] = Field(default_factory=list)
    never_say: list[str] = Field(default_factory=list)
    opening: str
    few_shots: list[dict[str, str]] = Field(default_factory=list, max_length=8)


class Persona(BaseModel):
    id: str
    display_name: str
    version: int
    card: PersonaCard


class Knowledge(BaseModel):
    topic: str
    title: str
    content: str


class Profile(BaseModel):
    nickname: str | None = None
    age_band: str | None = None
    # As stored in v3 (`male`, `female`, `non-binary`, …); worded by the persona prompt.
    gender: str | None = None


class RoutineProgress(BaseModel):
    title: str
    adherence_7d: float


class UserAssessment(BaseModel):
    name: str
    completed_at: str
    result_category: str | None = None


class Memory(BaseModel):
    summaries: list[str] = Field(default_factory=list, max_length=3)
    profile: Profile = Field(default_factory=Profile)
    routines: list[RoutineProgress] = Field(default_factory=list)
    assessments: list[UserAssessment] = Field(default_factory=list)


class TurnState(BaseModel):
    risk_level: RiskLevel = RiskLevel.NORMAL
    wrap_up: bool = False
    allow_routine: bool = False
    allow_assessment: bool = False
    allow_handoff: bool = False
    allow_recommendation: bool = False
    offered_cards: list[str] = Field(default_factory=list)


class CatalogRoutineItem(BaseModel):
    id: str
    topic: str
    title: str
    description: str


class CatalogAssessment(BaseModel):
    id: str
    title: str
    topic: str


class CatalogPsikolog(BaseModel):
    id: str
    name: str
    specialists: list[str] = Field(default_factory=list)


class DirectoryPersona(BaseModel):
    label: str
    approach: str
    focus_topics: list[str] = Field(default_factory=list)


class DirectoryPsikolog(BaseModel):
    """A bookable psikolog the gateway shortlisted for recommendation (public profile data)."""

    id: str
    name: str
    specialists: list[str] = Field(default_factory=list)
    year_experience: int | None = None
    rating: float | None = None
    reviews: int = 0
    persona: DirectoryPersona | None = None


class Catalog(BaseModel):
    routine_items: list[CatalogRoutineItem] = Field(default_factory=list, max_length=20)
    assessments: list[CatalogAssessment] = Field(default_factory=list, max_length=10)
    # Psikolog who accept handoffs (pre-session summary).
    psikologs: list[CatalogPsikolog] = Field(default_factory=list, max_length=10)
    # Recommendation shortlist from the v3 directory.
    directory: list[DirectoryPsikolog] = Field(default_factory=list, max_length=20)


MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_MESSAGES = 41


class TurnRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY_MESSAGES)
    persona: Persona | None = None
    knowledge: list[Knowledge] = Field(default_factory=list, max_length=5)
    memory: Memory = Field(default_factory=Memory)
    state: TurnState = Field(default_factory=TurnState)
    catalog: Catalog = Field(default_factory=Catalog)


class RouterPersona(BaseModel):
    id: str
    display_name: str
    approach: str
    focus_topics: list[str]


class RouterRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    personas: list[RouterPersona] = Field(min_length=1, max_length=50)
    locale: Literal["id", "en"] = "id"


class RouterChoice(BaseModel):
    persona_id: str
    reason: str
    initial_risk: RiskLevel = RiskLevel.NORMAL
    topics: list[str] = Field(default_factory=list)


class ClassifyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY_MESSAGES)


class SummaryRequest(BaseModel):
    history: list[HistoryMessage] = Field(min_length=1, max_length=120)


class SummaryResponse(BaseModel):
    summary: str
    model: str
    prompt_version: str


class HandoffDraftRequest(BaseModel):
    history: list[HistoryMessage] = Field(min_length=1, max_length=120)
    psikolog: CatalogPsikolog
    reason: str
    routines: list[RoutineProgress] = Field(default_factory=list)
    assessments: list[UserAssessment] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.NORMAL


class HandoffSection(BaseModel):
    id: Literal["keluhan", "pola", "routine", "asesmen", "risiko", "topik"]
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)


class HandoffDraft(BaseModel):
    sections: list[HandoffSection]


class HandoffDraftResponse(HandoffDraft):
    disclaimer: str
    model: str
    prompt_version: str


class RoutineCardItem(BaseModel):
    library_item_id: str


class RoutineCard(BaseModel):
    topic: str
    title: str | None = None
    items: list[RoutineCardItem] = Field(min_length=1, max_length=3)
    personalization_note: str | None = None


class AssessmentCard(BaseModel):
    assessment_id: str
    topic: str
    reason: str


class HandoffCard(BaseModel):
    psikolog_id: str
    reason: str


class RecommendationItem(BaseModel):
    psikolog_id: str
    reason: str


MAX_RECOMMENDED_PSIKOLOGS = 3


class RecommendationCard(BaseModel):
    reason: str
    # Not length-constrained here: an over-long model answer is trimmed in `cards.decide`
    # instead of failing the whole card decision for the turn.
    items: list[RecommendationItem] = Field(default_factory=list)


class CardDecision(BaseModel):
    routine: RoutineCard | None = None
    assessment: AssessmentCard | None = None
    handoff: HandoffCard | None = None
    recommendation: RecommendationCard | None = None


class QuestionnaireAnswer(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=4000)


class FewShotAnswer(BaseModel):
    scenario: str = Field(min_length=1, max_length=2000)
    response: str = Field(min_length=1, max_length=4000)


class PersonaDraftRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    answers: list[QuestionnaireAnswer] = Field(min_length=1, max_length=40)
    few_shots: list[FewShotAnswer] = Field(default_factory=list, max_length=8)


class PersonaDraftCard(BaseModel):
    """Persona Card without `few_shots`: the gateway adds the psikolog's own answers verbatim."""

    approach: str = Field(min_length=1, max_length=500)
    focus_topics: list[str] = Field(default_factory=list, max_length=10)
    tone: str = Field(min_length=1, max_length=500)
    techniques: list[str] = Field(default_factory=list, max_length=10)
    questioning_style: str = Field(min_length=1, max_length=500)
    always_say: list[str] = Field(default_factory=list, max_length=10)
    never_say: list[str] = Field(default_factory=list, max_length=10)
    opening: str = Field(min_length=1, max_length=500)


class PersonaDraftResponse(BaseModel):
    card: PersonaDraftCard
    model: str
    prompt_version: str


class EvalCase(BaseModel):
    case_id: str = Field(min_length=1, max_length=64)
    scenario: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class EvalRunRequest(BaseModel):
    persona: Persona
    knowledge: list[Knowledge] = Field(default_factory=list, max_length=5)
    cases: list[EvalCase] = Field(min_length=1, max_length=30)


class EvalResult(BaseModel):
    case_id: str
    response: str
    risk_level: RiskLevel
    signals: list[str] = Field(default_factory=list)
    replaced: bool = False


class EvalRunResponse(BaseModel):
    results: list[EvalResult]
    model: str
    prompt_version: str
