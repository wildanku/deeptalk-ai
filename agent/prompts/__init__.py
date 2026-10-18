"""Versioned prompts (02 §7.3). One file per version; never edit a version used in production.

Every Phase 1-3 prompt is DRAFT (engineering placeholders) until reviewed by psikolog.
"""

from functools import cache
from pathlib import Path

PROMPT_DIR = Path(__file__).parent

ACTIVE = {
    "global": "global-v2-draft",
    "safety": "safety-v0-draft",
    "router": "router-v1-draft",
    "summary": "summary-v0-draft",
    "handoff": "handoff-v0-draft",
    "cards": "cards-v1-draft",
    "state": "state-v0-draft",
    "persona_draft": "persona_draft-v0-draft",
}
# Kept for callers that only need the persona prompt version.
ACTIVE_GLOBAL_VERSION = ACTIVE["global"]


def _path(version: str) -> Path:
    kind, _, rest = version.rpartition("-v")
    rest = f"v{rest}"
    return PROMPT_DIR / kind / f"{rest}.md"


@cache
def prompt(version: str) -> str:
    text = _path(version).read_text(encoding="utf-8")
    # Drop the leading HTML comment (review status) — it is for humans, not the model.
    if text.startswith("<!--"):
        text = text.split("-->", 1)[1]
    return text.strip()


def active(kind: str) -> str:
    return prompt(ACTIVE[kind])


def global_rules(version: str = ACTIVE_GLOBAL_VERSION) -> str:
    return prompt(version)


@cache
def state_guidance() -> dict[str, str]:
    """`## name` sections of the state prompt."""
    sections: dict[str, str] = {}
    current: str | None = None
    for line in active("state").splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return {key: value.strip() for key, value in sections.items()}


def is_draft(version: str) -> bool:
    return "draft" in version
