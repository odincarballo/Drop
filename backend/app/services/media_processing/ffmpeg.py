import asyncio
import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import PreparedDownload, ProcessingMode
from app.services.media_processing.probe import FFprobeService
from app.services.media_processing.process import (
    read_limited,
    run_captured,
    terminate_process,
)

logger = logging.getLogger(__name__)

type ProcessingProgress = Callable[[float | None], None]


class MediaProcessor(Protocol):
    async def process(
        self,
        plan: PreparedDownload,
        inputs: Mapping[str, Path],
        output: Path,
        progress: ProcessingProgress,
    ) -> int: ...


class FFmpegMediaProcessor:
    def __init__(self, settings: Settings, probe: FFprobeService) -> None:
        self.settings = settings
        self.probe = probe

    async def version(self) -> str:
        try:
            return_code, stdout, _ = await run_captured(
                [self.settings.ffmpeg_path, "-version"],
                execution_timeout=min(self.settings.media_processing_timeout_seconds, 10),
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
        lines = stdout.decode("utf-8", errors="replace").splitlines()
        return lines[0][:160] if lines else "ffmpeg"

    async def process(
        self,
        plan: PreparedDownload,
        inputs: Mapping[str, Path],
        output: Path,
        progress: ProcessingProgress,
    ) -> int:
        arguments = await self._arguments(plan, inputs, output)
        try:
            process = await asyncio.create_subprocess_exec(
                *arguments,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise ApplicationError(
                "PROCESSING_UNAVAILABLE", "El motor multimedia no está disponible.", 503
            ) from exc
        progress_task = asyncio.create_task(
            self._read_progress(process.stdout, plan.duration, progress)
        )
        stderr_task = asyncio.create_task(read_limited(process.stderr, 128 * 1024))
        size_task = asyncio.create_task(self._enforce_output_limit(process, output))
        try:
            async with asyncio.timeout(self.settings.media_processing_timeout_seconds):
                return_code = await process.wait()
            await progress_task
            stderr = await stderr_task
            await size_task
        except asyncio.CancelledError:
            await terminate_process(process)
            await asyncio.gather(progress_task, stderr_task, size_task, return_exceptions=True)
            raise
        except TimeoutError as exc:
            await terminate_process(process)
            await asyncio.gather(progress_task, stderr_task, size_task, return_exceptions=True)
            raise ApplicationError(
                "PROCESSING_FAILED", "El procesamiento multimedia tardó demasiado."
            ) from exc
        except BaseException:
            await terminate_process(process)
            await asyncio.gather(progress_task, stderr_task, size_task, return_exceptions=True)
            raise
        if return_code != 0:
            logger.warning(
                "ffmpeg failed mode=%s return_code=%d stderr_bytes=%d",
                plan.processing,
                return_code,
                len(stderr),
            )
            raise ApplicationError("PROCESSING_FAILED", "No se pudo generar el archivo multimedia.")
        size = await asyncio.to_thread(_output_size, output)
        if size <= 0:
            raise ApplicationError("PROCESSING_FAILED", "No se pudo generar el archivo multimedia.")
        if size > self.settings.max_output_bytes:
            await asyncio.to_thread(output.unlink, missing_ok=True)
            raise ApplicationError(
                "FILE_TOO_LARGE", "El archivo final supera el tamaño permitido.", 413
            )
        result = await self.probe.inspect(output)
        if plan.content_type == "video/mp4" and not result.has_video:
            raise ApplicationError("PROCESSING_FAILED", "El archivo final no contiene video.")
        if plan.processing == ProcessingMode.MUX and not result.has_audio:
            raise ApplicationError("PROCESSING_FAILED", "El archivo final no contiene audio.")
        if plan.processing == ProcessingMode.STRIP_AUDIO and result.has_audio:
            raise ApplicationError("PROCESSING_FAILED", "No se pudo retirar el audio del archivo.")
        if plan.content_type.startswith("audio/") and not result.has_audio:
            raise ApplicationError("PROCESSING_FAILED", "El archivo final no contiene audio.")
        progress(1)
        return size

    async def _enforce_output_limit(
        self, process: asyncio.subprocess.Process, output: Path
    ) -> None:
        while True:
            size = await asyncio.to_thread(_output_size, output)
            if size > self.settings.max_output_bytes:
                await terminate_process(process)
                raise ApplicationError(
                    "FILE_TOO_LARGE", "El archivo final supera el tamaño permitido.", 413
                )
            if process.returncode is not None:
                return
            await asyncio.sleep(0.05)

    async def _arguments(
        self, plan: PreparedDownload, inputs: Mapping[str, Path], output: Path
    ) -> list[str]:
        prefix = [
            self.settings.ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
        ]
        if plan.processing == ProcessingMode.MUX:
            video = _required_input(inputs, "video")
            audio = _required_input(inputs, "audio")
            video_probe, audio_probe = await asyncio.gather(
                self.probe.inspect(video), self.probe.inspect(audio)
            )
            if not video_probe.has_video or not audio_probe.has_audio:
                raise ApplicationError(
                    "PROCESSING_FAILED", "Los streams seleccionados no son compatibles."
                )
            audio_stream = next(
                stream for stream in audio_probe.streams if stream.codec_type == "audio"
            )
            audio_codec = (
                ["-c:a", "copy"]
                if audio_stream.codec_name in {"aac", "alac"}
                else ["-c:a", "aac", "-b:a", "192k"]
            )
            body = [
                "-i",
                str(video),
                "-i",
                str(audio),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                *audio_codec,
                "-movflags",
                "+faststart",
            ]
        elif plan.processing == ProcessingMode.STRIP_AUDIO:
            media = _required_input(inputs, "media")
            if not (await self.probe.inspect(media)).has_video:
                raise ApplicationError("PROCESSING_FAILED", "El stream no contiene video.")
            body = [
                "-i",
                str(media),
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "copy",
                "-movflags",
                "+faststart",
            ]
        elif plan.processing in {ProcessingMode.AUDIO_M4A, ProcessingMode.AUDIO_MP3}:
            audio = _required_input(inputs, "audio")
            probe = await self.probe.inspect(audio)
            if not probe.has_audio:
                raise ApplicationError("PROCESSING_FAILED", "El stream no contiene audio.")
            if plan.processing == ProcessingMode.AUDIO_M4A:
                audio_stream = next(
                    stream for stream in probe.streams if stream.codec_type == "audio"
                )
                codec_args = (
                    ["-c:a", "copy"]
                    if audio_stream.codec_name in {"aac", "alac"}
                    else ["-c:a", "aac", "-b:a", "192k"]
                )
            else:
                bitrate = plan.audio_bitrate or 192000
                codec_args = ["-c:a", "libmp3lame", "-b:a", f"{bitrate // 1000}k"]
            body = ["-i", str(audio), "-map", "0:a:0", "-vn", *codec_args]
        else:
            raise ApplicationError("PROCESSING_FAILED", "El plan multimedia no es válido.")
        return [*prefix, *body, "-progress", "pipe:1", "-nostats", str(output)]

    @staticmethod
    async def _read_progress(
        stream: asyncio.StreamReader | None,
        duration: float | None,
        update: ProcessingProgress,
    ) -> None:
        if stream is None:
            return
        while line := await stream.readline():
            key, separator, value = line.decode("ascii", errors="ignore").strip().partition("=")
            if separator != "=" or key not in {"out_time_us", "out_time_ms"}:
                continue
            if duration is None or duration <= 0:
                update(None)
                continue
            try:
                microseconds = int(value)
            except ValueError:
                continue
            update(min(max(microseconds / 1_000_000 / duration, 0), 0.99))


def _required_input(inputs: Mapping[str, Path], role: str) -> Path:
    try:
        return inputs[role]
    except KeyError as exc:
        raise ApplicationError("PROCESSING_FAILED", "Falta un stream requerido.") from exc


def _output_size(path: Path) -> int:
    return path.stat().st_size if path.is_file() else 0
