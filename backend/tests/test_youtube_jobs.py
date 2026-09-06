import asyncio
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

import pytest
from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import (
    AvailableStreams,
    DownloadRequest,
    DownloadSource,
    DownloadType,
    JobResponse,
    JobStatus,
    MediaAnalysis,
    PreparedDownload,
    ProcessingMode,
)
from app.providers.base import MediaProvider
from app.services.http import RemoteResponse, SafeHTTPClient
from app.services.jobs import JobManager
from app.services.media_processing import MediaProcessor
from app.services.url_safety import URLSafetyPolicy
from app.storage.local import LocalTemporaryStorage
from tests.fakes import BlockingResponse, MemoryResponse, QueueTransport


class StaticPlanProvider(MediaProvider):
    def __init__(self, plan: PreparedDownload) -> None:
        self.plan = plan

    def supports(self, url: HttpUrl) -> bool:
        return True

    def owns(self, media_id: str) -> bool:
        return media_id.startswith("youtube-")

    async def analyze(self, url: HttpUrl) -> MediaAnalysis:
        raise AssertionError("analysis is not used by job tests")

    async def get_available_streams(self, url: HttpUrl) -> AvailableStreams:
        raise AssertionError("stream listing is not used by job tests")

    async def prepare_download(self, request: DownloadRequest) -> PreparedDownload:
        return self.plan


class BlockingProcessor(MediaProcessor):
    def __init__(self, *, fail: bool = False) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.cancelled = False
        self.fail = fail
        self.inputs: Mapping[str, Path] = {}

    async def process(
        self,
        plan: PreparedDownload,
        inputs: Mapping[str, Path],
        output: Path,
        progress: Callable[[float | None], None],
    ) -> int:
        self.inputs = dict(inputs)
        self.started.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        if self.fail:
            raise ApplicationError("PROCESSING_FAILED", "No se pudo generar el archivo.")
        progress(0.75)
        await asyncio.to_thread(output.write_bytes, b"final")
        return 5


def youtube_plan(mode: ProcessingMode = ProcessingMode.MUX) -> PreparedDownload:
    return PreparedDownload(
        provider="youtube",
        sources=[
            DownloadSource(
                role="video",
                source_url=HttpUrl("https://rr.example/video.mp4"),
                content_type="video/mp4",
                internal_name="input-video.mp4",
                expected_size=4,
                estimated_size=4,
            ),
            DownloadSource(
                role="audio",
                source_url=HttpUrl("https://rr.example/audio.m4a"),
                content_type="audio/mp4",
                internal_name="input-audio.m4a",
                expected_size=4,
                estimated_size=4,
            ),
        ],
        content_type="video/mp4",
        filename="Video final.mp4",
        expected_size=8,
        processing=mode,
        duration=10,
    )


def make_manager(
    settings: Settings,
    responses: Sequence[RemoteResponse],
    processor: MediaProcessor,
    plan: PreparedDownload | None = None,
) -> JobManager:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    client = SafeHTTPClient(
        URLSafetyPolicy(settings, resolver), QueueTransport(responses), settings
    )
    return JobManager(
        StaticPlanProvider(plan or youtube_plan()),
        client,
        LocalTemporaryStorage(settings.temp_directory, settings.temp_file_ttl),
        settings,
        processor,
    )


async def create_job(manager: JobManager) -> JobResponse:
    return await manager.create(
        DownloadRequest(
            media_id="youtube-test",
            download_type=DownloadType.VIDEO_AUDIO,
            format_id="video-format",
        )
    )


async def wait_for_status(manager: JobManager, job_id: str, expected: JobStatus) -> JobResponse:
    for _ in range(100):
        result = manager.get(job_id)
        if result.status == expected:
            return result
        await asyncio.sleep(0.01)
    raise AssertionError(f"Job did not reach {expected}")


def workspaces(path: Path) -> list[Path]:
    return list(path.glob("mediadrop-*"))


