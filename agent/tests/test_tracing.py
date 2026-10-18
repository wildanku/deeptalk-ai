import json
import logging

from fastapi.testclient import TestClient

from app.logging import CloudLoggingFormatter
from app.main import create_app
from app.tracing import TraceContext, current_trace, parse_traceparent

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"


def test_parse_traceparent() -> None:
    assert parse_traceparent(f"00-{TRACE}-00f067aa0ba902b7-01") == TraceContext(
        TRACE, "00f067aa0ba902b7", True
    )
    assert parse_traceparent(f"00-{TRACE}-00f067aa0ba902b7-00") == TraceContext(
        TRACE, "00f067aa0ba902b7", False
    )
    assert parse_traceparent(None) is None
    assert parse_traceparent("garbage") is None
    assert parse_traceparent(f"00-{'0' * 32}-00f067aa0ba902b7-01") is None


def test_log_lines_carry_the_gateway_trace() -> None:
    formatter = CloudLoggingFormatter("proj")
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "turn completed", None, None)
    token = current_trace.set(TraceContext(TRACE, "00f067aa0ba902b7", True))
    try:
        entry = json.loads(formatter.format(record))
    finally:
        current_trace.reset(token)
    assert entry["logging.googleapis.com/trace"] == f"projects/proj/traces/{TRACE}"
    assert entry["logging.googleapis.com/spanId"] == "00f067aa0ba902b7"
    assert "logging.googleapis.com/trace" not in json.loads(formatter.format(record))


def test_middleware_sets_and_resets_the_context() -> None:
    app = create_app()
    seen: list[TraceContext | None] = []

    @app.get("/probe")
    async def probe() -> dict[str, str]:
        seen.append(current_trace.get())
        return {}

    client = TestClient(app)
    client.get("/probe", headers={"traceparent": f"00-{TRACE}-00f067aa0ba902b7-01"})
    client.get("/probe")
    assert seen[0] is not None and seen[0].trace_id == TRACE
    assert seen[1] is None
