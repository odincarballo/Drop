import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from app.api.routes import get_analysis_service
from app.core.config import Settings
from app.main import create_app
from app.models.media import MediaAnalysis, VideoFormat
from app.providers.mock import MockMediaProvider
from app.services.analysis import AnalysisService
from app.services.url_safety import URLSafetyPolicy
from tests.conftest import AUTH_HEADERS


class SlowProvider(MockMediaProvider):
    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        await asyncio.sleep(1)
        return await super().analyze(url)


class FailingProvider(MockMediaProvider):
    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        raise RuntimeError("signed URL must not leak")


class MultiFormatProvider(MockMediaProvider):
    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        return MediaAnalysis(
            id="youtube-test",
            provider="youtube",
            source="youtube",
            estimated_size=None,
            video_formats=[
                VideoFormat(
                    id="large-option",
                    resolution="2160p",
                    estimated_size=200_000_000,
                ),
                VideoFormat(
                    id="allowed-option",
                    resolution="720p",
                    estimated_size=20_000_000,
                ),
            ],
        )


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("max_file_size", 100, "MEDIA_TOO_LARGE"),
        ("max_media_duration_seconds", 5, "MEDIA_TOO_LONG"),
    ],
)
def test_configurable_limits(settings: Settings, field: str, value: int, code: str) -> None:
    setattr(settings, field, value)
    with TestClient(create_app(settings), headers=AUTH_HEADERS) as client:
        response = client.post("/analyze", json={"url": "https://example.com/video.mp4"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == code


def test_analysis_timeout(settings: Settings) -> None:
    settings.analysis_timeout_seconds = 0.001
    app = create_app(settings)
    service = AnalysisService(SlowProvider(), URLSafetyPolicy(settings), settings)
    app.dependency_overrides[get_analysis_service] = lambda: service
    with TestClient(app, headers=AUTH_HEADERS) as client:
        response = client.post("/analyze", json={"url": "https://example.com/video.mp4"})
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "ANALYSIS_TIMEOUT"


def test_internal_errors_are_sanitized(settings: Settings) -> None:
    app = create_app(settings)
    service = AnalysisService(FailingProvider(), URLSafetyPolicy(settings), settings)
    app.dependency_overrides[get_analysis_service] = lambda: service
    with TestClient(app, headers=AUTH_HEADERS, raise_server_exceptions=False) as client:
        response = client.post("/analyze", json={"url": "https://example.com/video.mp4"})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "signed URL" not in response.text


async def test_multiformat_analysis_defers_size_limit_until_selection(
    settings: Settings,
) -> None:
    service = AnalysisService(MultiFormatProvider(), URLSafetyPolicy(settings), settings)
    analysis = await service.analyze(HttpUrl("https://youtube.com/watch?v=dQw4w9WgXcQ"))
    assert [item.id for item in analysis.video_formats] == [
        "large-option",
        "allowed-option",
    ]
