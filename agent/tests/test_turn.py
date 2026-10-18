import asyncio
import json
import time
from collections.abc import AsyncGenerator
from typing import Any, override

import pytest
from fastapi.testclient import TestClient
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

from agents.safety import SafetyClassifier
from app.config import Settings
from app.main import create_app
from app.turn import TurnRunner
from prompts import ACTIVE_GLOBAL_VERSION, global_rules
from tests.conftest import FailingLlm, PersonaOverride, RecordingLlm
from tests.sse import parse_sse


def test_global_prompt_sets_multilingual_notice_and_translation_limits() -> None:
    rules = global_rules()

    assert ACTIVE_GLOBAL_VERSION == "global-v2-draft"
    assert "Jawab dalam bahasa yang digunakan pengguna pada pesan terakhir" in rules
    assert "Pada balasan pertama dalam Bahasa selain Indonesia" in rules
    assert (
        "basis pelatihan dan fine-tuning khusus DeepTalk AI saat ini hanya mencakup "
        "Bahasa Indonesia" in rules
    )
    assert (
        "Penilaian keselamatan dan materi klinis belum divalidasi khusus untuk bahasa lain" in rules
    )
    assert "tanyakan maksudnya" in rules


PERSONA = {
    "id": "p1",
    "display_name": "Contoh",
    "version": 1,
    "card": {
        "approach": "Pendekatan humanistik",
        "focus_topics": ["rokok"],
        "tone": "Hangat",
        "techniques": ["Refleksi"],
        "questioning_style": "Satu pertanyaan terbuka",
        "never_say": ["Kamu harus"],
        "opening": "Hai",
        "few_shots": [{"user": "aku capek", "assistant": "Kedengarannya berat."}],
    },
}

CATALOG = {
    "routine_items": [
        {"id": "smk_a", "topic": "rokok", "title": "A", "description": "a"},
        {"id": "smk_b", "topic": "rokok", "title": "B", "description": "b"},
    ],
    "assessments": [{"id": "asm_1", "title": "Tes Kecemasan", "topic": "kecemasan"}],
    "psikologs": [{"id": "psy_1", "name": "Bu A", "specialists": ["Kecemasan"]}],
}


def client(persona: Any = None, settings: Settings | None = None) -> TestClient:
    settings = settings or Settings(_env_file=None)
    app = create_app()
    if persona is not None:
        models = PersonaOverride(persona, settings)
        classifier = SafetyClassifier(models, settings.SAFETY_TIMEOUT_MS)
        app.state.models = models
        app.state.classifier = classifier
        app.state.turn_runner = TurnRunner(models, classifier, settings)
    return TestClient(app)


def turn(c: TestClient, **body: Any) -> list[tuple[str, dict[str, object]]]:
    response = c.post("/v1/turn", json={"session_id": "s1", "message": "halo", **body})
    assert response.status_code == 200
    return parse_sse(response.text)


def test_safety_verdict_comes_first_then_tokens_then_done() -> None:
    llm = RecordingLlm()
    events = turn(
        client(llm),
        message="aku capek",
        history=[{"role": "user", "content": "halo"}, {"role": "assistant", "content": "hai"}],
        persona=PERSONA,
        knowledge=[{"topic": "rokok", "title": "Materi Rokok", "content": "isi materi"}],
        memory={
            "summaries": ["Minggu lalu bercerita soal kantor."],
            "profile": {"nickname": "Rani", "gender": "female"},
        },
    )

    names = [name for name, _ in events]
    assert names[0] == "safety"
    assert events[0][1] == {"level": "normal", "signals": [], "timed_out": False}
    assert names[-1] == "done"
    done = events[-1][1]
    assert done["replaced"] is False
    assert done["prompt_version"] == ACTIVE_GLOBAL_VERSION
    usage = done["usage"]
    assert isinstance(usage, dict) and set(usage) == {
        "input_tokens",
        "output_tokens",
        "cached_tokens",
    }
    streamed = "".join(str(data["delta"]) for name, data in events if name == "token")
    assert streamed.strip() == str(done["content"]).strip() == "Halo juga."

    instruction = str(llm.requests[0].config.system_instruction)
    for expected in [
        global_rules(),
        "DeepTalk AI dengan pendekatan Contoh",
        "Pendekatan humanistik",
        "Kamu harus",
        "Kedengarannya berat.",
        "Materi Rokok",
        "Minggu lalu bercerita soal kantor.",
        "Rani",
        "Jenis kelamin: perempuan.",
    ]:
        assert expected in instruction
    # Order of 02 §7.3: global rules before persona before knowledge before memory.
    order = [
        instruction.index(x)
        for x in [global_rules()[:40], "# Pendekatan", "# Pengetahuan", "# Yang kamu ingat"]
    ]
    assert order == sorted(order)


