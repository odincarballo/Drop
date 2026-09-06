import time
from dataclasses import dataclass
from threading import RLock

from pydantic import HttpUrl

from app.core.errors import ApplicationError
from app.models.media import DownloadType


@dataclass(frozen=True)
class DirectMediaResource:
    id: str
    url: HttpUrl
    format_id: str
    download_type: DownloadType
    content_type: str
    file_name: str
    content_length: int | None
    created_at: float


@dataclass(frozen=True)
class YouTubeStreamResource:
    format_id: str
    url: HttpUrl
    role: str
    content_type: str
    container: str
    codec: str | None
    width: int | None
    height: int | None
    fps: float | None
    bitrate: int | None
    has_audio: bool
    content_length: int | None
    estimated_size: int | None
    headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class YouTubeMediaResource:
    id: str
    video_id: str
    title: str
    duration: float | None
    video_streams: tuple[YouTubeStreamResource, ...]
    audio_streams: tuple[YouTubeStreamResource, ...]
    created_at: float


type MediaResource = DirectMediaResource | YouTubeMediaResource


class InMemoryMediaCatalog:
    """Short-lived download capabilities created by successful analyses."""

    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._items: dict[str, MediaResource] = {}
        self._lock = RLock()

    def put(self, resource: MediaResource) -> None:
        with self._lock:
            self._items[resource.id] = resource

    def get(self, media_id: str) -> MediaResource:
        with self._lock:
            resource = self._items.get(media_id)
            if resource is None or time.time() - resource.created_at >= self.ttl_seconds:
                self._items.pop(media_id, None)
                raise ApplicationError(
                    "MEDIA_EXPIRED",
                    "El análisis ya no está disponible. Analiza de nuevo el enlace.",
                    404,
                )
            return resource

    def cleanup_expired(self) -> int:
        cutoff = time.time() - self.ttl_seconds
        with self._lock:
            expired = [key for key, value in self._items.items() if value.created_at < cutoff]
            for key in expired:
                self._items.pop(key, None)
            return len(expired)
