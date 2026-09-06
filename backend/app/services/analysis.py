import asyncio

from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import MediaAnalysis
from app.providers.base import MediaProvider
from app.services.url_safety import URLSafetyPolicy


class AnalysisService:
    def __init__(
        self, provider: MediaProvider, url_policy: URLSafetyPolicy, settings: Settings
    ) -> None:
        self.provider = provider
        self.url_policy = url_policy
        self.settings = settings

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        safe_url = self.url_policy.validate_syntax(url)
        if not self.provider.supports(safe_url):
            raise ApplicationError("UNSUPPORTED_URL", "No hay un proveedor para esta URL.")
        try:
            async with asyncio.timeout(self.settings.analysis_timeout_seconds):
                analysis = await self.provider.analyze(safe_url)
        except TimeoutError as exc:
            raise ApplicationError(
                "ANALYSIS_TIMEOUT", "El análisis tardó demasiado. Inténtalo de nuevo.", 504
            ) from exc
        # Multi-format providers enforce limits after the user selects a concrete plan.
        if (
            analysis.estimated_size is not None
            and analysis.estimated_size > self.settings.max_file_size
        ):
            raise ApplicationError("MEDIA_TOO_LARGE", "El recurso supera el tamaño permitido.", 413)
        if (
            analysis.duration is not None
            and analysis.duration > self.settings.max_media_duration_seconds
        ):
            raise ApplicationError(
                "MEDIA_TOO_LONG", "El recurso supera la duración permitida.", 413
            )
        return analysis
