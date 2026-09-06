import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.core.config import Settings
from app.providers.direct import DirectMediaProvider
from app.providers.mock import MockMediaProvider
from app.services.access import APIAccessGuard
from app.services.analysis import AnalysisService
from app.services.catalog import InMemoryMediaCatalog
from app.services.http import AiohttpPinnedTransport, SafeHTTPClient
from app.services.jobs import JobManager
from app.services.url_safety import URLSafetyPolicy
from app.storage.local import LocalTemporaryStorage

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    storage = LocalTemporaryStorage(config.temp_directory, config.temp_file_ttl)
    url_policy = URLSafetyPolicy(config)
    http_client = SafeHTTPClient(url_policy, AiohttpPinnedTransport(config), config)
    catalog = InMemoryMediaCatalog(config.temp_file_ttl)
    direct_provider = DirectMediaProvider(http_client, catalog)
    analysis_provider = (
        MockMediaProvider() if config.analysis_provider == "mock" else direct_provider
    )
    job_manager = JobManager(direct_provider, http_client, storage, config)
    access_guard = APIAccessGuard(
        config.api_token,
        config.rate_limit_requests,
        config.rate_limit_window_seconds,
    )

    async def cleanup_loop() -> None:
        while True:
            await asyncio.sleep(config.temp_cleanup_interval_seconds)
            try:
                job_manager.cleanup_expired()
                catalog.cleanup_expired()
                await asyncio.to_thread(storage.cleanup_expired)
            except OSError:
                logger.error("Temporary workspace cleanup failed")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(storage.cleanup_expired)
        janitor = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            janitor.cancel()
            with suppress(asyncio.CancelledError):
                await janitor
            await job_manager.shutdown()

    app = FastAPI(title=config.app_name, version="0.3.0", lifespan=lifespan)
    app.state.settings = config
    app.state.temporary_storage = storage
    app.state.analysis_service = AnalysisService(analysis_provider, url_policy, config)
    app.state.direct_provider = direct_provider
    app.state.media_catalog = catalog
    app.state.job_manager = job_manager
    app.state.access_guard = access_guard
    register_error_handlers(app)
    app.include_router(router)
    return app


app = create_app()
