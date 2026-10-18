"""Deterministic stand-ins for Gemini, for local development and tests without Vertex AI.

Never available in production (`MODEL_PROVIDER=local` is rejected there by `Settings`). The
behaviour is intentionally simple and keyword-driven so integration tests are predictable.
"""

import asyncio
import json
from collections.abc import AsyncGenerator, Callable
from typing import Any, override

from google.adk.models import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

LOCAL_MODEL_NAME = "local-echo"
# Lets an integration test exercise L3 (medication + dosage in a reply).
L3_PROBE = "[uji-l3]"


def last_user_text(request: LlmRequest) -> str:
    for content in reversed(request.contents):
        if content.role == "user" and content.parts:
            return "".join(part.text or "" for part in content.parts)
    return ""


def _reply_for(request: LlmRequest) -> str:
    if L3_PROBE in last_user_text(request):
        return "Coba minum sertraline 50 mg setiap pagi supaya lebih tenang."
    turns = sum(1 for content in request.contents if content.role == "user")
    return (
        "[model lokal] Terima kasih sudah bercerita. "
        f"Ini giliran ke-{turns} kita. Aku mendengarkan."
    )


class LocalEchoLlm(BaseLlm):
    """Persona stand-in: streams a fixed reply word by word."""

    model: str = LOCAL_MODEL_NAME
    token_delay_ms: int = 0

    @override
    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        text = _reply_for(llm_request)
        if stream:
            for word in text.split(" "):
                if self.token_delay_ms:
                    await asyncio.sleep(self.token_delay_ms / 1000)
                yield LlmResponse(
                    content=types.Content(role="model", parts=[types.Part(text=f"{word} ")]),
                    partial=True,
                )
        prompt_chars = sum(
            len(part.text or "") for content in llm_request.contents for part in content.parts or []
        )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=text)]),
            partial=False,
            turn_complete=True,
            # ~4 characters per token: lets local runs exercise the cost metrics (02 §12.3).
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=prompt_chars // 4 + 1,
                candidates_token_count=len(text) // 4 + 1,
                cached_content_token_count=0,
            ),
        )


class LocalJsonLlm(BaseLlm):
    """Structured-output stand-in: returns `responder(request)` as JSON text."""

    model: str = LOCAL_MODEL_NAME
    responder: Callable[[LlmRequest], dict[str, Any]]
    delay_ms: int = 0

    @override
    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        if self.delay_ms:
            await asyncio.sleep(self.delay_ms / 1000)
        text = json.dumps(self.responder(llm_request), ensure_ascii=False)
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=text)]),
            partial=False,
            turn_complete=True,
        )


TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "rokok": ("rokok", "merokok", "nikotin"),
    "tidur": ("tidur", "insomnia", "begadang"),
    "stres_kerja": ("kerja", "kantor", "atasan", "deadline", "lembur"),
    "kecemasan": ("cemas", "khawatir", "panik", "gelisah"),
}

_CRISIS_WORDS = ("bunuh diri", "ingin mati", "mau mati", "menyakiti diri", "mengakhiri hidup")
_ELEVATED_WORDS = ("putus asa", "tidak sanggup", "ga sanggup", "tidak kuat", "capek hidup")


def local_safety(request: LlmRequest) -> dict[str, Any]:
    text = last_user_text(request).lower()
    if any(word in text for word in _CRISIS_WORDS):
        return {"level": "crisis", "signals": ["local:crisis_keyword"], "rationale": "lokal"}
    if any(word in text for word in _ELEVATED_WORDS):
        return {"level": "elevated", "signals": ["local:distress_keyword"], "rationale": "lokal"}
    return {"level": "normal", "signals": [], "rationale": "lokal"}


def topics_in(text: str) -> list[str]:
    lowered = text.lower()
    return [topic for topic, words in TOPIC_KEYWORDS.items() if any(w in lowered for w in words)]
