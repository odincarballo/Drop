from collections.abc import Mapping
from typing import cast

import pytest
from pydantic import HttpUrl
from yt_dlp.utils import DownloadError  # type: ignore[import-untyped]

import app.services.youtube.extractor as extractor_module
from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import AudioOutputFormat, DownloadRequest, DownloadType, ProcessingMode
from app.providers.youtube import YouTubeProvider
from app.services.catalog import InMemoryMediaCatalog
from app.services.url_safety import URLSafetyPolicy
from app.services.youtube import YtDlpYouTubeExtractor, canonical_youtube_url, is_youtube_url

VIDEO_ID = "dQw4w9WgXcQ"


async def public_resolver(host: str, port: int) -> tuple[str, ...]:
    return ("142.250.72.206",)


def format_payload(
    format_id: str,
    *,
    height: int | None = None,
    ext: str = "mp4",
    vcodec: str = "avc1.64001F",
    acodec: str = "none",
    size: int = 1_000_000,
    abr: int | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "format_id": format_id,
        "url": f"https://rr1.googlevideo.com/videoplayback?id={format_id}",
        "protocol": "https",
        "ext": ext,
        "vcodec": vcodec,
        "acodec": acodec,
        "filesize": size,
        "http_headers": {
            "User-Agent": "MediaDrop test",
            "Cookie": "must-not-be-copied",
        },
    }
    if height is not None:
        payload.update(width=round(height * 16 / 9), height=height, fps=30, tbr=900)
    if abr is not None:
        payload["abr"] = abr
    return payload


def video_payload() -> dict[str, object]:
    return {
        "id": VIDEO_ID,
        "title": "Demo / Video",
        "thumbnail": "https://i.ytimg.com/vi/demo/maxresdefault.jpg",
        "duration": 154,
        "formats": [
            format_payload("18", height=360, acodec="mp4a.40.2", size=8_000_000),
            format_payload("22", height=720, acodec="mp4a.40.2", size=20_000_000),
            format_payload("137", height=1080, size=35_000_000),
            format_payload("399", height=1080, vcodec="av01.0.08M.08", size=30_000_000),
            format_payload(
                "140", ext="m4a", vcodec="none", acodec="mp4a.40.2", size=3_000_000, abr=128
            ),
            format_payload(
                "251", ext="webm", vcodec="none", acodec="opus", size=4_000_000, abr=160
            ),
        ],
    }


class StaticYtDlpExtractor(YtDlpYouTubeExtractor):
    def __init__(
        self, settings: Settings, policy: URLSafetyPolicy, payload: Mapping[str, object]
    ) -> None:
        super().__init__(settings, policy)
        self.payload = payload

    def _extract_sync(self, url: HttpUrl) -> Mapping[str, object]:
        return self.payload


class FailingYtDlpExtractor(YtDlpYouTubeExtractor):
    def _extract_sync(self, url: HttpUrl) -> Mapping[str, object]:
        raise DownloadError("Video unavailable")


def provider(settings: Settings, payload: Mapping[str, object] | None = None) -> YouTubeProvider:
    policy = URLSafetyPolicy(settings, public_resolver)
    extractor = StaticYtDlpExtractor(settings, policy, payload or video_payload())
    return YouTubeProvider(extractor, InMemoryMediaCatalog(60), policy, settings)


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}",
        f"https://youtube.com/shorts/{VIDEO_ID}",
    ],
)
def test_youtube_individual_url_forms(url: str) -> None:
    parsed = HttpUrl(url)
    assert is_youtube_url(parsed)
    assert str(canonical_youtube_url(parsed)) == f"https://www.youtube.com/watch?v={VIDEO_ID}"


def test_watch_url_with_playlist_processes_only_unambiguous_video() -> None:
    url = HttpUrl(f"https://youtube.com/watch?v={VIDEO_ID}&list=PL123")
    assert str(canonical_youtube_url(url)) == f"https://www.youtube.com/watch?v={VIDEO_ID}"


