from collections.abc import AsyncGenerator
from typing import override

from google.adk.models import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from agents.llm import Models
from app.config import Settings

# Tests never read a developer's agent/.env: one with MODEL_PROVIDER=vertex would send test
# prompts to the real model and break the deterministic stand-ins.
Settings.model_config["env_file"] = None


class RecordingLlm(BaseLlm):
    """Persona stand-in that records requests and streams a fixed reply."""

    model: str = "recording"
    reply: str = "Halo juga."
    requests: list[LlmRequest] = Field(default_factory=list)

    @override
    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        for word in self.reply.split(" "):
            yield LlmResponse(
                content=types.Content(role="model", parts=[types.Part(text=f"{word} ")]),
                partial=True,
            )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=self.reply)]),
            partial=False,
        )


class FailingLlm(BaseLlm):
    model: str = "failing"

    @override
    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        raise RuntimeError("quota exceeded for prompt: isi pesan pengguna")
        yield  # pragma: no cover


class PersonaOverride(Models):
    """Local models everywhere, except the persona, which the test supplies."""

    def __init__(self, persona: BaseLlm, settings: Settings | None = None) -> None:
        super().__init__(settings or Settings(_env_file=None))
        self._persona = persona

    def persona(self) -> BaseLlm:
        return self._persona
