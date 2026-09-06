import re
import time
from collections.abc import Iterable
from secrets import token_urlsafe

from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import (
    AudioFormat,
    AudioOutputFormat,
    AvailableStreams,
    DownloadRequest,
    DownloadSource,
    DownloadType,
    MediaAnalysis,
    PreparedDownload,
    ProcessingMode,
    VideoFormat,
)
from app.providers.base import MediaProvider
from app.services.catalog import (
    InMemoryMediaCatalog,
    YouTubeMediaResource,
    YouTubeStreamResource,
)
from app.services.url_safety import URLSafetyPolicy
from app.services.youtube import ExtractedFormat, YouTubeExtractor, is_youtube_url


class YouTubeProvider(MediaProvider):
    """Public individual YouTube videos; no cookies, login, playlists or DRM."""

    def __init__(
        self,
        extractor: YouTubeExtractor,
        catalog: InMemoryMediaCatalog,
        policy: URLSafetyPolicy,
        settings: Settings,
    ) -> None:
        self.extractor = extractor
        self.catalog = catalog
        self.policy = policy
        self.settings = settings

    def supports(self, url: HttpUrl) -> bool:
        return is_youtube_url(url)

    def owns(self, media_id: str) -> bool:
        return media_id.startswith("youtube-")

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        extracted = await self.extractor.extract(url)
        video_streams = await self._video_streams(extracted.formats)
        audio_streams = await self._audio_streams(extracted.formats)
        if not video_streams and not audio_streams:
            raise ApplicationError(
                "FORMAT_NOT_AVAILABLE", "No hay formatos compatibles para este video."
            )
        media_id = f"youtube-{token_urlsafe(24)}"
        resource = YouTubeMediaResource(
            id=media_id,
            video_id=extracted.video_id,
            title=extracted.title,
            duration=extracted.duration,
            video_streams=tuple(video_streams),
            audio_streams=tuple(audio_streams),
            created_at=time.time(),
        )
        self.catalog.put(resource)
        video_formats = [self._video_model(stream) for stream in video_streams]
        audio_formats = [self._audio_model(stream) for stream in audio_streams]
        return MediaAnalysis(
            id=media_id,
            provider="youtube",
            title=extracted.title,
            thumbnail=extracted.thumbnail,
            duration=extracted.duration,
            source="youtube",
            # The final size depends on the selected resolution and output mode.
            estimated_size=None,
            video_formats=video_formats,
            audio_formats=audio_formats,
        )

    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        analysis = await self.analyze(url)
        return AvailableStreams(
            video_formats=analysis.video_formats,
            audio_formats=analysis.audio_formats,
        )

    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        resource = self.catalog.get(request.media_id)
        if not isinstance(resource, YouTubeMediaResource):
            raise ApplicationError(
                "MEDIA_EXPIRED",
                "El análisis ya no está disponible. Analiza de nuevo el enlace.",
                404,
            )
        if request.download_type == DownloadType.VIDEO_AUDIO:
            return self._video_audio_plan(resource, request)
        if request.download_type == DownloadType.VIDEO_ONLY:
            return self._video_only_plan(resource, request)
        return self._audio_only_plan(resource, request)

    async def _video_streams(
        self, formats: Iterable[ExtractedFormat]
    ) -> list[YouTubeStreamResource]:
        grouped: dict[int, list[ExtractedFormat]] = {}
        for item in formats:
            if item.has_video and item.container == "mp4" and item.height is not None:
                grouped.setdefault(item.height, []).append(item)
        selected: list[YouTubeStreamResource] = []
        for height in sorted(grouped):
            candidates = sorted(grouped[height], key=_video_rank, reverse=True)
            stream = await self._first_safe(candidates, "video")
            if stream is not None:
                selected.append(stream)
        return selected

    async def _audio_streams(
        self, formats: Iterable[ExtractedFormat]
    ) -> list[YouTubeStreamResource]:
        grouped: dict[tuple[str, str], list[ExtractedFormat]] = {}
        for item in formats:
            if item.has_audio and not item.has_video and item.container in {"m4a", "webm"}:
                key = (item.container, _codec_family(item.audio_codec))
                grouped.setdefault(key, []).append(item)
        selected: list[YouTubeStreamResource] = []
        for key in sorted(grouped, key=lambda value: (value[0] != "m4a", value)):
            candidates = sorted(grouped[key], key=_audio_rank, reverse=True)
            stream = await self._first_safe(candidates, "audio")
            if stream is not None:
                selected.append(stream)
        return sorted(selected, key=_stored_audio_rank, reverse=True)

    async def _first_safe(
        self, candidates: Iterable[ExtractedFormat], role: str
    ) -> YouTubeStreamResource | None:
        for candidate in candidates:
            try:
                await self.policy.validate_public_destination(candidate.url)
            except ApplicationError:
                continue
            return _stored_stream(candidate, role)
        return None

    @staticmethod
    def _video_model(stream: YouTubeStreamResource) -> VideoFormat:
        resolution = (
            f"{stream.width}x{stream.height}"
            if stream.width is not None and stream.height is not None
            else f"{stream.height}p"
            if stream.height is not None
            else None
        )
        return VideoFormat(
            id=stream.format_id,
            format_id=stream.format_id,
            resolution=resolution,
            width=stream.width,
            height=stream.height,
            fps=stream.fps,
            container=stream.container,
            codec=stream.codec,
            bitrate=stream.bitrate,
            has_audio=stream.has_audio,
            estimated_size=stream.estimated_size,
        )

    @staticmethod
    def _audio_model(stream: YouTubeStreamResource) -> AudioFormat:
        return AudioFormat(
            id=stream.format_id,
            format_id=stream.format_id,
            container=stream.container,
            codec=stream.codec,
            bitrate=stream.bitrate,
            estimated_size=stream.estimated_size,
        )

    def _video_audio_plan(
        self, resource: YouTubeMediaResource, request: DownloadRequest
    ) -> PreparedDownload:
        video = _find_stream(resource.video_streams, request.format_id)
        filename = f"{_safe_stem(resource.title)}.mp4"
        if video.has_audio:
            return self._checked_plan(
                resource,
                filename,
                "video/mp4",
                [_source(video, "media")],
                ProcessingMode.DIRECT,
                video.estimated_size,
            )
        audio = (
            _find_stream(resource.audio_streams, request.audio_format_id)
            if request.audio_format_id is not None
            else _best_audio(resource.audio_streams)
        )
        return self._checked_plan(
            resource,
            filename,
            "video/mp4",
            [_source(video, "video"), _source(audio, "audio")],
            ProcessingMode.MUX,
            _sum_known(video.estimated_size, audio.estimated_size),
        )

    def _video_only_plan(
        self, resource: YouTubeMediaResource, request: DownloadRequest
    ) -> PreparedDownload:
        video = _find_stream(resource.video_streams, request.format_id)
        return self._checked_plan(
            resource,
            f"{_safe_stem(resource.title)}.mp4",
            "video/mp4",
            [_source(video, "media" if video.has_audio else "video")],
            ProcessingMode.STRIP_AUDIO if video.has_audio else ProcessingMode.DIRECT,
            video.estimated_size,
        )

    def _audio_only_plan(
        self, resource: YouTubeMediaResource, request: DownloadRequest
    ) -> PreparedDownload:
        audio = _find_stream(resource.audio_streams, request.format_id)
        output = request.audio_output_format or AudioOutputFormat.M4A
        if output == AudioOutputFormat.MP3 and request.audio_bitrate is None:
            raise ApplicationError("INVALID_FORMAT", "Selecciona un bitrate de salida para MP3.")
        extension = output.value.lower()
        direct_m4a = (
            output == AudioOutputFormat.M4A
            and audio.container == "m4a"
            and _codec_family(audio.codec) in {"aac", "alac"}
        )
        processing = (
            ProcessingMode.DIRECT
            if direct_m4a
            else ProcessingMode.AUDIO_M4A
            if output == AudioOutputFormat.M4A
            else ProcessingMode.AUDIO_MP3
        )
        expected: int | None
        if output == AudioOutputFormat.MP3 and resource.duration is not None:
            expected = round(resource.duration * (request.audio_bitrate or 192000) / 8)
        else:
            expected = audio.estimated_size
        return self._checked_plan(
            resource,
            f"{_safe_stem(resource.title)}.{extension}",
            "audio/mp4" if output == AudioOutputFormat.M4A else "audio/mpeg",
            [_source(audio, "media" if direct_m4a else "audio")],
            processing,
            expected,
            audio_bitrate=request.audio_bitrate,
        )

    def _checked_plan(
        self,
        resource: YouTubeMediaResource,
        filename: str,
        content_type: str,
        sources: list[DownloadSource],
        processing: ProcessingMode,
        expected_output: int | None,
        *,
        audio_bitrate: int | None = None,
    ) -> PreparedDownload:
        known_input = _sum_known(*(source.estimated_size for source in sources))
        if known_input is not None and known_input > self.settings.max_input_bytes:
            raise ApplicationError(
                "FILE_TOO_LARGE", "Los streams superan el tamaño permitido.", 413
            )
        if expected_output is not None and expected_output > self.settings.max_output_bytes:
            raise ApplicationError(
                "FILE_TOO_LARGE", "El archivo final supera el tamaño permitido.", 413
            )
        return PreparedDownload(
            provider="youtube",
            sources=sources,
            content_type=content_type,
            filename=filename,
            expected_size=expected_output,
            processing=processing,
            duration=resource.duration,
            audio_bitrate=audio_bitrate,
        )


