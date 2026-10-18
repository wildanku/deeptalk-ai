"""Persona agent (02 §7.3). System instruction, from least to most negotiable:

  1. Global rules (same for every persona)
  2. Approved Persona Card (tone, techniques, questioning style, always/never, few-shot)
  3. Clinical knowledge for the relevant topics
  4. Cross-session memory
  5. Psikolog the reply may recommend (shortlist from the gateway)
  6. Session state (risk level, wrap-up)

Cards (routine/assessment/handoff/recommendation) are decided separately (`agents/cards.py`),
never by the persona text; the persona only sees the recommendation shortlist so its reply names
the same psikolog the card shows instead of claiming it has no list. The instruction is passed
as a callable so ADK does not template `{…}` in content written by psikolog.
"""

from google.adk.agents import LlmAgent
from google.adk.models import BaseLlm
from google.genai import types

from agents.cards import directory_lines
from app.contract import TurnRequest
from app.schemas import RiskLevel
from prompts import global_rules, state_guidance

# Only the values v3 offers; anything else (unset, "undifined") is left out of the prompt.
GENDER_LABELS = {"male": "laki-laki", "female": "perempuan", "non-binary": "non-biner"}


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def build_instruction(request: TurnRequest) -> str:
    parts = [global_rules()]

    persona = request.persona
    if persona:
        card = persona.card
        section = [
            f"# Pendekatan\nKamu adalah DeepTalk AI dengan pendekatan {persona.display_name}. "
            "Kamu tetap AI, bukan psikolognya; jangan pernah mengaku sebagai psikolog tersebut.",
            f"Pendekatan: {card.approach}",
            f"Nada: {card.tone}",
            f"Gaya bertanya: {card.questioning_style}",
        ]
        if card.techniques:
            section.append("Teknik:\n" + _bullets(card.techniques))
        if card.always_say:
            section.append("Ungkapan yang sesuai pendekatan ini:\n" + _bullets(card.always_say))
        if card.never_say:
            section.append("Jangan pernah mengatakan:\n" + _bullets(card.never_say))
        if card.few_shots:
            examples = "\n\n".join(
                f"Pengguna: {shot.get('user', '')}\nKamu: {shot.get('assistant', '')}"
                for shot in card.few_shots
            )
            section.append("Contoh gaya menjawab:\n" + examples)
        parts.append("\n".join(section))

    if request.knowledge:
        parts.append(
            "# Pengetahuan yang disetujui psikolog\n"
            + "\n\n".join(f"## {item.title}\n{item.content}" for item in request.knowledge)
        )

    memory = request.memory
    memory_lines: list[str] = []
    if memory.profile.nickname:
        memory_lines.append(f"Nama panggilan pengguna: {memory.profile.nickname}.")
    if memory.profile.age_band:
        memory_lines.append(f"Kelompok usia: {memory.profile.age_band}.")
    gender = GENDER_LABELS.get(memory.profile.gender or "")
    if gender:
        memory_lines.append(f"Jenis kelamin: {gender}.")
    if memory.summaries:
        memory_lines.append("Ringkasan sesi sebelumnya:\n" + _bullets(memory.summaries))
    if memory.routines:
        memory_lines.append(
            "Daily Routine aktif:\n"
            + _bullets(
                [
                    f"{r.title} (kepatuhan 7 hari {round(r.adherence_7d * 100)}%)"
                    for r in memory.routines
                ]
            )
        )
    if memory.assessments:
        memory_lines.append(
            "Asesmen yang sudah diikuti (jelaskan dengan hangat bila ditanya; "
            "jangan menghitung atau menafsirkan skor sendiri):\n"
            + _bullets(
                [
                    f"{a.name}, {a.completed_at}: {a.result_category or 'hasil belum tersedia'}"
                    for a in memory.assessments
                ]
            )
        )
    if memory_lines:
        parts.append("# Yang kamu ingat\n" + "\n".join(memory_lines))

    recommend = _recommendation_section(request)
    if recommend:
        parts.append(recommend)

    guidance = state_guidance()
    state_lines: list[str] = []
    if request.state.risk_level == RiskLevel.CRISIS:
        state_lines.append(guidance["crisis"])
    elif request.state.risk_level == RiskLevel.ELEVATED:
        state_lines.append(guidance["elevated"])
    if request.state.wrap_up:
        state_lines.append(guidance["wrap_up"])
    if state_lines:
        parts.append("# Keadaan sesi\n" + "\n\n".join(state_lines))

    return "\n\n".join(parts)


def _recommendation_section(request: TurnRequest) -> str | None:
    if request.state.allow_recommendation and request.catalog.directory:
        return (
            "# Psikolog DeepTalk yang bisa kamu rekomendasikan\n"
            "Bila pengguna meminta rekomendasi psikolog, atau ceritanya jelas butuh "
            "bantuan profesional, sebut satu sampai tiga psikolog dari daftar ini yang "
            "paling cocok dengan ceritanya, masing-masing dengan alasan singkat dari "
            "spesialisasi atau pendekatannya. Kartu profil mereka muncul di bawah "
            "balasanmu. Tulis nama persis seperti di daftar. Jangan menyebut psikolog di "
            "luar daftar, dan jangan mengarang jadwal, harga, atau gelar. Jangan "
            "menawarkan psikolog bila pengguna tidak membutuhkannya.\n" + directory_lines(request)
        )
    if "recommendation" in request.state.offered_cards:
        return (
            "# Rekomendasi psikolog\n"
            "Kartu rekomendasi psikolog sudah ditampilkan di sesi ini. Bila pengguna menanyakan "
            "psikolog lagi, rujuk ke kartu itu atau menu Cari Psikolog di DeepTalk."
        )
    return None


def build_persona_agent(
    model: str | BaseLlm,
    request: TurnRequest,
    config: types.GenerateContentConfig | None,
) -> LlmAgent:
    instruction = build_instruction(request)
    return LlmAgent(
        name="persona",
        model=model,
        instruction=lambda _ctx: instruction,
        generate_content_config=config,
    )
