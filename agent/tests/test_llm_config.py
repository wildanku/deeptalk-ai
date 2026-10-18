import pytest
from google.genai import types

from agents.llm import Models
from app.config import Settings


def _vertex(monkeypatch: pytest.MonkeyPatch) -> Settings:
    # Models exports these for google-genai; monkeypatch restores them after the test.
    for key, value in {
        "MODEL_PROVIDER": "vertex",
        "MODEL_CHAT": "gemini-4-argon",
        "MODEL_DOCUMENT": "gemini-4-argon",
        "GOOGLE_CLOUD_PROJECT": "p",
        "GOOGLE_CLOUD_LOCATION": "us",
        "GOOGLE_GENAI_USE_VERTEXAI": "true",
    }.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


def test_local_models_never_get_a_thinking_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "local")
    models = Models(Settings(_env_file=None))

    assert models.generate_config("chat") is None
    config = models.generate_config("chat", 2048)
    assert config is not None
    assert config.thinking_config is None
    assert config.max_output_tokens == 2048


def test_thinking_level_per_tier(monkeypatch: pytest.MonkeyPatch) -> None:
    models = Models(_vertex(monkeypatch))

    chat = models.generate_config("chat", 2048)
    document = models.generate_config("document")

    assert chat is not None and chat.thinking_config is not None
    assert chat.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert chat.max_output_tokens == 2048
    assert document is not None and document.thinking_config is not None
    assert document.thinking_config.thinking_level == types.ThinkingLevel.MEDIUM
    assert document.max_output_tokens is None
    assert models.name("chat") == "gemini-4-argon"


def test_vertex_models_are_shared_with_timeout_and_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.adk.models import Gemini

    monkeypatch.setenv("MODEL_HTTP_TIMEOUT_MS", "12000")
    monkeypatch.setenv("MODEL_RETRY_ATTEMPTS", "3")
    models = Models(_vertex(monkeypatch))

    persona = models.persona()
    structured = models.structured("chat", lambda _request: {})
    assert isinstance(persona, Gemini)
    # One instance per tier: ADK keeps one client per event loop on it, so connections are
    # reused instead of rebuilt for every agent of every turn.
    assert persona is structured is models.persona()
    assert models.structured("document", lambda _request: {}) is not persona
    assert persona.model == "gemini-4-argon"
    options = (persona.client_kwargs or {})["http_options"]
    assert options.timeout == 12000
    assert options.retry_options.attempts == 3
    assert 429 in options.retry_options.http_status_codes


def test_local_models_skip_the_warm_up(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    monkeypatch.setenv("MODEL_PROVIDER", "local")
    asyncio.run(Models(Settings(_env_file=None)).warm_up())
