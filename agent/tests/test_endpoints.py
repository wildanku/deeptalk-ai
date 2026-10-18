from fastapi.testclient import TestClient

from app.main import create_app

c = TestClient(create_app())

PERSONAS = [
    {"id": "a", "display_name": "A", "approach": "x", "focus_topics": ["kecemasan"]},
    {"id": "b", "display_name": "B", "approach": "y", "focus_topics": ["rokok", "tidur"]},
]


def test_router_picks_a_persona_from_the_list_with_a_reason() -> None:
    response = c.post(
        "/v1/router/select", json={"message": "aku mau berhenti merokok", "personas": PERSONAS}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["persona_id"] == "b"
    assert body["reason"].startswith("Aku hubungkan kamu dengan pendekatan B")
    assert body["topics"] == ["rokok"]


def test_router_returns_reason_in_requested_locale() -> None:
    response = c.post(
        "/v1/router/select",
        json={
            "message": "I want to quit smoking",
            "personas": PERSONAS,
            "locale": "en",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reason"].startswith("I'm connecting you with the A approach")


def test_classify_returns_l2_only() -> None:
    body = c.post("/v1/safety/classify", json={"message": "aku ingin mati"}).json()
    assert body == {"level": "crisis", "signals": ["local:crisis_keyword"], "timed_out": False}


def test_summary() -> None:
    body = c.post(
        "/v1/session/summary",
        json={
            "history": [
                {"role": "user", "content": "halo"},
                {"role": "assistant", "content": "hai"},
            ]
        },
    ).json()
    assert body["summary"]
    assert body["prompt_version"] == "summary-v0-draft"


def test_handoff_draft_sections_and_fixed_disclaimer() -> None:
    body = c.post(
        "/v1/handoff/draft",
        json={
            "history": [{"role": "user", "content": "aku sulit tidur dan cemas"}],
            "psikolog": {"id": "p1", "name": "Bu A", "specialists": ["Kecemasan"]},
            "reason": "cemas berkepanjangan",
        },
    ).json()
    assert body["sections"][0]["id"] == "keluhan"
    assert body["disclaimer"] == "Observasi dari percakapan dengan AI, bukan diagnosis."


CARD = {
    "approach": "Pendekatan sintetis untuk pengujian.",
    "focus_topics": ["kecemasan"],
    "tone": "hangat",
    "techniques": [],
    "questioning_style": "terbuka",
    "always_say": [],
    "never_say": [],
    "opening": "Hai",
    "few_shots": [],
}


def test_persona_draft_returns_a_card_without_few_shots() -> None:
    response = c.post(
        "/v1/persona/draft",
        json={
            "display_name": "Reflektif",
            "answers": [{"question": "Pendekatan?", "answer": "Sintetis"}],
            "few_shots": [{"scenario": "kasus sintetis", "response": "jawaban sintetis"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["prompt_version"] == "persona_draft-v0-draft"
    assert "few_shots" not in body["card"]
    assert body["card"]["approach"]


def test_eval_run_goes_through_l2_and_l3() -> None:
    body = c.post(
        "/v1/eval/run",
        json={
            "persona": {"id": "p", "display_name": "P", "version": 1, "card": CARD},
            "cases": [
                {"case_id": "normal", "scenario": "aku sulit tidur"},
                {"case_id": "l3", "scenario": "[uji-l3] obat apa"},
                {"case_id": "crisis", "scenario": "aku ingin mati"},
            ],
        },
    ).json()
    results = {r["case_id"]: r for r in body["results"]}
    assert results["normal"]["risk_level"] == "normal"
    assert results["normal"]["replaced"] is False
    assert results["normal"]["response"]
    assert results["l3"]["replaced"] is True
    assert results["crisis"]["risk_level"] == "crisis"
    assert "protokol krisis" in results["crisis"]["response"]
