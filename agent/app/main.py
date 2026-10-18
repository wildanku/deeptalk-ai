import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from agents.llm import Models
from agents.safety import SafetyClassifier
from app.config import get_settings
from app.logging import configure_logging
from app.routes import v1
from app.tracing import TraceContextMiddleware
from app.turn import TurnRunner

logger = logging.getLogger("agent.main")


async def _warm_up(models: Models) -> None:
    try:
        await models.warm_up()
        logger.info("model warm-up done")
    except Exception as error:
        # Type only; a failed warm-up just means the first turn pays the setup cost.
        logger.warning("model warm-up failed: %s", type(error).__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL, settings.GOOGLE_CLOUD_PROJECT)
    models = Models(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # In the background: /health answers at once, Cloud Run's startup probe is not held.
        task = asyncio.create_task(_warm_up(models)) if settings.MODEL_WARMUP else None
        yield
        if task and not task.done():
            task.cancel()

    app = FastAPI(
        lifespan=lifespan,
        title="deeptalk-ai-agent",
        version="0.1.0",
        # Internal service: no public API docs.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")  # not /healthz: Cloud Run reserves some paths ending in "z"
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    classifier = SafetyClassifier(models, settings.SAFETY_TIMEOUT_MS)
    app.state.settings = settings
    app.state.models = models
    app.state.classifier = classifier
    app.state.turn_runner = TurnRunner(models, classifier, settings)
    app.add_middleware(TraceContextMiddleware)
    app.include_router(v1.router)
    return app


app = create_app()
