from abc import ABC, abstractmethod

from pydantic import HttpUrl

from app.models.media import AvailableStreams, DownloadRequest, MediaAnalysis, PreparedDownload


class MediaProvider(ABC):
    """Provider contract. URLs must pass URLSafetyPolicy before network access."""

    @abstractmethod
    def supports(self, url: HttpUrl) -> bool:
        """Recognize a URL without making network requests."""

    @abstractmethod
    def owns(self, media_id: str) -> bool:
        """Return whether this provider created the opaque analysis capability."""

    @abstractmethod
    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        """Return metadata; use null for unknown values."""

    @abstractmethod
    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        """Explicit URL argument keeps providers safe for concurrent use."""

    @abstractmethod
    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        """Prepare a provider-owned resource or fail closed."""
