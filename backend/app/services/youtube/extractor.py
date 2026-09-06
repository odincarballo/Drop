import asyncio
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast
from urllib.parse import parse_qs, urlsplit

from pydantic import HttpUrl, ValidationError
from yt_dlp import YoutubeDL  # type: ignore[import-untyped]
from yt_dlp.utils import DownloadError  # type: ignore[import-untyped]

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.services.url_safety import URLSafetyPolicy

logger = logging.getLogger(__name__)

YOUTUBE_HOSTS = frozenset(
    {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
)
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
SAFE_HEADERS = frozenset({"user-agent", "referer", "origin", "accept-language"})


@dataclass(frozen=True)
class ExtractedFormat:
    format_id: str
    url: HttpUrl
    protocol: str
    container: str
    video_codec: str | None
    audio_codec: str | None
    width: int | None
    height: int | None
    fps: float | None
    bitrate: int | None
    audio_bitrate: int | None
    content_length: int | None
    estimated_size: int | None
    has_drm: bool
    headers: tuple[tuple[str, str], ...]

    @property
    def has_video(self) -> bool:
        return self.video_codec not in {None, "none"}

    @property
    def has_audio(self) -> bool:
        return self.audio_codec not in {None, "none"}


@dataclass(frozen=True)
class ExtractedVideo:
    video_id: str
    title: str
    thumbnail: HttpUrl | None
    duration: float | None
    formats: tuple[ExtractedFormat, ...]


class YouTubeExtractor(Protocol):
    async def extract(self, url: HttpUrl) -> ExtractedVideo: ...


class SanitizedYtDlpLogger:
    """yt-dlp messages can contain signed stream URLs; never forward their text."""

    def debug(self, message: str) -> None:
        return None

    def info(self, message: str) -> None:
        return None

    def warning(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


class YtDlpYouTubeExtractor:
    def __init__(self, settings: Settings, policy: URLSafetyPolicy) -> None:
        self.settings = settings
        self.policy = policy

    async def extract(self, url: HttpUrl) -> ExtractedVideo:
        canonical = canonical_youtube_url(url)
        await self.policy.validate_public_destination(canonical)
        try:
            raw = await asyncio.to_thread(self._extract_sync, canonical)
        except DownloadError as exc:
            code = _classify_extraction_error(str(exc))
            logger.warning("yt-dlp extraction failed error_code=%s", code)
            raise ApplicationError(code, _error_message(code)) from exc
        except (OSError, TimeoutError) as exc:
            logger.warning("yt-dlp transport failed exception_type=%s", type(exc).__name__)
            raise ApplicationError(
                "REMOTE_UNAVAILABLE", "YouTube no respondió. Inténtalo de nuevo.", 502
            ) from exc
        return _parse_video(raw)

    def _extract_sync(self, url: HttpUrl) -> Mapping[str, object]:
        options: dict[str, object] = {
            "quiet": True,
            "no_warnings": True,
            "ignoreconfig": True,
            "cachedir": False,
            "noplaylist": True,
            "skip_download": True,
            "socket_timeout": self.settings.youtube_socket_timeout_seconds,
            "retries": self.settings.youtube_retries,
            "fragment_retries": self.settings.youtube_retries,
            "allowed_extractors": ["youtube"],
            "js_runtimes": {"node": {}},
            "logger": SanitizedYtDlpLogger(),
        }
        with YoutubeDL(options) as downloader:
            result = downloader.extract_info(str(url), download=False)
            if not isinstance(result, Mapping):
                raise DownloadError("Extractor returned no metadata")
            return cast(Mapping[str, object], result)


def is_youtube_url(url: HttpUrl) -> bool:
    host = (url.host or "").rstrip(".").lower()
    return host in YOUTUBE_HOSTS


def canonical_youtube_url(url: HttpUrl) -> HttpUrl:
    if not is_youtube_url(url):
        raise ApplicationError("UNSUPPORTED_URL", "Esta fuente no es compatible.")
    parsed = urlsplit(str(url))
    host = (parsed.hostname or "").lower()
    query = parse_qs(parsed.query, keep_blank_values=True)
    video_id: str | None = None
    if host == "youtu.be":
        parts = [part for part in parsed.path.split("/") if part]
        video_id = parts[0] if len(parts) == 1 else None
    else:
        path = parsed.path.rstrip("/") or "/"
        if path == "/watch":
            values = query.get("v", [])
            video_id = values[0] if len(values) == 1 else None
        elif path.startswith("/shorts/"):
            parts = [part for part in path.split("/") if part]
            video_id = parts[1] if len(parts) == 2 else None
        elif path == "/playlist":
            raise ApplicationError(
                "PLAYLIST_NOT_SUPPORTED", "Las playlists todavía no son compatibles."
            )
    if video_id is None:
        if "list" in query:
            raise ApplicationError(
                "PLAYLIST_NOT_SUPPORTED", "Las playlists todavía no son compatibles."
            )
        raise ApplicationError("UNSUPPORTED_URL", "El enlace de YouTube no es válido.")
    if not VIDEO_ID.fullmatch(video_id):
        raise ApplicationError("UNSUPPORTED_URL", "El enlace de YouTube no es válido.")
    try:
        return HttpUrl(f"https://www.youtube.com/watch?v={video_id}")
    except ValidationError as exc:  # pragma: no cover - constant origin
        raise ApplicationError("UNSUPPORTED_URL", "El enlace de YouTube no es válido.") from exc


def _parse_video(payload: Mapping[str, object]) -> ExtractedVideo:
    if payload.get("_type") in {"playlist", "multi_video"}:
        raise ApplicationError(
            "PLAYLIST_NOT_SUPPORTED", "Las playlists todavía no son compatibles."
        )
    if payload.get("is_live") is True or payload.get("live_status") in {
        "is_live",
        "is_upcoming",
        "post_live",
    }:
        raise ApplicationError(
            "LIVE_NOT_SUPPORTED", "Las transmisiones en vivo todavía no son compatibles."
        )
    availability = _string(payload.get("availability"))
    if availability == "private":
        raise ApplicationError("PRIVATE_CONTENT", "Este video es privado.")
    if availability in {"premium_only", "subscriber_only", "needs_auth"}:
        raise ApplicationError(
            "LOGIN_REQUIRED", "Este contenido requiere iniciar sesión y no puede procesarse."
        )
    video_id = _string(payload.get("id"))
    if video_id is None or not VIDEO_ID.fullmatch(video_id):
        raise ApplicationError(
            "YOUTUBE_EXTRACTION_FAILED", "No se pudo interpretar el video de YouTube."
        )
    raw_formats = payload.get("formats")
    if not isinstance(raw_formats, list):
        raise ApplicationError(
            "YOUTUBE_EXTRACTION_FAILED", "No se encontraron formatos para este video."
        )
    formats = tuple(
        parsed
        for item in raw_formats
        if isinstance(item, Mapping)
        if (parsed := _parse_format(cast(Mapping[str, object], item))) is not None
    )
    if formats and all(item.has_drm for item in formats):
        raise ApplicationError("DRM_NOT_SUPPORTED", "Este contenido no puede procesarse.")
    title = (_string(payload.get("title")) or "Video de YouTube").strip()[:200]
    thumbnail = _http_url(payload.get("thumbnail"), require_https=True)
    return ExtractedVideo(
        video_id=video_id,
        title=title or "Video de YouTube",
        thumbnail=thumbnail,
        duration=_positive_float(payload.get("duration")),
        formats=tuple(item for item in formats if not item.has_drm),
    )


def _parse_format(payload: Mapping[str, object]) -> ExtractedFormat | None:
    format_id = _string(payload.get("format_id"))
    url = _http_url(payload.get("url"), require_https=True)
    protocol = (_string(payload.get("protocol")) or "").lower()
    container = (_string(payload.get("ext")) or "").lower()
    if (
        not format_id
        or url is None
        or protocol != "https"
        or container not in {"mp4", "m4a", "webm"}
    ):
        return None
    headers: list[tuple[str, str]] = []
    raw_headers = payload.get("http_headers")
    if isinstance(raw_headers, Mapping):
        for raw_name, raw_value in raw_headers.items():
            name = str(raw_name).lower()
            if (
                name in SAFE_HEADERS
                and isinstance(raw_value, str)
                and "\r" not in raw_value
                and "\n" not in raw_value
            ):
                headers.append((name.title(), raw_value[:1024]))
    content_length = _positive_int(payload.get("filesize"))
    return ExtractedFormat(
        format_id=format_id,
        url=url,
        protocol=protocol,
        container=container,
        video_codec=_codec(payload.get("vcodec")),
        audio_codec=_codec(payload.get("acodec")),
        width=_positive_int(payload.get("width")),
        height=_positive_int(payload.get("height")),
        fps=_positive_float(payload.get("fps")),
        bitrate=_kilobits(payload.get("tbr")),
        audio_bitrate=_kilobits(payload.get("abr")),
        content_length=content_length,
        estimated_size=content_length or _positive_int(payload.get("filesize_approx")),
        has_drm=payload.get("has_drm") is True,
        headers=tuple(headers),
    )


def _classify_extraction_error(message: str) -> str:
    normalized = message.casefold()
    if "drm" in normalized:
        return "DRM_NOT_SUPPORTED"
    if "private" in normalized:
        return "PRIVATE_CONTENT"
    if "sign in" in normalized or "login" in normalized or "members-only" in normalized:
        return "LOGIN_REQUIRED"
    if "live" in normalized:
        return "LIVE_NOT_SUPPORTED"
    if "unavailable" in normalized or "removed" in normalized:
        return "VIDEO_UNAVAILABLE"
    return "YOUTUBE_EXTRACTION_FAILED"


def _error_message(code: str) -> str:
    return {
        "DRM_NOT_SUPPORTED": "Este contenido no puede procesarse.",
        "PRIVATE_CONTENT": "Este video es privado.",
        "LOGIN_REQUIRED": "Este contenido requiere iniciar sesión y no puede procesarse.",
        "LIVE_NOT_SUPPORTED": "Las transmisiones en vivo todavía no son compatibles.",
        "VIDEO_UNAVAILABLE": "Este video no está disponible.",
        "YOUTUBE_EXTRACTION_FAILED": "No se pudo analizar el video de YouTube.",
    }[code]


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _codec(value: object) -> str | None:
    codec = _string(value)
    return codec if codec not in {None, "none"} else None


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value) if isinstance(value, (str, int, float)) else None
    except (TypeError, ValueError):
        return None
    return parsed if parsed is not None and parsed > 0 else None


def _positive_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value) if isinstance(value, (str, int, float)) else None
    except (TypeError, ValueError):
        return None
    return parsed if parsed is not None and parsed > 0 else None


def _kilobits(value: object) -> int | None:
    parsed = _positive_float(value)
    return round(parsed * 1000) if parsed is not None else None


def _http_url(value: object, *, require_https: bool) -> HttpUrl | None:
    if not isinstance(value, str):
        return None
    try:
        url = HttpUrl(value)
    except ValidationError:
        return None
    if require_https and url.scheme != "https":
        return None
    return url