@pytest.mark.parametrize(
    "url",
    [
        "https://youtube.com/playlist?list=PL123",
        "https://youtube.com/watch?list=PL123",
    ],
)
def test_playlist_without_individual_video_is_rejected(url: str) -> None:
    with pytest.raises(ApplicationError) as raised:
        canonical_youtube_url(HttpUrl(url))
    assert raised.value.code == "PLAYLIST_NOT_SUPPORTED"


async def test_youtube_analysis_groups_real_formats_by_resolution(settings: Settings) -> None:
    analysis = await provider(settings).analyze(HttpUrl(f"https://youtube.com/watch?v={VIDEO_ID}"))
    assert analysis.source == "youtube"
    assert analysis.provider == "youtube"
    assert analysis.estimated_size is None
    assert analysis.title == "Demo / Video"
    assert analysis.duration == 154
    assert [item.height for item in analysis.video_formats] == [360, 720, 1080]
    assert [item.id for item in analysis.video_formats] == ["18", "22", "137"]
    assert [item.container for item in analysis.audio_formats] == ["m4a", "webm"]
    assert analysis.video_formats[0].format_id == analysis.video_formats[0].id


async def test_approximate_size_is_not_treated_as_exact_content_length(
    settings: Settings,
) -> None:
    payload = video_payload()
    formats = cast(list[dict[str, object]], payload["formats"])
    size = formats[2].pop("filesize")
    formats[2]["filesize_approx"] = size
    youtube = provider(settings, payload)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    selected = analysis.video_formats[2]
    assert selected.estimated_size == 35_000_000
    plan = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.VIDEO_ONLY,
            format_id="137",
        )
    )
    assert plan.sources[0].expected_size is None
    assert plan.sources[0].estimated_size == 35_000_000


async def test_youtube_progressive_video_audio_plan(settings: Settings) -> None:
    youtube = provider(settings)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    plan = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.VIDEO_AUDIO,
            format_id="22",
        )
    )
    assert plan.processing == ProcessingMode.DIRECT
    assert len(plan.sources) == 1
    assert plan.sources[0].role == "media"
    assert plan.filename == "Demo _ Video.mp4"
    assert "cookie" not in {name.lower() for name in plan.sources[0].headers}


async def test_youtube_separate_video_audio_plan(settings: Settings) -> None:
    youtube = provider(settings)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    plan = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.VIDEO_AUDIO,
            format_id="137",
        )
    )
    assert plan.processing == ProcessingMode.MUX
    assert [source.role for source in plan.sources] == ["video", "audio"]
    assert plan.sources[1].internal_name == "input-audio.m4a"


async def test_youtube_video_only_strips_audio_only_when_needed(settings: Settings) -> None:
    youtube = provider(settings)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    progressive = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.VIDEO_ONLY,
            format_id="22",
        )
    )
    video_only = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.VIDEO_ONLY,
            format_id="137",
        )
    )
    assert progressive.processing == ProcessingMode.STRIP_AUDIO
    assert video_only.processing == ProcessingMode.DIRECT


async def test_youtube_audio_m4a_and_mp3_plans(settings: Settings) -> None:
    youtube = provider(settings)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    m4a = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.AUDIO_ONLY,
            format_id="140",
            audio_output_format=AudioOutputFormat.M4A,
        )
    )
    mp3 = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.AUDIO_ONLY,
            format_id="251",
            audio_output_format=AudioOutputFormat.MP3,
            audio_bitrate=256000,
        )
    )
    assert m4a.processing == ProcessingMode.DIRECT
    assert m4a.content_type == "audio/mp4"
    assert mp3.processing == ProcessingMode.AUDIO_MP3
    assert mp3.audio_bitrate == 256000
    assert mp3.filename.endswith(".mp3")

    converted_m4a = await youtube.prepare_download(
        DownloadRequest(
            media_id=analysis.id,
            download_type=DownloadType.AUDIO_ONLY,
            format_id="251",
            audio_output_format=AudioOutputFormat.M4A,
        )
    )
    assert converted_m4a.processing == ProcessingMode.AUDIO_M4A
    assert converted_m4a.filename.endswith(".m4a")