async def test_youtube_job_reports_processing_and_keeps_only_final_file(
    settings: Settings,
) -> None:
    processor = BlockingProcessor()
    manager = make_manager(
        settings,
        [
            MemoryResponse(200, {"Content-Type": "video/mp4", "Content-Length": "4"}, [b"vid0"]),
            MemoryResponse(200, {"Content-Type": "audio/mp4", "Content-Length": "4"}, [b"aud0"]),
        ],
        processor,
    )
    created = await create_job(manager)
    await processor.started.wait()
    processing = manager.get(created.id)
    assert processing.status == JobStatus.PROCESSING
    assert processing.phase == "MUXING"
    assert processing.message == "Combinando video y audio…"
    assert processing.bytes_downloaded == 8
    assert processing.total_bytes == 8

    processor.release.set()
    completed = await wait_for_status(manager, created.id, JobStatus.COMPLETED)
    assert completed.progress == 1
    assert completed.bytes_downloaded == 8
    assert completed.file_size == 5
    path, content_type, filename = manager.get_file(created.id)
    assert content_type == "video/mp4"
    assert filename == "Video final.mp4"
    assert await asyncio.to_thread(path.read_bytes) == b"final"
    assert [item.name for item in path.parent.iterdir()] == ["Video final.mp4"]


async def test_youtube_download_phase_and_cancellation_remove_workspace(
    settings: Settings,
) -> None:
    processor = BlockingProcessor()
    manager = make_manager(
        settings,
        [BlockingResponse(200, {"Content-Type": "video/mp4", "Content-Length": "4"}, [b"vid0"])],
        processor,
    )
    created = await create_job(manager)
    downloading = await wait_for_status(manager, created.id, JobStatus.DOWNLOADING)
    assert downloading.phase == "DOWNLOADING_VIDEO"
    assert downloading.message == "Descargando video…"
    cancelled = await manager.cancel(created.id)
    assert cancelled.status == JobStatus.CANCELLED
    assert cancelled.phase is None
    assert not await asyncio.to_thread(workspaces, Path(settings.temp_directory))


async def test_processing_cancellation_stops_processor_and_releases_slot(
    settings: Settings,
) -> None:
    limited = settings.model_copy(update={"max_active_jobs": 2, "max_processing_jobs": 1})
    processor = BlockingProcessor()
    responses = [
        MemoryResponse(200, {"Content-Type": "video/mp4", "Content-Length": "4"}, [b"vid0"]),
        MemoryResponse(200, {"Content-Type": "audio/mp4", "Content-Length": "4"}, [b"aud0"]),
    ]
    manager = make_manager(limited, responses, processor)
    first = await create_job(manager)
    await processor.started.wait()
    with pytest.raises(ApplicationError) as raised:
        await create_job(manager)
    assert raised.value.code == "PROCESSING_BUSY"

    cancelled = await manager.cancel(first.id)
    assert cancelled.status == JobStatus.CANCELLED
    assert processor.cancelled is True
    assert not await asyncio.to_thread(workspaces, Path(settings.temp_directory))


async def test_processing_failure_removes_all_partial_files(settings: Settings) -> None:
    processor = BlockingProcessor(fail=True)
    manager = make_manager(
        settings,
        [
            MemoryResponse(200, {"Content-Type": "video/mp4", "Content-Length": "4"}, [b"vid0"]),
            MemoryResponse(200, {"Content-Type": "audio/mp4", "Content-Length": "4"}, [b"aud0"]),
        ],
        processor,
    )
    created = await create_job(manager)
    await processor.started.wait()
    processor.release.set()
    failed = await wait_for_status(manager, created.id, JobStatus.FAILED)
    assert failed.error is not None
    assert failed.error.code == "PROCESSING_FAILED"
    assert not await asyncio.to_thread(workspaces, Path(settings.temp_directory))


async def test_youtube_job_uses_real_response_length_for_progress(
    settings: Settings,
) -> None:
    direct_plan = PreparedDownload(
        provider="youtube",
        sources=[
            DownloadSource(
                role="media",
                source_url=HttpUrl("https://rr.example/progressive.mp4"),
                content_type="video/mp4",
                internal_name="input-media.mp4",
                expected_size=None,
                estimated_size=5,
            )
        ],
        content_type="video/mp4",
        filename="Progressive.mp4",
        expected_size=5,
        processing=ProcessingMode.DIRECT,
    )
    manager = make_manager(
        settings,
        [
            MemoryResponse(
                200,
                {"Content-Type": "video/mp4", "Content-Length": "5"},
                [b"12345"],
            )
        ],
        BlockingProcessor(),
        direct_plan,
    )
    created = await create_job(manager)
    completed = await wait_for_status(manager, created.id, JobStatus.COMPLETED)
    assert completed.bytes_downloaded == 5
    assert completed.total_bytes == 5
    assert completed.progress == 1
