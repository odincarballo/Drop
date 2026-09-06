import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from app.core.errors import ApplicationError
from app.services.media_processing.process import run_captured

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MediaStream:
    codec_type: str
    codec_name: str | None
    width: int | None
    height: int | None
    bitrate: int | None


@dataclass(frozen=True)
class MediaProbe:
    duration: float | None
    container: str | None
    streams: tuple[MediaStream, ...]

    @property
    def has_video(self) -> bool:
        return any(stream.codec_type == "video" for stream in self.streams)

    @property
    def has_audio(self) -> bool:
        return any(stream.codec_type == "audio" for stream in self.streams)


class FFprobeService:
    def __init__(self, executable: str, timeout: float) -> None:
        self.executable = executable
        self.timeout = timeout

    async def version(self) -> str:
        try:
            return_code, stdout, _ = await run_captured(
                [self.executable, "-version"],
                execution_timeout=min(self.timeout, 10),
                maximum_output=4096,
            )
        except (FileNotFoundError, OSError, TimeoutError) as exc:
            raise ApplicationError(
                "PROCESSING_UNAVAILABLE", "El motor multimedia no está disponible.", 503
            ) from exc
        if return_code != 0:
            raise ApplicationError(
                "PROCESSING_UNAVAILABLE", "El motor multimedia no está disponible.", 503
            )
        first_line = stdout.decode("utf-8", errors="replace").splitlines()
        return first_line[0][:160] if first_line else "ffprobe"

    async def inspect(self, path: Path) -> MediaProbe:
        try:
            return_code, stdout, stderr = await run_captured(
                [
                    self.executable,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration,format_name:stream=codec_type,codec_name,width,height,bit_rate",
                    "-of",
                    "json",
                    str(path),
                ],
                execution_timeout=self.timeout,
            )
        except FileNotFoundError as exc:
            raise ApplicationError(
                "PROCESSING_UNAVAILABLE", "El motor multimedia no está disponible.", 503
            ) from exc
        except TimeoutError as exc:
            raise ApplicationError(
                "PROCESSING_FAILED", "No se pudo inspeccionar el archivo multimedia."
            ) from exc
        if return_code != 0:
            logger.warning(
                "ffprobe failed return_code=%d stderr_bytes=%d", return_code, len(stderr)
            )
            raise ApplicationError(
                "PROCESSING_FAILED", "No se pudo inspeccionar el archivo multimedia."
            )
        try:
            raw = json.loads(stdout)
            if not isinstance(raw, dict):
                raise ValueError
            payload = cast(dict[str, object], raw)
            raw_streams = payload.get("streams", [])
            if not isinstance(raw_streams, list):
                raise ValueError
            streams = tuple(
                self._stream(cast(dict[str, object], stream))
                for stream in raw_streams
                if isinstance(stream, dict)
            )
            raw_format = payload.get("format")
            media_format = (
                cast(dict[str, object], raw_format) if isinstance(raw_format, dict) else {}
            )
            return MediaProbe(
                duration=_optional_float(media_format.get("duration")),
                container=_optional_string(media_format.get("format_name")),
                streams=streams,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ApplicationError(
                "PROCESSING_FAILED", "No se pudo interpretar el archivo multimedia."
            ) from exc

    @staticmethod
    def _stream(payload: dict[str, object]) -> MediaStream:
        codec_type = _optional_string(payload.get("codec_type"))
        if codec_type not in {"video", "audio"}:
            codec_type = "unknown"
        return MediaStream(
            codec_type=codec_type,
            codec_name=_optional_string(payload.get("codec_name")),
            width=_optional_int(payload.get("width")),
            height=_optional_int(payload.get("height")),
            bitrate=_optional_int(payload.get("bit_rate")),
        )


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_float(value: object) -> float | None:
    try:
        parsed = float(value) if isinstance(value, (str, int, float)) else None
    except ValueError:
        return None
    return parsed if parsed is not None and parsed >= 0 else None


def _optional_int(value: object) -> int | None:
    try:
        parsed = int(value) if isinstance(value, (str, int, float)) else None
    except ValueError:
        return None
    return parsed if parsed is not None and parsed > 0 else None