def test_crisis_verdict_stops_the_persona_entirely() -> None:
    llm = RecordingLlm(reply="teks persona yang tidak boleh tampil")
    events = turn(client(llm), message="aku ingin mati saja")

    assert events[0] == (
        "safety",
        {"level": "crisis", "signals": ["local:crisis_keyword"], "timed_out": False},
    )
    assert [name for name, _ in events] == ["safety", "done"]
    assert events[1][1]["aborted"] is True
    assert "teks persona" not in str(events)


def test_l3_replaces_medication_advice_before_it_streams() -> None:
    events = turn(client(), message="[uji-l3] susah tidur")

    streamed = "".join(str(data["delta"]) for name, data in events if name == "token")
    assert "sertraline" not in streamed
    assert "50 mg" not in streamed
    done = events[-1][1]
    assert done["replaced"] is True
    assert "tidak bisa memberi diagnosis atau saran obat" in str(done["content"])
    assert not any(name == "structured" for name, _ in events)


def test_l2_timeout_marks_the_turn_elevated() -> None:
    settings = Settings(_env_file=None, LOCAL_SAFETY_DELAY_MS=400, SAFETY_TIMEOUT_MS=50)
    events = turn(client(RecordingLlm(), settings))

    assert events[0][1] == {"level": "elevated", "signals": ["l2:timeout"], "timed_out": True}
    assert events[-1][0] == "done"


def test_cards_only_from_the_catalog_and_only_when_allowed() -> None:
    allowed = turn(
        client(),
        message="aku mau rutinitas buat berhenti rokok, sama tes asesmen, dan psikolog",
        state={"allow_routine": True, "allow_assessment": True, "allow_handoff": True},
        catalog=CATALOG,
    )
    cards = {data["type"]: data["data"] for name, data in allowed if name == "structured"}
    # No nulls on the wire (the gateway's schemas treat optional as absent).
    assert "None" not in str(cards) and "null" not in str(allowed)
    assert cards["routine"]["items"] == [{"library_item_id": "smk_a"}, {"library_item_id": "smk_b"}]  # type: ignore[index]
    assert cards["assessment"]["assessment_id"] == "asm_1"  # type: ignore[index]
    assert cards["handoff"]["psikolog_id"] == "psy_1"  # type: ignore[index]

    not_allowed = turn(
        client(),
        message="aku mau rutinitas buat berhenti rokok",
        catalog=CATALOG,
    )
    assert not any(name == "structured" for name, _ in not_allowed)


def test_model_failure_becomes_an_error_event_without_details() -> None:
    response = client(FailingLlm()).post("/v1/turn", json={"session_id": "s1", "message": "x"})

    events = parse_sse(response.text)
    assert events[0][0] == "safety"
    assert events[-1] == ("error", {"code": "MODEL_ERROR"})
    assert "isi pesan" not in response.text


