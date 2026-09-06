import base64

import pytest
from pydantic import HttpUrl, ValidationError

from app.core.config import Settings
from app.core.errors import ApplicationError, DownloadUnavailableError
from app.models.media import DownloadRequest, DownloadType, MediaAnalysis
from app.providers.direct import DirectMediaProvider
from app.providers.mock import MockMediaProvider
from app.services.catalog import InMemoryMediaCatalog
from app.services.http import SafeHTTPClient
from app.services.url_safety import URLSafetyPolicy
from tests.fakes import MemoryResponse, QueueTransport


def direct_provider(settings: Settings, responses: list[MemoryResponse]) -> DirectMediaProvider:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    client = SafeHTTPClient(
        URLSafetyPolicy(settings, resolver),
        QueueTransport(responses),
        settings,
    )
    return DirectMediaProvider(client, InMemoryMediaCatalog(60))


async def test_mock_provider_is_deterministic() -> None:
    provider = MockMediaProvider()
    url = HttpUrl("https://example.com/video.mp4")
    assert provider.supports(url)
    first = await provider.analyze(url)
    assert first == await provider.analyze(url)
    assert first.id != (await provider.analyze(HttpUrl("https://example.com/other"))).id
    assert isinstance(first.thumbnail, str)
    image = base64.b64decode(first.thumbnail.split(",", 1)[1], validate=True)
    assert image.startswith(b"\x89PNG\r\n\x1a\n")
    streams = await provider.get_available_streams(url)
    assert [stream.resolution for stream in streams.video_formats] == [
        "640x360",
        "1280x720",
        "1920x1080",
    ]
    assert [stream.bitrate for stream in streams.audio_formats] == [128_000, 256_000]


async def test_direct_provider_reports_verified_http_metadata(settings: Settings) -> None:
    provider = direct_provider(
        settings,
        [MemoryResponse(200, {"Content-Type": "video/mp4", "Content-Length": "1234"})],
    )
    url = HttpUrl("https://example.com/My%20Video.MP4?token=do-not-expose")
    assert provider.supports(url)
    analysis = await provider.analyze(url)
    assert analysis.title == "My Video.mp4"
    assert analysis.source == "direct"
    assert analysis.duration is None
    assert analysis.estimated_size == 1234
    assert len(analysis.video_formats) == 1
    assert analysis.video_formats[0].container == "mp4"
    assert analysis.audio_formats == []
    assert "do-not-expose" not in analysis.model_dump_json()


async def test_direct_provider_rejects_page_url(settings: Settings) -> None:
    provider = direct_provider(
        settings,
        [MemoryResponse(200, {"Content-Type": "text/html", "Content-Length": "42"})],
    )
    url = HttpUrl("https://example.com/page")
    assert provider.supports(url)
    with pytest.raises(ApplicationError, match="multimedia compatible"):
        await provider.analyze(url)


@pytest.mark.parametrize("kind", list(DownloadType))
async def test_mock_download_capability_is_closed(kind: DownloadType) -> None:
    request = DownloadRequest(media_id="demo", download_type=kind, format_id="demo")
    with pytest.raises(DownloadUnavailableError):
        await MockMediaProvider().prepare_download(request)


def test_nullable_metadata() -> None:
    analysis = MediaAnalysis(id="unknown", source=None)
    assert analysis.thumbnail is None
    assert analysis.duration is None
    assert analysis.video_formats == []


@pytest.mark.parametrize("thumbnail", ["data:text/html;base64,YQ==", "file:///tmp/image.png"])
def test_thumbnail_rejects_other_schemes(thumbnail: str) -> None:
    with pytest.raises(ValidationError):
        MediaAnalysis(id="unknown", source="mock", thumbnail=thumbnail)
