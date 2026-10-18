import json


def parse_sse(body: str) -> list[tuple[str, dict[str, object]]]:
    """Parses an SSE body into (event, data) pairs, skipping comments and pings."""
    events: list[tuple[str, dict[str, object]]] = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        name, data = None, None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = line[len("data:") :].strip()
        if name and data is not None:
            events.append((name, json.loads(data)))
    return events