def _stored_stream(item: ExtractedFormat, role: str) -> YouTubeStreamResource:
    codec = _codec_family(item.video_codec if role == "video" else item.audio_codec)
    bitrate = item.bitrate if role == "video" else item.audio_bitrate or item.bitrate
    return YouTubeStreamResource(
        format_id=item.format_id,
        url=item.url,
        role=role,
        content_type=_content_type(item.container, role),
        container=item.container,
        codec=codec,
        width=item.width,
        height=item.height,
        fps=item.fps,
        bitrate=bitrate,
        has_audio=item.has_audio,
        content_length=item.content_length,
        estimated_size=item.estimated_size,
        headers=item.headers,
    )


def _source(stream: YouTubeStreamResource, role: str) -> DownloadSource:
    extension = "mp4" if stream.container == "mp4" else stream.container
    return DownloadSource(
        role=role,
        source_url=stream.url,
        content_type=stream.content_type,
        internal_name=f"input-{role}.{extension}",
        expected_size=stream.content_length,
        estimated_size=stream.estimated_size,
        headers=dict(stream.headers),
    )


def _find_stream(
    streams: tuple[YouTubeStreamResource, ...], format_id: str | None
) -> YouTubeStreamResource:
    stream = next((item for item in streams if item.format_id == format_id), None)
    if stream is None:
        raise ApplicationError(
            "FORMAT_NOT_AVAILABLE", "El formato seleccionado ya no está disponible."
        )
    return stream