async def test_youtube_mp3_requires_output_bitrate(settings: Settings) -> None:
    youtube = provider(settings)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    with pytest.raises(ApplicationError) as raised:
        await youtube.prepare_download(
            DownloadRequest(
                media_id=analysis.id,
                download_type=DownloadType.AUDIO_ONLY,
                format_id="140",
                audio_output_format=AudioOutputFormat.MP3,
            )
        )
    assert raised.value.code == "INVALID_FORMAT"


async def test_youtube_known_input_size_limit(settings: Settings) -> None:
    limited = settings.model_copy(update={"max_input_bytes": 1_000_000})
    youtube = provider(limited)
    analysis = await youtube.analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    with pytest.raises(ApplicationError) as raised:
        await youtube.prepare_download(
            DownloadRequest(
                media_id=analysis.id,
                download_type=DownloadType.VIDEO_AUDIO,
                format_id="137",
            )
        )
    assert raised.value.code == "FILE_TOO_LARGE"


@pytest.mark.parametrize(
    ("payload_update", "code"),
    [
        ({"is_live": True}, "LIVE_NOT_SUPPORTED"),
        ({"availability": "private"}, "PRIVATE_CONTENT"),
        ({"availability": "needs_auth"}, "LOGIN_REQUIRED"),
    ],
)
async def test_youtube_restricted_content_is_rejected(
    settings: Settings, payload_update: dict[str, object], code: str
) -> None:
    payload = video_payload() | payload_update
    with pytest.raises(ApplicationError) as raised:
        await provider(settings, payload).analyze(
            HttpUrl(f"https://youtube.com/watch?v={VIDEO_ID}")
        )
    assert raised.value.code == code


async def test_ytdlp_failure_is_sanitized(settings: Settings) -> None:
    policy = URLSafetyPolicy(settings, public_resolver)
    extractor = FailingYtDlpExtractor(settings, policy)
    with pytest.raises(ApplicationError) as raised:
        await extractor.extract(HttpUrl(f"https://youtube.com/watch?v={VIDEO_ID}"))
    assert raised.value.code == "VIDEO_UNAVAILABLE"
    assert "unavailable" not in raised.value.message.lower()


async def test_all_drm_formats_are_rejected(settings: Settings) -> None:
    payload = video_payload()
    formats = cast(list[dict[str, object]], payload["formats"])
    for item in formats:
        item["has_drm"] = True
    with pytest.raises(ApplicationError) as raised:
        await provider(settings, payload).analyze(HttpUrl(f"https://youtu.be/{VIDEO_ID}"))
    assert raised.value.code == "DRM_NOT_SUPPORTED"


def test_other_youtube_lookalike_hosts_are_rejected() -> None:
    assert not is_youtube_url(HttpUrl(f"https://youtube.example/watch?v={VIDEO_ID}"))
    assert not is_youtube_url(HttpUrl(f"https://www.youtube.com.evil.test/watch?v={VIDEO_ID}"))


def test_ytdlp_is_restricted_to_youtube_without_config_or_cookies(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    class FakeYoutubeDL:
        def __enter__(self) -> "FakeYoutubeDL":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, *, download: bool) -> Mapping[str, object]:
            assert url == f"https://www.youtube.com/watch?v={VIDEO_ID}"
            assert download is False
            return video_payload()

    def fake_youtube_dl(options: dict[str, object]) -> FakeYoutubeDL:
        captured.update(options)
        return FakeYoutubeDL()

    monkeypatch.setattr(extractor_module, "YoutubeDL", fake_youtube_dl)
    policy = URLSafetyPolicy(settings, public_resolver)
    result = YtDlpYouTubeExtractor(settings, policy)._extract_sync(
        HttpUrl(f"https://www.youtube.com/watch?v={VIDEO_ID}")
    )
    assert result["id"] == VIDEO_ID
    assert captured["ignoreconfig"] is True
    assert captured["noplaylist"] is True
    assert captured["allowed_extractors"] == ["youtube"]
    assert captured["js_runtimes"] == {"node": {}}
    assert "cookiefile" not in captured
    assert "cookiesfrombrowser" not in captured