def test_failure_before_the_safety_verdict_is_an_explicit_error(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A crash while building the persona used to close the stream silently, which the gateway
    could only report as a missing safety verdict."""

    def broken(*_args: object, **_kwargs: object) -> None:
        raise ValueError("isi pesan pengguna")

    monkeypatch.setattr("app.turn.build_persona_agent", broken)
    response = client().post("/v1/turn", json={"session_id": "s1", "message": "x"})
    logs = "".join(capsys.readouterr())

    assert parse_sse(response.text) == [("error", {"code": "AGENT_ERROR"})]
    assert "turn failed: ValueError at test_turn.py:" in logs
    assert "isi pesan" not in logs and "isi pesan" not in response.text


def test_rejects_oversized_or_empty_messages() -> None:
    c = TestClient(create_app())
    assert c.post("/v1/turn", json={"session_id": "s", "message": ""}).status_code == 422
    assert c.post("/v1/turn", json={"session_id": "s", "message": "a" * 2001}).status_code == 422


def test_record_usage_keeps_the_final_totals() -> None:
    from google.adk.events import Event
    from google.genai import types

    from app.turn import EMPTY_USAGE, record_usage

    usage = dict(EMPTY_USAGE)
    for prompt, out in [(100, 5), (100, 42)]:
        record_usage(
            usage,
            Event(
                author="persona",
                usage_metadata=types.GenerateContentResponseUsageMetadata(
                    prompt_token_count=prompt, candidates_token_count=out
                ),
            ),
        )
    record_usage(usage, Event(author="persona"))
    assert usage == {"input_tokens": 100, "output_tokens": 42, "cached_tokens": 0}


class StallingLlm(RecordingLlm):
    """Hangs before the first token for the first `stalls` attempts, then replies normally."""

    stalls: int = 1
    attempts: int = 0

    @override
    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.attempts += 1
        if self.attempts <= self.stalls:
            await asyncio.sleep(30)
        async for response in super().generate_content_async(llm_request, stream):
            yield response


def test_done_is_sent_before_the_cards() -> None:
    events = turn(
        client(),
        message="aku mau rutinitas buat berhenti rokok",
        state={"allow_routine": True},
        catalog=CATALOG,
    )

    names = [name for name, _ in events]
    assert "structured" in names
    assert names.index("done") < names.index("structured")


def test_slow_card_decision_never_holds_the_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(*_args: object, **_kwargs: object) -> None:
        await asyncio.sleep(30)

    monkeypatch.setattr("app.turn.cards.decide", slow)
    settings = Settings(_env_file=None, CARDS_TIMEOUT_MS=50)
    started = time.monotonic()
    events = turn(
        client(RecordingLlm(), settings),
        state={"allow_routine": True},
        catalog=CATALOG,
    )

    assert time.monotonic() - started < 5
    assert events[-1][0] == "done"
    assert not any(name == "structured" for name, _ in events)


def test_late_first_token_is_retried_once_invisibly() -> None:
    llm = StallingLlm(stalls=1)
    settings = Settings(
        _env_file=None, PERSONA_FIRST_TOKEN_TIMEOUT_MS=100, PERSONA_TIMEOUT_MS=10000
    )
    events = turn(client(llm, settings))

    assert llm.attempts == 2
    assert events[-1][0] == "done"
    streamed = "".join(str(data["delta"]) for name, data in events if name == "token")
    assert streamed.strip() == "Halo juga."


def test_persona_that_never_answers_ends_with_model_timeout(
    capsys: pytest.CaptureFixture[str],
) -> None:
    llm = StallingLlm(stalls=5)
    settings = Settings(_env_file=None, PERSONA_FIRST_TOKEN_TIMEOUT_MS=100, PERSONA_TIMEOUT_MS=5200)
    started = time.monotonic()
    events = turn(client(llm, settings))
    logs = "".join(capsys.readouterr())

    assert time.monotonic() - started < 10
    assert llm.attempts == 2
    assert events[0][0] == "safety"
    assert events[-1] == ("error", {"code": "MODEL_TIMEOUT"})
    assert '"outcome": "model_timeout"' in logs
    assert '"persona_retried": true' in logs


def test_every_turn_logs_step_timings_without_content(
    capsys: pytest.CaptureFixture[str],
) -> None:
    turn(client(RecordingLlm()), message="rahasia pengguna")
    logs = "".join(capsys.readouterr())

    line = next(line for line in logs.splitlines() if "turn timing" in line)
    timing = json.loads(line)["turn_timing"]
    assert timing["outcome"] == "ok"
    assert timing["l2_ms"] >= 0 and timing["persona_first_token_ms"] >= 0
    assert timing["total_ms"] >= timing["persona_ms"] >= 0
    assert "rahasia" not in logs
