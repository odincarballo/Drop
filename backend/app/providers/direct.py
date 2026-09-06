import time
from secrets import token_urlsafe

from pydantic import HttpUrl

from app.core.errors import ApplicationError
from app.models.media import (
    AudioFormat,
    AvailableStreams,
    DownloadRequest,
    DownloadType,
    MediaAnalysis,
    PreparedDownload,
    VideoFormat,
)
from app.providers.base import MediaProvider
from app.services.catalog import DirectMediaResource, InMemoryMediaCatalog
from app.services.http import RemoteMetadata, SafeHTTPClient


class DirectMediaProvider(MediaProvider):
    """Analyze explicitly allowed direct media without downloading the full body."""

    def __init__(self, http_client: SafeHTTPClient, catalog: InMemoryMediaCatalog) -> None:
        self.http_client = http_client
        self.catalog = catalog

    def supports(self, url: HttpUrl) -> bool:
        return url.scheme in {"http", "https"}

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        metadata = await self.http_client.probe(url)
        media_id = f"direct-{token_urlsafe(24)}"
        format_id = f"format-{token_urlsafe(18)}"
        streams, download_type = self._streams(metadata, format_id)
        self.catalog.put(
            DirectMediaResource(
                id=media_id,
                url=url,
                format_id=format_id,
                download_type=download_type,
                content_type=metadata.content_type,
                file_name=metadata.file_name,
                content_length=metadata.content_length,
                created_at=time.time(),
            )
        )
        return MediaAnalysis(
            id=media_id,
            title=metadata.file_name,
            source="direct",
            estimated_size=metadata.content_length,
            **streams.model_dump(),
        )

    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        metadata = await self.http_client.probe(url)
        streams, _ = self._streams(metadata, f"format-{token_urlsafe(18)}")
        return streams

    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        resource = self.catalog.get(request.media_id)
        if (
            request.format_id != resource.format_id
            or request.download_type != resource.download_type
        ):
            raise ApplicationError(
                "INVALID_FORMAT", "El formato seleccionado ya no está disponible."
            )
        return PreparedDownload(
            source_url=resource.url,
            content_type=resource.content_type,
            filename=resource.file_name,
            expected_size=resource.content_length,
        )

    @staticmethod
    def _streams(metadata: RemoteMetadata, format_id: str) -> tuple[AvailableStreams, DownloadType]:
        if metadata.content_type == "video/mp4":
            return (
                AvailableStreams(
                    video_formats=[
                        VideoFormat(
                            id=format_id,
                            resolution="Original",
                            container="mp4",
                            codec=None,
                            # The original file is delivered intact; no separate audio is claimed.
                            has_audio=None,
                            estimated_size=metadata.content_length,
                        )
                    ]
                ),
                DownloadType.VIDEO_AUDIO,
            )
        container = {
            "audio/mpeg": "mp3",
            "audio/mp4": "m4a",
            "audio/aac": "aac",
        }[metadata.content_type]
        codec = "mp3" if metadata.content_type == "audio/mpeg" else "aac"
        return (
            AvailableStreams(
                audio_formats=[
                    AudioFormat(
                        id=format_id,
                        container=container,
                        codec=codec,
                        bitrate=None,
                        estimated_size=metadata.content_length,
                    )
                ]
            ),
            DownloadType.AUDIO_ONLY,
        )