def _best_audio(streams: tuple[YouTubeStreamResource, ...]) -> YouTubeStreamResource:
    if not streams:
        raise ApplicationError("FORMAT_NOT_AVAILABLE", "No hay una pista de audio compatible.")
    return max(streams, key=_stored_audio_rank)


def _video_rank(item: ExtractedFormat) -> tuple[int, int, int, int, str]:
    codec = _codec_family(item.video_codec)
    codec_score = {"h264": 4, "hevc": 3, "av1": 2, "vp9": 1}.get(codec, 0)
    return (
        int(item.has_audio),
        codec_score,
        round(item.fps or 0),
        item.bitrate or 0,
        item.format_id,
    )


def _audio_rank(item: ExtractedFormat) -> tuple[int, int, str]:
    return (int(item.container == "m4a"), item.audio_bitrate or item.bitrate or 0, item.format_id)


def _stored_audio_rank(item: YouTubeStreamResource) -> tuple[int, int, str]:
    return (int(item.container == "m4a"), item.bitrate or 0, item.format_id)


def _codec_family(codec: str | None) -> str:
    value = (codec or "").lower()
    if value.startswith(("avc1", "h264")):
        return "h264"
    if value.startswith(("hev1", "hvc1", "hevc")):
        return "hevc"
    if value.startswith(("av01", "av1")):
        return "av1"
    if value.startswith(("vp09", "vp9")):
        return "vp9"
    if value.startswith(("mp4a", "aac")):
        return "aac"
    if value.startswith("alac"):
        return "alac"
    if value.startswith("opus"):
        return "opus"
    return value or "unknown"


def _content_type(container: str, role: str) -> str:
    if container == "m4a":
        return "audio/mp4"
    if container == "webm":
        return "audio/webm" if role == "audio" else "video/webm"
    return "video/mp4" if role == "video" else "audio/mp4"


def _safe_stem(title: str) -> str:
    stem = re.sub(r"[^\w .-]", "_", title, flags=re.UNICODE).strip(" .")[:100]
    return stem or "YouTube video"


def _sum_known(*values: int | None) -> int | None:
    return (
        sum(value for value in values if value is not None)
        if all(value is not None for value in values)
        else None
    )
