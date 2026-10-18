import os

import pytest
from pydantic import ValidationError

from agents.llm import export_vertex_env
from app.config import Settings


def test_local_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("APP_ENV", "GOOGLE_CLOUD_PROJECT", "MODEL_CHAT", "MODEL_DOCUMENT"):
        monkeypatch.delenv(key, raising=False)

    settings = Settings(_env_file=None)

    assert settings.GOOGLE_CLOUD_LOCATION == "us"
    assert settings.THINKING_CHAT == "LOW"
    assert settings.THINKING_DOCUMENT == "MEDIUM"
    assert settings.CONTEXT_CACHE == "off"
    assert settings.GOOGLE_GENAI_USE_VERTEXAI is True
    assert settings.MODEL_CHAT is None


def test_vertex_provider_requires_a_chat_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "vertex")
    monkeypatch.delenv("MODEL_CHAT", raising=False)

    with pytest.raises(ValidationError, match="MODEL_CHAT is required"):
        Settings(_env_file=None)


def test_production_rejects_the_local_model(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "APP_ENV": "production",
        "GOOGLE_CLOUD_PROJECT": "p",
        "MODEL_CHAT": "chat-model",
        "MODEL_DOCUMENT": "doc-model",
        "MODEL_PROVIDER": "local",
    }.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ValidationError, match="MODEL_PROVIDER must be 'vertex'"):
        Settings(_env_file=None)


def test_production_requires_project_and_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MODEL_PROVIDER", "vertex")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "deeptalk-ai-prod")
    monkeypatch.delenv("MODEL_CHAT", raising=False)
    monkeypatch.delenv("MODEL_DOCUMENT", raising=False)

    with pytest.raises(ValidationError, match="MODEL_CHAT, MODEL_DOCUMENT"):
        Settings(_env_file=None)


def test_empty_values_count_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_CHAT", "")
    monkeypatch.setenv("SAFETY_TIMEOUT_MS", "")

    settings = Settings(_env_file=None)

    assert settings.MODEL_CHAT is None
    assert settings.SAFETY_TIMEOUT_MS == 3000


def test_location_is_limited_to_gemini_4_regions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "asia-southeast2")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_production_processes_in_the_us(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "APP_ENV": "production",
        "GOOGLE_CLOUD_PROJECT": "p",
        "MODEL_CHAT": "gemini-4-argon",
        "MODEL_DOCUMENT": "gemini-4-argon",
        "MODEL_PROVIDER": "vertex",
        "GOOGLE_CLOUD_LOCATION": "global",
    }.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ValidationError, match="must be 'us' in production"):
        Settings(_env_file=None)


def test_production_rejects_a_key_file(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "APP_ENV": "production",
        "MODEL_PROVIDER": "vertex",
        "GOOGLE_CLOUD_PROJECT": "p",
        "GOOGLE_CLOUD_LOCATION": "us",
        "MODEL_CHAT": "chat-model",
        "MODEL_DOCUMENT": "doc-model",
        "GOOGLE_APPLICATION_CREDENTIALS": "/keys/sa.json",
    }.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ValidationError, match="GOOGLE_APPLICATION_CREDENTIALS"):
        Settings(_env_file=None)


def test_key_file_from_env_file_reaches_the_process(monkeypatch: pytest.MonkeyPatch) -> None:
    environ: dict[str, str] = {}
    monkeypatch.setattr(os, "environ", environ)
    settings = Settings(
        _env_file=None,
        MODEL_PROVIDER="vertex",
        MODEL_CHAT="chat-model",
        GOOGLE_APPLICATION_CREDENTIALS="/keys/sa.json",
    )

    export_vertex_env(settings)

    assert environ["GOOGLE_APPLICATION_CREDENTIALS"] == "/keys/sa.json"
