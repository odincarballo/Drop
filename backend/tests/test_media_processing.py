import asyncio
import json
import os
from pathlib import Path
from typing import Literal, cast

import pytest
from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import DownloadSource, PreparedDownload, ProcessingMode
from app.services.media_processing import (
    FFmpegMediaProcessor,
    FFprobeService,
    MediaProbe,
    MediaStream,
)


def executable(tmp_path: Path, name: str, source: str) -> Path:
    path = tmp_path / name
    path.write_text(f"#!/usr/bin/env python3\n{source}", encoding="utf-8")
    path.chmod(0o700)
    return path


async def test_ffprobe_parses_duration_streams_codecs_and_bitrate(tmp_path: Path) -> None:
    probe_binary = executable(
        tmp_path,
        "fake-ffprobe",
        """
import json
print(json.dumps({
    "format": {"duration": "12.5", "format_name": "mov,mp4,m4a"},
    "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1280,
         "height": 720, "bit_rate": "900000"},
        {"codec_type": "audio", "codec_name": "aac", "bit_rate": "128000"},
    ],
}))
""",
    )
    media = tmp_path / "input.mp4"
    media.write_bytes(b"placeholder")
    result = await FFprobeService(str(probe_binary), 2).inspect(media)
    assert result.duration == 12.5
    assert result.container == "mov,mp4,m4a"
    assert result.has_video is True
    assert result.has_audio is True
    assert result.streams[0].codec_name == "h264"
    assert result.streams[0].width == 1280
    assert result.streams[1].bitrate == 128000


async def test_ffprobe_failure_is_sanitized(tmp_path: Path) -> None:
    probe_binary = executable(
        tmp_path,
        "broken-ffprobe",
        "import sys\nprint('signed-url-secret', file=sys.stderr)\nsys.exit(7)\n",
    )
    with pytest.raises(ApplicationError) as raised:
        await FFprobeService(str(probe_binary), 2).inspect(tmp_path / "input.mp4")
    assert raised.value.code == "PROCESSING_FAILED"
    assert "secret" not in raised.value.message


class FakeProbe:
    async def inspect(self, path: Path) -> MediaProbe:
        streams: tuple[MediaStream, ...]
        if "audio" in path.name:
            codec = "opus" if path.suffix == ".webm" else "aac"
            streams = (MediaStream("audio", codec, None, None, 128000),)
        elif path.suffix == ".mp3":
            streams = (MediaStream("audio", "mp3", None, None, 192000),)
        else:
            streams = (
                MediaStream("video", "h264", 1280, 720, 900000),
                MediaStream("audio", "aac", None, None, 128000),
            )
        return MediaProbe(10, "mp4", streams)


class MissingOutputAudioProbe(FakeProbe):
    async def inspect(self, path: Path) -> MediaProbe:
        if path.name == "output.mp4":
            return MediaProbe(
                10,
                "mp4",
                (MediaStream("video", "h264", 1280, 720, 900000),),
            )
        return await super().inspect(path)


def plan(mode: ProcessingMode) -> PreparedDownload:
    return PreparedDownload(
        provider="youtube",
        sources=[
            DownloadSource(
                role="video",
                source_url=HttpUrl("https://media.example/video.mp4"),
                content_type="video/mp4",
                internal_name="video.mp4",
            ),
            DownloadSource(
                role="audio",
                source_url=HttpUrl("https://media.example/audio.m4a"),
                content_type="audio/mp4",
                internal_name="audio.m4a",
            ),
        ],
        content_type="video/mp4",
        filename="output.mp4",
        processing=mode,
        duration=10,
    )


async def test_ffmpeg_mux_reports_processing_progress(settings: Settings, tmp_path: Path) -> None:
    ffmpeg = executable(
        tmp_path,
        "fake-ffmpeg",
        """
import pathlib
import sys
pathlib.Path(sys.argv[-1]).write_bytes(b"muxed")
print("out_time_us=5000000")
print("progress=end")
""",
    )
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    probe = cast(FFprobeService, FakeProbe())
    processor = FFmpegMediaProcessor(local_settings, probe)
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.m4a"
    output = tmp_path / "output.mp4"
    video.write_bytes(b"video")
    audio.write_bytes(b"audio")
    updates: list[float | None] = []
    size = await processor.process(
        plan(ProcessingMode.MUX),
        {"video": video, "audio": audio},
        output,
        updates.append,
    )
    assert size == 5
    assert 0.5 in updates
    assert updates[-1] == 1


async def test_ffmpeg_failure_returns_processing_failed(settings: Settings, tmp_path: Path) -> None:
    ffmpeg = executable(tmp_path, "broken-ffmpeg", "import sys\nsys.exit(9)\n")
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    processor = FFmpegMediaProcessor(local_settings, cast(FFprobeService, FakeProbe()))
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.m4a"
    video.write_bytes(b"video")
    audio.write_bytes(b"audio")
    with pytest.raises(ApplicationError) as raised:
        await processor.process(
            plan(ProcessingMode.MUX),
            {"video": video, "audio": audio},
            tmp_path / "output.mp4",
            lambda value: None,
        )
    assert raised.value.code == "PROCESSING_FAILED"


async def test_mux_rejects_output_without_audio(settings: Settings, tmp_path: Path) -> None:
    ffmpeg = executable(
        tmp_path,
        "audio-dropping-ffmpeg",
        "import pathlib, sys\npathlib.Path(sys.argv[-1]).write_bytes(b'video')\n",
    )
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    processor = FFmpegMediaProcessor(
        local_settings, cast(FFprobeService, MissingOutputAudioProbe())
    )
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.m4a"
    await asyncio.to_thread(video.write_bytes, b"video")
    await asyncio.to_thread(audio.write_bytes, b"audio")
    with pytest.raises(ApplicationError) as raised:
        await processor.process(
            plan(ProcessingMode.MUX),
            {"video": video, "audio": audio},
            tmp_path / "output.mp4",
            lambda value: None,
        )
    assert raised.value.code == "PROCESSING_FAILED"


