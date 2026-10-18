import json
import logging
import sys

from fastapi.testclient import TestClient

from app.logging import CloudLoggingFormatter
from app.main import create_app

client = TestClient(create_app())


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_no_public_api_docs() -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_log_formatter_never_includes_exception_messages() -> None:
    try:
        raise ValueError("isi pesan pengguna")
    except ValueError:
        exc_info = sys.exc_info()
    record = logging.LogRecord("agent", logging.ERROR, __file__, 1, "turn failed", None, exc_info)

    output = CloudLoggingFormatter().format(record)

    assert "isi pesan pengguna" not in output
    assert json.loads(output) == {
        "severity": "ERROR",
        "time": json.loads(output)["time"],
        "logger": "agent",
        "message": "turn failed",
        "error": "ValueError",
    }
