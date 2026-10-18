"""One conversation turn (02 §6.4, §7.1-§7.4).

    L2 classification ─┐
                       ├─► `safety` event ─► crisis? stop (no persona text ever leaves)
    persona generation ┘                     else release tokens through L3 ─► `done` ─► cards

The persona starts immediately so the reply is not delayed by L2, but its output is queued and
only released after the verdict (safety gate, A7). The gateway holds tokens until `safety` too.

`done` goes out before the card decision, so the gateway stores and shows the reply without
waiting for one more model call; `structured` events (if any) follow it on the same stream.

Every step is bounded: no first persona token within PERSONA_FIRST_TOKEN_TIMEOUT_MS → the request
is started once more (nothing was released yet); past PERSONA_TIMEOUT_MS → `MODEL_TIMEOUT`; cards
past CARDS_TIMEOUT_MS are skipped. One `turn timing` log line per turn carries the step durations.
"""

import asyncio
import logging
import time
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import asdict, dataclass, field
from typing import Literal

from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.apps import App
from google.adk.events import Event

from agents import cards
from agents.llm import Models
from agents.persona import build_persona_agent
from agents.run import APP_NAME, stream_events, text_of
from agents.safety import L3Stream, SafetyClassifier
from app.config import Settings
from app.contract import TurnRequest
from app.schemas import RiskLevel, TurnEvent
from prompts import ACTIVE_GLOBAL_VERSION

logger = logging.getLogger("agent.turn")

# A retry needs at least this much of the persona budget left to be worth starting.
MIN_RETRY_BUDGET_S = 5.0


@dataclass(frozen=True)
class TurnStreamEvent:
    event: TurnEvent
    data: dict[str, object]


QueueItem = tuple[Literal["partial", "final", "end", "error"], str | None]


EMPTY_USAGE: dict[str, int] = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0}


def record_usage(usage: dict[str, int], event: Event) -> None:
    """Keeps the latest token counts reported by the model (the final chunk has the totals)."""
    meta = event.usage_metadata
    if meta is None:
        return
    usage["input_tokens"] = max(usage["input_tokens"], meta.prompt_token_count or 0)
    usage["output_tokens"] = max(usage["output_tokens"], meta.candidates_token_count or 0)
    usage["cached_tokens"] = max(usage["cached_tokens"], meta.cached_content_token_count or 0)


