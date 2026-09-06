import os

import pytest
from pydantic import HttpUrl

from app.core.config import Settings
from app.providers.youtube import YouTubeProvider
from app.services.catalog import InMemoryMediaCatalog
from app.services.url_safety import URLSafetyPolicy
from app.services.youtube import YtDlpYouTubeExtractor

TEST_URL = os.getenv("MEDIADROP_YOUTUBE_TEST_URL")


@pytest.mark.skipif(
    not TEST_URL,
    reason="Set MEDIADROP_YOUTUBE_TEST_URL to an authorized public individual video",
)
async def test_real_authorized_youtube_analysis(settings: Settings) -> None:
    assert TEST_URL is not None
    policy = URLSafetyPolicy(settings)
    provider = YouTubeProvider(
        YtDlpYouTubeExtractor(settings, policy),
        InMemoryMediaCatalog(60),
        policy,
        settings,
    )
    analysis = await provider.analyze(HttpUrl(TEST_URL))
    assert analysis.provider == "youtube"
    assert analysis.source == "youtube"
    assert analysis.title
    assert analysis.duration is None or analysis.duration > 0
    assert analysis.video_formats or analysis.audio_formats
