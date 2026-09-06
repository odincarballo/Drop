from pydantic import HttpUrl

from app.core.errors import ApplicationError
from app.models.media import AvailableStreams, DownloadRequest, MediaAnalysis, PreparedDownload
from app.providers.base import MediaProvider


class MediaProviderRegistry(MediaProvider):
    """Route analysis and opaque download capabilities to isolated providers."""

    def __init__(self, providers: list[MediaProvider]) -> None:
        if not providers:
            raise ValueError("At least one media provider is required")
        self.providers = tuple(providers)

    def supports(self, url: HttpUrl) -> bool:
        return any(provider.supports(url) for provider in self.providers)

    def owns(self, media_id: str) -> bool:
        return any(provider.owns(media_id) for provider in self.providers)

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        provider = self._for_url(url)
        return await provider.analyze(url)

    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        provider = self._for_url(url)
        return await provider.get_available_streams(url)

    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        for provider in self.providers:
            if provider.owns(request.media_id):
                return await provider.prepare_download(request)
        raise ApplicationError(
            "MEDIA_EXPIRED",
            "El análisis ya no está disponible. Analiza de nuevo el enlace.",
            404,
        )

    def _for_url(self, url: HttpUrl) -> MediaProvider:
        for provider in self.providers:
            if provider.supports(url):
                return provider
        raise ApplicationError("UNSUPPORTED_URL", "No hay un proveedor para esta URL.")
