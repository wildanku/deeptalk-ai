"""Run an ADK agent once, with an in-memory session that lives only for this call."""

import uuid
from collections.abc import AsyncIterator, Sequence

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps import App
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

from app.contract import HistoryMessage

APP_NAME = "deeptalk-ai"


def text_of(event: Event) -> str | None:
    if not event.content or not event.content.parts:
        return None
    text = "".join(part.text for part in event.content.parts if part.text)
    return text or None


async def _runner(
    agent: LlmAgent, history: Sequence[HistoryMessage], app: App | None
) -> tuple[Runner, str, str]:
    sessions = InMemorySessionService()
    runner = (
        Runner(app=app, session_service=sessions)
        if app
        else Runner(app_name=APP_NAME, agent=agent, session_service=sessions)
    )
    session_id = str(uuid.uuid4())
    # ADK's user id never leaves this process.
    user_id = "gateway"
    session = await sessions.create_session(
        app_name=app.name if app else APP_NAME, user_id=user_id, session_id=session_id
    )
    for index, item in enumerate(history):
        await sessions.append_event(
            session,
            Event(
                author="user" if item.role == "user" else agent.name,
                invocation_id=f"history-{index}",
                content=types.Content(
                    role="user" if item.role == "user" else "model",
                    parts=[types.Part(text=item.content)],
                ),
            ),
        )
    return runner, user_id, session_id


async def stream_events(
    agent: LlmAgent,
    message: str,
    history: Sequence[HistoryMessage] = (),
    app: App | None = None,
) -> AsyncIterator[Event]:
    runner, user_id, session_id = await _runner(agent, history, app)
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=types.Content(role="user", parts=[types.Part(text=message)]),
        run_config=RunConfig(streaming_mode=StreamingMode.SSE),
    ):
        yield event


async def run_text(agent: LlmAgent, message: str, history: Sequence[HistoryMessage] = ()) -> str:
    final: str | None = None
    async for event in stream_events(agent, message, history):
        if not event.partial and event.is_final_response():
            final = text_of(event) or final
    return final or ""


async def run_structured[T: BaseModel](
    agent: LlmAgent, message: str, schema: type[T], history: Sequence[HistoryMessage] = ()
) -> T:
    """Runs an agent declared with `output_schema=schema` and validates its JSON."""
    return schema.model_validate_json(await run_text(agent, message, history))
