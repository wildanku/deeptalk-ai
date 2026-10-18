"""JSON logs for Cloud Logging.

Never log conversation content, prompts, or model output — log IDs, levels, timings, and
model/prompt versions only (AGENT.md rule 4).
"""

import json
import logging
from datetime import UTC, datetime
from typing import override

from app.tracing import current_trace


class CloudLoggingFormatter(logging.Formatter):
    def __init__(self, project_id: str | None = None) -> None:
        super().__init__()
        self._project_id = project_id

    @override
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "severity": record.levelname,
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        trace = current_trace.get()
        if trace and self._project_id:
            # Cloud Logging attaches the line to the gateway's trace (02 §12.2).
            entry["logging.googleapis.com/trace"] = (
                f"projects/{self._project_id}/traces/{trace.trace_id}"
            )
            entry["logging.googleapis.com/spanId"] = trace.span_id
            entry["logging.googleapis.com/trace_sampled"] = trace.sampled
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            # Numbers and enums only (e.g. per-step timings), for log-based metrics.
            entry.update(fields)
        if record.exc_info and record.exc_info[0] is not None:
            # Exception type only: messages can echo prompt or model text.
            entry["error"] = record.exc_info[0].__name__
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(level: str, project_id: str | None = None) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(CloudLoggingFormatter(project_id))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn installs its own plain-text handlers before importing the app; route them to root.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
