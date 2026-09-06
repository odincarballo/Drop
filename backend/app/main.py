import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from yt_dlp.version import __version__ as yt_dlp_version  # type: ignore[import-untyped]

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.core.config import Settings
from app.providers.direct import DirectMediaProvider
from app.providers.mock import MockMediaProvider
from app.providers.registry import MediaProviderRegistry
from app.providers.youtube import YouTubeProvider
from app.services.access import APIAccessGuard
from app.services.analysis import AnalysisService
from app.services.catalog import InMemoryMediaCatalog
from app.services.http import AiohttpPinnedTransport, SafeHTTPClient
from app.services.jobs import JobManager
from app.services.media_processing import FFmpegMediaProcessor, FFprobeService
from app.services.url_safety import URLSafetyPolicy
from app.services.youtube import YtDlpYouTubeExtractor
from app.storage.local import LocalTemporaryStorage

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    storage = LocalTemporaryStorage(config.temp_directory, config.temp_file_ttl)
    url_policy = URLSafetyPolicy(config)
    http_client = SafeHTTPClient(url_policy, AiohttpPinnedTransport(config), config)
    catalog = InMemoryMediaCatalog(config.temp_file_ttl)
    direct_provider = DirectMediaProvider(http_client, catalog)
    probe_service = FFprobeService(config.ffprobe_path, config.media_processing_timeout_seconds)
    media_processor = FFmpegMediaProcessor(config, probe_service)
    youtube_provider = YouTubeProvider(
        YtDlpYouTubeExtractor(config, url_policy), catalog, url_policy, config
    )
    download_provider = MediaProviderRegistry([youtube_provider, direct_provider])
    analysis_provider = (
        MockMediaProvider()
        if config.analysis_provider == "mock"
        else direct_provider
        if config.analysis_provider == "direct"
        else download_provider
    )
    job_manager = JobManager(
        download_provider, http_client, storage, config, processor=media_processor
    )
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
        if config.analysis_provider == "auto":
            ffmpeg_version, ffprobe_version = await asyncio.gather(
                media_processor.version(), probe_service.version()
            )
            logger.info(
                "Media engines ready yt_dlp=%s ffmpeg=%s ffprobe=%s",
                yt_dlp_version,
                ffmpeg_version.split(" ", 3)[2] if " " in ffmpeg_version else "available",
                ffprobe_version.split(" ", 3)[2] if " " in ffprobe_version else "available",
            )
        janitor = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            janitor.cancel()
            with suppress(asyncio.CancelledError):
                await janitor
            await job_manager.shutdown()

    app = FastAPI(title=config.app_name, version="0.6.0", lifespan=lifespan)
    app.state.settings = config
    app.state.temporary_storage = storage
    app.state.analysis_service = AnalysisService(analysis_provider, url_policy, config)
    app.state.direct_provider = direct_provider
    app.state.youtube_provider = youtube_provider
    app.state.media_processor = media_processor
    app.state.media_catalog = catalog
    app.state.job_manager = job_manager
    app.state.access_guard = access_guard
    register_error_handlers(app)
    app.include_router(router)
    return app


app = create_app()
