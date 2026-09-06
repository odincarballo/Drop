from uuid import NAMESPACE_URL, uuid5

from pydantic import HttpUrl

from app.core.errors import DownloadUnavailableError
from app.models.media import (
    AudioFormat,
    AvailableStreams,
    DownloadRequest,
    MediaAnalysis,
    PreparedDownload,
    VideoFormat,
)
from app.providers.base import MediaProvider
from app.providers.mock_data import MOCK_THUMBNAIL


class MockMediaProvider(MediaProvider):
    """Deterministic synthetic data. Never resolves DNS or contacts the input URL."""

    def supports(self, url: HttpUrl) -> bool:
        return url.scheme in {"http", "https"}

    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        return AvailableStreams(
            video_formats=[
                VideoFormat(
                    id="mock-video-360p",
                    resolution="640x360",
                    container="mp4",
                    codec="h264",
                    has_audio=False,
                    estimated_size=6_000_000,
                ),
                VideoFormat(
                    id="mock-video-720p",
                    resolution="1280x720",
                    container="mp4",
                    codec="h264",
                    has_audio=False,
                    estimated_size=20_000_000,
                ),
                VideoFormat(
                    id="mock-video-1080p",
                    resolution="1920x1080",
                    container="mp4",
                    codec="h264",
                    has_audio=True,
                    estimated_size=60_000_000,
                ),
            ],
            audio_formats=[
                AudioFormat(
                    id="mock-audio-128k",
                    container="m4a",
                    codec="aac",
                    bitrate=128_000,
                    estimated_size=2_464_000,
                ),
                AudioFormat(
                    id="mock-audio-256k",
                    container="m4a",
                    codec="aac",
                    bitrate=256_000,
                    estimated_size=4_928_000,
                ),
            ],
        )

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        streams = await self.get_available_streams(url)
        return MediaAnalysis(
            id=f"mock-{uuid5(NAMESPACE_URL, str(url))}",
            title="MediaDrop Demo Video",
            duration=154,
            source="mock",
            thumbnail=MOCK_THUMBNAIL,
            estimated_size=60_000_000,
            **streams.model_dump(),
        )

    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        raise DownloadUnavailableError