async def test_cancelled_ffmpeg_process_is_terminated(settings: Settings, tmp_path: Path) -> None:
    pid_file = tmp_path / "pid"
    ffmpeg = executable(
        tmp_path,
        "slow-ffmpeg",
        f"""
import os
import pathlib
import time
pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))
time.sleep(30)
""",
    )
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    processor = FFmpegMediaProcessor(local_settings, cast(FFprobeService, FakeProbe()))
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.m4a"
    video.write_bytes(b"video")
    audio.write_bytes(b"audio")
    task = asyncio.create_task(
        processor.process(
            plan(ProcessingMode.MUX),
            {"video": video, "audio": audio},
            tmp_path / "output.mp4",
            lambda value: None,
        )
    )
    for _ in range(100):
        if pid_file.exists():
            break
        await asyncio.sleep(0.01)
    assert pid_file.exists()
    pid = int(pid_file.read_text())
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


@pytest.mark.parametrize("bitrate", [128000, 192000, 256000])
async def test_ffmpeg_mp3_uses_selected_output_bitrate(
    settings: Settings, tmp_path: Path, bitrate: int
) -> None:
    arguments_file = tmp_path / "arguments.json"
    ffmpeg = executable(
        tmp_path,
        "recording-ffmpeg",
        f"""
import json
import pathlib
import sys
pathlib.Path({str(arguments_file)!r}).write_text(json.dumps(sys.argv[1:]))
pathlib.Path(sys.argv[-1]).write_bytes(b"mp3")
""",
    )
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    processor = FFmpegMediaProcessor(local_settings, cast(FFprobeService, FakeProbe()))
    audio = tmp_path / "input-audio.webm"
    await asyncio.to_thread(audio.write_bytes, b"audio")
    audio_plan = PreparedDownload(
        provider="youtube",
        sources=[
            DownloadSource(
                role="audio",
                source_url=HttpUrl("https://media.example/audio.webm"),
                content_type="audio/webm",
                internal_name="input-audio.webm",
            )
        ],
        content_type="audio/mpeg",
        filename="output.mp3",
        processing=ProcessingMode.AUDIO_MP3,
        duration=10,
        audio_bitrate=cast(Literal[128000, 192000, 256000], bitrate),
    )
    output = tmp_path / "output.mp3"
    await processor.process(audio_plan, {"audio": audio}, output, lambda value: None)
    arguments = cast(list[str], json.loads(await asyncio.to_thread(arguments_file.read_text)))
    bitrate_index = arguments.index("-b:a")
    assert arguments[bitrate_index + 1] == f"{bitrate // 1000}k"
    assert "libmp3lame" in arguments


async def test_ffmpeg_m4a_converts_incompatible_audio_to_aac(
    settings: Settings, tmp_path: Path
) -> None:
    arguments_file = tmp_path / "m4a-arguments.json"
    ffmpeg = executable(
        tmp_path,
        "recording-m4a-ffmpeg",
        f"""
import json
import pathlib
import sys
pathlib.Path({str(arguments_file)!r}).write_text(json.dumps(sys.argv[1:]))
pathlib.Path(sys.argv[-1]).write_bytes(b"m4a")
""",
    )
    local_settings = settings.model_copy(update={"ffmpeg_path": str(ffmpeg)})
    processor = FFmpegMediaProcessor(local_settings, cast(FFprobeService, FakeProbe()))
    audio = tmp_path / "input-audio.webm"
    await asyncio.to_thread(audio.write_bytes, b"audio")
    audio_plan = PreparedDownload(
        provider="youtube",
        sources=[
            DownloadSource(
                role="audio",
                source_url=HttpUrl("https://media.example/audio.webm"),
                content_type="audio/webm",
                internal_name="input-audio.webm",
            )
        ],
        content_type="audio/mp4",
        filename="output.m4a",
        processing=ProcessingMode.AUDIO_M4A,
        duration=10,
    )
    output = tmp_path / "output.m4a"
    await processor.process(audio_plan, {"audio": audio}, output, lambda value: None)
    arguments = cast(list[str], json.loads(await asyncio.to_thread(arguments_file.read_text)))
    codec_index = arguments.index("-c:a")
    assert arguments[codec_index + 1] == "aac"


async def test_ffmpeg_stops_output_that_exceeds_limit(settings: Settings, tmp_path: Path) -> None:
    ffmpeg = executable(
        tmp_path,
        "oversized-ffmpeg",
        """
import pathlib
import sys
import time
pathlib.Path(sys.argv[-1]).write_bytes(b"x" * 100)
time.sleep(30)
""",
    )
    local_settings = settings.model_copy(
        update={"ffmpeg_path": str(ffmpeg), "max_output_bytes": 10}
    )
    processor = FFmpegMediaProcessor(local_settings, cast(FFprobeService, FakeProbe()))
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.m4a"
    await asyncio.to_thread(video.write_bytes, b"video")
    await asyncio.to_thread(audio.write_bytes, b"audio")
    with pytest.raises(ApplicationError) as raised:
        await processor.process(
            plan(ProcessingMode.MUX),
            {"video": video, "audio": audio},
            tmp_path / "oversized.mp4",
            lambda value: None,
        )
    assert raised.value.code == "FILE_TOO_LARGE"
