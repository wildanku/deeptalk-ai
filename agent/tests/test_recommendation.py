from typing import Any

from agents.cards import _valid_recommendation
from agents.persona import build_instruction
from app.contract import CardDecision, RecommendationCard, RecommendationItem, TurnRequest
from tests.test_turn import client, turn

DIRECTORY = [
    {
        "id": "SPS1",
        "name": "Psikolog Karir",
        "specialists": ["Karir", "Dewasa"],
        "year_experience": 5,
        "rating": 4.9,
        "reviews": 12,
    },
    {
        "id": "SPS2",
        "name": "Psikolog Persona",
        "specialists": ["Dewasa"],
        "persona": {
            "label": "Mindfulness & Penerimaan",
            "approach": "Memberi ruang bercerita lalu memetakan pikiran pemicu.",
            "focus_topics": ["stres_kerja", "tidur"],
        },
    },
    {"id": "SPS3", "name": "Psikolog Pasangan", "specialists": ["Pasangan"]},
    {"id": "SPS4", "name": "Psikolog Anak", "specialists": ["Anak dan Remaja"]},
]


def request(**overrides: Any) -> TurnRequest:
    body: dict[str, Any] = {
        "session_id": "s1",
        "message": "boleh rekomendasi psikolog?",
        "state": {"allow_recommendation": True},
        "catalog": {"directory": DIRECTORY},
    }
    body.update(overrides)
    return TurnRequest.model_validate(body)


def test_recommendation_card_comes_from_the_directory_when_allowed() -> None:
    events = turn(
        client(),
        message="boleh minta rekomendasi psikolog?",
        state={"allow_recommendation": True},
        catalog={"directory": DIRECTORY},
    )
    cards = {data["type"]: data["data"] for name, data in events if name == "structured"}
    items = cards["recommendation"]["items"]  # type: ignore[index]
    assert [i["psikolog_id"] for i in items] == ["SPS1", "SPS2"]

    not_allowed = turn(
        client(), message="boleh minta rekomendasi psikolog?", catalog={"directory": DIRECTORY}
    )
    assert not any(name == "structured" for name, _ in not_allowed)


def test_recommendation_keeps_known_unique_ids_and_at_most_three() -> None:
    ids = ["SPS9", "SPS1", "SPS1", "SPS2", "SPS3", "SPS4"]
    decision = CardDecision(
        recommendation=RecommendationCard(
            reason="r", items=[RecommendationItem(psikolog_id=i, reason="r") for i in ids]
        )
    )
    card = _valid_recommendation(request(), decision)
    assert card is not None
    assert [i.psikolog_id for i in card.items] == ["SPS1", "SPS2", "SPS3"]

    only_unknown = CardDecision(
        recommendation=RecommendationCard(
            reason="r", items=[RecommendationItem(psikolog_id="SPS9", reason="r")]
        )
    )
    assert _valid_recommendation(request(), only_unknown) is None
    assert _valid_recommendation(request(state={}), decision) is None


def test_persona_sees_the_shortlist_so_its_reply_matches_the_card() -> None:
    instruction = build_instruction(request())
    assert "# Psikolog DeepTalk yang bisa kamu rekomendasikan" in instruction
    assert "id=SPS1; Psikolog Karir; spesialis: Karir, Dewasa" in instruction
    assert "rating 4.9 dari 12 ulasan" in instruction
    assert "punya pendekatan DeepTalk AI (Mindfulness & Penerimaan)" in instruction
    assert "Fokus: stres_kerja, tidur." in instruction


def test_persona_points_back_to_the_card_once_it_was_offered() -> None:
    offered = build_instruction(
        request(state={"offered_cards": ["recommendation"]}, catalog={"directory": []})
    )
    assert "sudah ditampilkan di sesi ini" in offered
    assert "id=SPS1" not in offered

    neither = build_instruction(request(state={}, catalog={"directory": []}))
    assert "# Psikolog DeepTalk yang bisa kamu rekomendasikan" not in neither
    assert "# Rekomendasi psikolog" not in neither