@dataclass
class TurnTiming:
    """Step durations of one turn, in ms (-1 = step not reached). No content, ever."""

    started: float = field(default_factory=time.monotonic, repr=False)
    outcome: str = "exception"
    risk: str = ""
    l2_ms: int = -1
    l2_timed_out: bool = False
    persona_first_token_ms: int = -1
    persona_ms: int = -1
    persona_retried: bool = False
    cards_ms: int = -1
    cards_timed_out: bool = False
    total_ms: int = -1

    def since_start(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def fields(self) -> dict[str, object]:
        values = asdict(self)
        values.pop("started")
        return values


class TurnRunner:
    def __init__(self, models: Models, classifier: SafetyClassifier, settings: Settings) -> None:
        self._models = models
        self._classifier = classifier
        self._max_output_tokens = settings.MAX_OUTPUT_TOKENS
        self._first_token_timeout = settings.PERSONA_FIRST_TOKEN_TIMEOUT_MS / 1000
        self._persona_timeout = settings.PERSONA_TIMEOUT_MS / 1000
        self._cards_timeout = settings.CARDS_TIMEOUT_MS / 1000
        # Static parts (global rules, Persona Card, knowledge) dominate the prompt (02 §7.3).
        # Gemini 4 Argon caches that prefix implicitly; explicit caching is opt-in for models
        # that support it (`CONTEXT_CACHE=explicit`).
        self._cache = (
            ContextCacheConfig(ttl_seconds=900, cache_intervals=20, min_tokens=2048)
            if settings.CONTEXT_CACHE == "explicit" and not models.local
            else None
        )

    def _done(
        self,
        content: str,
        *,
        replaced: bool = False,
        aborted: bool = False,
        usage: dict[str, int] | None = None,
    ) -> TurnStreamEvent:
        return TurnStreamEvent(
            TurnEvent.DONE,
            {
                "content": content,
                "model": self._models.name("chat"),
                "prompt_version": ACTIVE_GLOBAL_VERSION,
                "replaced": replaced,
                "aborted": aborted,
                # Persona generation only (02 §12.3); classifier and card calls are small
                # requests not counted here.
                "usage": usage or dict(EMPTY_USAGE),
            },
        )

    async def stream(self, request: TurnRequest) -> AsyncIterator[TurnStreamEvent]:
        timing = TurnTiming()
        inner = self._stream(request, timing)
        try:
            async for item in inner:
                yield item
        finally:
            # Closed explicitly: when the gateway hangs up, the persona task is cancelled now,
            # not whenever the abandoned generator is collected.
            await inner.aclose()
            timing.total_ms = timing.since_start()
            logger.info(
                "turn timing: outcome=%s total=%d ms",
                timing.outcome,
                timing.total_ms,
                extra={"fields": {"turn_timing": timing.fields()}},
            )

    async def _stream(
        self, request: TurnRequest, timing: TurnTiming
    ) -> AsyncGenerator[TurnStreamEvent]:
        agent = build_persona_agent(
            self._models.persona(),
            request,
            self._models.generate_config("chat", self._max_output_tokens),
        )
        app = (
            App(name=APP_NAME, root_agent=agent, context_cache_config=self._cache)
            if self._cache
            else None
        )
        usage = dict(EMPTY_USAGE)

        async def produce(queue: asyncio.Queue[QueueItem]) -> None:
            try:
                async for event in stream_events(agent, request.message, request.history, app):
                    record_usage(usage, event)
                    text = text_of(event)
                    if text is None:
                        continue
                    if event.partial:
                        await queue.put(("partial", text))
                    elif event.is_final_response():
                        await queue.put(("final", text))
                await queue.put(("end", None))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Type only: model errors can echo prompt text.
                logger.error("persona failed: %s", type(error).__name__)
                await queue.put(("error", type(error).__name__))

        def start() -> tuple[asyncio.Queue[QueueItem], asyncio.Task[None], float]:
            # A fresh queue per attempt: an abandoned attempt can never leak into the next one.
            queue: asyncio.Queue[QueueItem] = asyncio.Queue()
            return queue, asyncio.create_task(produce(queue)), time.monotonic()

        persona_started = time.monotonic()
        queue, producer, attempt_started = start()
        try:
            verdict = await self._classifier.classify(request.message, request.history)
            timing.l2_ms = timing.since_start()
            timing.l2_timed_out = verdict.timed_out
            timing.risk = verdict.level.value
            yield TurnStreamEvent(
                TurnEvent.SAFETY,
                {
                    "level": verdict.level.value,
                    "signals": verdict.signals,
                    "timed_out": verdict.timed_out,
                },
            )
            if verdict.level == RiskLevel.CRISIS:
                producer.cancel()
                timing.outcome = "crisis"
                yield self._done("", aborted=True)
                return

            l3 = L3Stream()
            partials: list[str] = []
            final: str | None = None
            first = True
            while True:
                now = time.monotonic()
                budget = self._persona_timeout - (now - persona_started)
                wait = budget
                if first:
                    wait = min(budget, self._first_token_timeout - (now - attempt_started))
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=max(wait, 0))
                except TimeoutError:
                    if first and not timing.persona_retried and budget >= MIN_RETRY_BUDGET_S:
                        # Nothing was released yet, so a second attempt is invisible to the user.
                        logger.warning("persona first token late; retrying once")
                        producer.cancel()
                        timing.persona_retried = True
                        queue, producer, attempt_started = start()
                        continue
                    logger.warning("persona timed out (first_token=%s)", first)
                    timing.outcome = "model_timeout"
                    yield TurnStreamEvent(TurnEvent.ERROR, {"code": "MODEL_TIMEOUT"})
                    return
                if first:
                    first = False
                    timing.persona_first_token_ms = timing.since_start()
                if kind == "partial" and value is not None:
                    partials.append(value)
                    safe = l3.feed(value)
                    if safe:
                        yield TurnStreamEvent(TurnEvent.TOKEN, {"delta": safe})
                elif kind == "final":
                    final = value
                elif kind == "end":
                    break
                else:
                    timing.outcome = "model_error"
                    yield TurnStreamEvent(TurnEvent.ERROR, {"code": "MODEL_ERROR"})
                    return
            timing.persona_ms = int((time.monotonic() - persona_started) * 1000)

            text = final if final is not None else "".join(partials)
            if not text.strip():
                timing.outcome = "empty"
                yield TurnStreamEvent(TurnEvent.ERROR, {"code": "EMPTY_RESPONSE"})
                return
            content, replaced = l3.finish(text)
            if replaced:
                logger.warning("L3 replaced reply: %s", ",".join(l3.violations))
            else:
                rest = l3.rest(text)
                if rest:
                    yield TurnStreamEvent(TurnEvent.TOKEN, {"delta": rest})
            timing.outcome = "ok"
            yield self._done(content, replaced=replaced, usage=usage)

            if not replaced:
                async for card in self._cards(request, content, timing):
                    yield card
        finally:
            if not producer.done():
                producer.cancel()

    async def _cards(
        self, request: TurnRequest, content: str, timing: TurnTiming
    ) -> AsyncIterator[TurnStreamEvent]:
        """Cards after `done`: optional, bounded, never able to delay or break the reply."""
        started = time.monotonic()
        try:
            decision = await asyncio.wait_for(
                cards.decide(self._models, request, content), timeout=self._cards_timeout
            )
        except TimeoutError:
            timing.cards_timed_out = True
            logger.warning("card decision timed out")
            return
        finally:
            timing.cards_ms = int((time.monotonic() - started) * 1000)
        for kind_name in ("routine", "assessment", "handoff", "recommendation"):
            card = getattr(decision, kind_name)
            if card is not None:
                yield TurnStreamEvent(
                    TurnEvent.STRUCTURED,
                    # No nulls on the wire: optional fields are simply absent.
                    {"type": kind_name, "data": card.model_dump(exclude_none=True)},
                )


def build_turn_runner(settings: Settings) -> TurnRunner:
    models = Models(settings)
    return TurnRunner(models, SafetyClassifier(models, settings.SAFETY_TIMEOUT_MS), settings)
