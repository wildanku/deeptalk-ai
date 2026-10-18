"""Model per task tier (02 §4, §7, §12.3): the chat tier for conversation and classification, the
document tier for handoff summaries and persona drafts."""

import os
from collections.abc import Callable
from typing import Any, Literal

from google.adk.models import BaseLlm, Gemini
from google.adk.models.llm_request import LlmRequest
from google.genai import types

from agents.local_llm import LOCAL_MODEL_NAME, LocalEchoLlm, LocalJsonLlm
from app.config import Settings

Tier = Literal["chat", "document"]

# Transient failures worth one more attempt before anything reaches the user.
RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504]


def export_vertex_env(settings: Settings) -> None:
    """google-genai reads these from the process environment; mirror values loaded from .env."""
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", str(settings.GOOGLE_GENAI_USE_VERTEXAI))
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.GOOGLE_CLOUD_LOCATION)
    if settings.GOOGLE_CLOUD_PROJECT:
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.GOOGLE_CLOUD_PROJECT)
    if settings.GOOGLE_APPLICATION_CREDENTIALS:
        os.environ.setdefault(
            "GOOGLE_APPLICATION_CREDENTIALS", settings.GOOGLE_APPLICATION_CREDENTIALS
        )


def http_options(settings: Settings) -> types.HttpOptions:
    return types.HttpOptions(
        timeout=settings.MODEL_HTTP_TIMEOUT_MS,
        retry_options=types.HttpRetryOptions(
            attempts=settings.MODEL_RETRY_ATTEMPTS,
            initial_delay=0.5,
            max_delay=4,
            http_status_codes=RETRY_STATUS_CODES,
        ),
    )


class Models:
    """Resolves the model for each agent. `local` swaps in deterministic stand-ins.

    On Vertex, one `Gemini` per tier is shared by every agent and request. A model name string
    would make ADK build a new `Gemini` — and with it a new client, auth lookup and TLS
    connection to `us` — for every agent of every turn. A shared instance keeps one client per
    event loop (ADK caches it per loop), so connections are reused.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._shared: dict[Tier, Gemini] = {}
        if settings.MODEL_PROVIDER == "vertex":
            export_vertex_env(settings)

    @property
    def local(self) -> bool:
        return self._settings.MODEL_PROVIDER == "local"

    def name(self, tier: Tier) -> str:
        if self.local:
            return LOCAL_MODEL_NAME
        model = self._settings.MODEL_CHAT if tier == "chat" else self._settings.MODEL_DOCUMENT
        # MODEL_DOCUMENT falls back to the chat model outside production
        # (Settings requires it in production).
        return model or self._settings.MODEL_CHAT or ""

    def gemini(self, tier: Tier) -> Gemini:
        """The shared Vertex model of a tier, with timeout and retry on every call."""
        shared = self._shared.get(tier)
        if shared is None:
            shared = Gemini(
                model=self.name(tier),
                client_kwargs={"http_options": http_options(self._settings)},
            )
            self._shared[tier] = shared
        return shared

    def persona(self) -> BaseLlm:
        if self.local:
            return LocalEchoLlm(token_delay_ms=self._settings.LOCAL_MODEL_TOKEN_DELAY_MS)
        return self.gemini("chat")

    def generate_config(
        self, tier: Tier, max_output_tokens: int | None = None
    ) -> types.GenerateContentConfig | None:
        """Thinking level per tier (never sent to the local stand-ins), plus an output cap."""
        thinking = (
            None
            if self.local
            else types.ThinkingConfig(
                thinking_level=types.ThinkingLevel(
                    self._settings.THINKING_CHAT
                    if tier == "chat"
                    else self._settings.THINKING_DOCUMENT
                )
            )
        )
        if thinking is None and max_output_tokens is None:
            return None
        return types.GenerateContentConfig(
            thinking_config=thinking, max_output_tokens=max_output_tokens
        )

    def structured(
        self, tier: Tier, local_responder: Callable[[LlmRequest], dict[str, Any]]
    ) -> BaseLlm:
        if self.local:
            return LocalJsonLlm(
                responder=local_responder, delay_ms=self._settings.LOCAL_SAFETY_DELAY_MS
            )
        return self.gemini(tier)

    async def warm_up(self) -> None:
        """One minimal call on the chat tier: auth, TLS and lazy imports happen now, not in the
        first user turn. No conversation content is sent."""
        if self.local:
            return
        client = self.gemini("chat").api_client
        await client.aio.models.count_tokens(model=self.name("chat"), contents="halo")
