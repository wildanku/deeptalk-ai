"""Trace correlation with the gateway (02 §12.2), without exporting spans.

The gateway starts the trace (`ai.turn`) and sends a W3C `traceparent` header with every call.
Every log line written while handling that request carries Cloud Logging's trace fields, so
the agent's logs appear under the gateway's trace in Cloud Trace.

ADK records its own OpenTelemetry spans with prompts and model output as attributes. This
service therefore never configures a span exporter: those spans stay in-process no-ops.
"""

import re
from contextvars import ContextVar
from dataclasses import dataclass

from starlette.types import ASGIApp, Receive, Scope, Send

_TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")


@dataclass(frozen=True)
class TraceContext:
    trace_id: str
    span_id: str
    sampled: bool


current_trace: ContextVar[TraceContext | None] = ContextVar("current_trace", default=None)


def parse_traceparent(value: str | None) -> TraceContext | None:
    match = _TRACEPARENT.match((value or "").strip().lower())
    if not match or match.group(1) == "0" * 32 or match.group(2) == "0" * 16:
        return None
    return TraceContext(match.group(1), match.group(2), int(match.group(3), 16) & 1 == 1)


class TraceContextMiddleware:
    """Pure ASGI (works with streaming responses): sets `current_trace` for the request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        header = next(
            (value.decode("latin-1") for key, value in scope["headers"] if key == b"traceparent"),
            None,
        )
        token = current_trace.set(parse_traceparent(header))
        try:
            await self.app(scope, receive, send)
        finally:
            current_trace.reset(token)
