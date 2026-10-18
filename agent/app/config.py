"""Runtime configuration (02 §11.1), read from the environment."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Unset locally is fine (endpoints are stubs); production must name the project and models
# explicitly — model choice is decision Q7 (01 §6), never an implicit default.
REQUIRED_IN_PRODUCTION = ("GOOGLE_CLOUD_PROJECT", "MODEL_CHAT", "MODEL_DOCUMENT")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    APP_ENV: Literal["development", "test", "production"] = "development"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Gemini Enterprise Agent Platform (formerly Vertex AI); ADK reads GOOGLE_GENAI_USE_VERTEXAI.
    # Gemini 4 Argon is served in `us`, `eu`, and `global` only, never Jakarta. Decision Q7
    # (2026-10-15): model processing in `us`, which keeps it inside one jurisdiction; stored data
    # stays in asia-southeast2. `global` gives no processing-location guarantee (02 §9.1).
    GOOGLE_CLOUD_PROJECT: str | None = None
    GOOGLE_CLOUD_LOCATION: Literal["us", "eu", "global"] = "us"
    GOOGLE_GENAI_USE_VERTEXAI: bool = True
    # Local only: path to a service account key file. google-auth reads it from the process
    # environment, so a value from .env is exported by `export_vertex_env`. Cloud Run uses the
    # attached service account instead, so production rejects key files.
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None

    # `local` = deterministic echo model (no Vertex AI) for development and tests only.
    MODEL_PROVIDER: Literal["vertex", "local"] = "local"
    # Local model only: pause between streamed words, to exercise slow turns (deploy drills).
    LOCAL_MODEL_TOKEN_DELAY_MS: int = Field(default=0, ge=0, le=5000)
    # Local model only: L2/structured latency, to exercise the safety-gate timeout.
    LOCAL_SAFETY_DELAY_MS: int = Field(default=0, ge=0, le=30000)

    # Chat tier: persona replies, router, safety L2/L3, cards, memory summary. Document tier:
    # handoff summary, persona draft. Both `gemini-4-argon` for now (02 §7).
    MODEL_CHAT: str | None = None
    MODEL_DOCUMENT: str | None = None
    # Thinking per tier. LOW keeps L2 inside SAFETY_TIMEOUT_MS; documents can think longer.
    # Argon rejects MINIMAL and `thinking_budget`, so neither is offered.
    THINKING_CHAT: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"
    THINKING_DOCUMENT: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    # ADK explicit context caching. Argon supports implicit caching only (prefix >= 6,144
    # tokens, applied automatically), so explicit caching stays off unless a model needs it.
    CONTEXT_CACHE: Literal["off", "explicit"] = "off"

    # Provisional values — tune against measured L2 latency (02 §13) and cost (§12.3).
    SAFETY_TIMEOUT_MS: int = Field(default=3000, gt=0)
    # Persona reply cap. Thinking tokens count toward it on Gemini 4, so it leaves room for
    # LOW thinking on top of a short reply.
    MAX_OUTPUT_TOKENS: int = Field(default=2048, gt=0)

    # Every model call is bounded, so a stalled Vertex request fails fast with a clear code
    # instead of running into the gateway's turn deadline. google-genai sends the HTTP timeout
    # as X-Server-Timeout too, so it caps a whole call, streaming included.
    MODEL_HTTP_TIMEOUT_MS: int = Field(default=30000, gt=0)
    # Attempts per call, including the first; 408/429/5xx and transport errors are retried with
    # backoff before any byte reaches the user.
    MODEL_RETRY_ATTEMPTS: int = Field(default=2, ge=1, le=5)
    # No persona token by then → the request is abandoned and started once more (nothing has
    # been released yet, so a retry is invisible to the user).
    PERSONA_FIRST_TOKEN_TIMEOUT_MS: int = Field(default=15000, gt=0)
    # Whole persona generation, retry included. Below the gateway's AGENT_TURN_TIMEOUT_MS, so
    # the agent always ends a slow turn first, with MODEL_TIMEOUT.
    PERSONA_TIMEOUT_MS: int = Field(default=45000, gt=0)
    # Card decision after the reply. Cards are optional: past this they are simply skipped.
    CARDS_TIMEOUT_MS: int = Field(default=8000, gt=0)
    # One tiny model call at startup, so auth, TLS and lazy imports are done before the first
    # user turn (a cold first turn once took 56 s to its first token).
    MODEL_WARMUP: bool = True

    @model_validator(mode="after")
    def _require_production_settings(self) -> Self:
        if self.APP_ENV == "production":
            missing = [key for key in REQUIRED_IN_PRODUCTION if getattr(self, key) is None]
            if missing:
                raise ValueError(f"Required in production: {', '.join(missing)}")
            if self.MODEL_PROVIDER != "vertex":
                raise ValueError("MODEL_PROVIDER must be 'vertex' in production")
            # The privacy policy, consent text, and DPIA name the US as the processing location.
            if self.GOOGLE_CLOUD_LOCATION != "us":
                raise ValueError("GOOGLE_CLOUD_LOCATION must be 'us' in production (decision Q7)")
            if self.GOOGLE_APPLICATION_CREDENTIALS is not None:
                raise ValueError(
                    "GOOGLE_APPLICATION_CREDENTIALS must not be set in production "
                    "(use the attached service account)"
                )
        if self.MODEL_PROVIDER == "vertex" and self.MODEL_CHAT is None:
            raise ValueError("MODEL_CHAT is required when MODEL_PROVIDER=vertex")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
