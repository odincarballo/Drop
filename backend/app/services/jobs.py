import asyncio
import errno
import logging
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.models.media import (
    DownloadRequest,
    ErrorDetail,
    JobPhase,
    JobResponse,
    JobStatus,
    PreparedDownload,
    ProcessingMode,
)
from app.providers.base import MediaProvider
from app.services.http import SafeHTTPClient
from app.services.media_processing import MediaProcessor
from app.storage.base import TemporaryStorage

logger = logging.getLogger(__name__)


@dataclass
class DownloadJob:
    id: str
    status: JobStatus
    workspace: Path
    prepared: PreparedDownload
    created_at: float
    progress: float | None = 0
    bytes_downloaded: int = 0
    total_bytes: int | None = None
    file_path: Path | None = None
    file_size: int | None = None
    error: ErrorDetail | None = None
    finished_at: float | None = None
    phase: JobPhase | None = None
    message: str | None = None


class JobManager:
    """Single-process job state with one task and one temporary workspace per job."""

    def __init__(
        self,
        provider: MediaProvider,
        http_client: SafeHTTPClient,
        storage: TemporaryStorage,
        settings: Settings,
        processor: MediaProcessor | None = None,
    ) -> None:
        self.provider = provider
        self.http_client = http_client
        self.storage = storage
        self.settings = settings
        self.processor = processor
        self._jobs: dict[str, DownloadJob] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._create_lock = asyncio.Lock()

    async def create(self, request: DownloadRequest) -> JobResponse:
        async with self._create_lock:
            active_jobs = sum(self._is_active(job) for job in self._jobs.values())
            if active_jobs >= self.settings.max_active_jobs:
                raise ApplicationError(
                    "SERVER_BUSY",
                    "El servidor ya está procesando el máximo de descargas. Inténtalo más tarde.",
                    503,
                )
            prepared = await self.provider.prepare_download(request)
            active_processing = sum(
                self._is_active(job) and job.prepared.requires_processing
                for job in self._jobs.values()
            )
            if (
                prepared.requires_processing
                and active_processing >= self.settings.max_processing_jobs
            ):
                raise ApplicationError(
                    "PROCESSING_BUSY",
                    "MediaDrop está procesando otra descarga. "
                    "Inténtalo nuevamente en unos momentos.",
                    503,
                )
            workspace = self.storage.create_workspace()
            job_id = uuid4().hex
            job = DownloadJob(
                id=job_id,
                status=JobStatus.PENDING,
                workspace=workspace,
                prepared=prepared,
                created_at=time.time(),
                progress=0 if _known_source_size(prepared) is not None else None,
                total_bytes=_known_source_size(prepared),
                message="Preparando descarga…" if prepared.provider == "youtube" else None,
            )
            self._jobs[job_id] = job
            self._tasks[job_id] = asyncio.create_task(self._run(job))
        logger.info("Download job created job_id=%s status=%s", job.id, job.status)
        return self._snapshot(job)

    def get(self, job_id: str) -> JobResponse:
        return self._snapshot(self._require(job_id))

    def get_file(self, job_id: str) -> tuple[Path, str, str]:
        job = self._require(job_id)
        if job.status != JobStatus.COMPLETED or job.file_path is None:
            raise ApplicationError("JOB_NOT_READY", "El archivo todavía no está disponible.", 409)
        if not job.file_path.is_file():
            raise ApplicationError(
                "FILE_EXPIRED", "El archivo temporal caducó. Inicia una nueva descarga.", 404
            )
        return job.file_path, job.prepared.content_type, job.prepared.filename

    async def cancel(self, job_id: str) -> JobResponse:
        job = self._require(job_id)
        if job.status == JobStatus.CANCELLED:
            return self._snapshot(job)
        task = self._tasks.get(job_id)
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        job.status = JobStatus.CANCELLED
        job.error = None
        job.file_path = None
        job.file_size = None
        job.finished_at = job.finished_at or time.time()
        job.phase = None
        job.message = None
        self.storage.delete_workspace(job.workspace)
        logger.info(
            "Download job cancelled job_id=%s status=%s bytes=%d duration_ms=%d",
            job.id,
            job.status,
            job.bytes_downloaded,
            self._duration_ms(job),
        )
        return self._snapshot(job)

    async def shutdown(self) -> None:
        active = [job_id for job_id, task in self._tasks.items() if not task.done()]
        for job_id in active:
            await self.cancel(job_id)

    def cleanup_expired(self) -> int:
        cutoff = time.time() - self.settings.temp_file_ttl
        expired = [
            job_id
            for job_id, job in self._jobs.items()
            if job.finished_at is not None and job.finished_at < cutoff
        ]
        for job_id in expired:
            job = self._jobs.pop(job_id)
            self._tasks.pop(job_id, None)
            self.storage.delete_workspace(job.workspace)
        return len(expired)

    async def _run(self, job: DownloadJob) -> None:
        try:
            if job.prepared.provider == "youtube":
                job.status = JobStatus.PREPARING
                job.phase = JobPhase.PREPARING
                job.message = "Preparando streams…"
                await asyncio.sleep(0)
            inputs = await self._download_sources(job)
            file_path = job.workspace / job.prepared.filename
            if job.prepared.requires_processing:
                if self.processor is None:
                    raise ApplicationError(
                        "PROCESSING_UNAVAILABLE", "El motor multimedia no está disponible.", 503
                    )
                job.status = JobStatus.PROCESSING
                job.phase = _processing_phase(job.prepared)
                job.progress = 0 if job.prepared.duration is not None else None
                job.message = _processing_message(job.phase)

                def processing_progress(value: float | None) -> None:
                    job.progress = value

                size = await self.processor.process(
                    job.prepared, inputs, file_path, processing_progress
                )
                for input_path in inputs.values():
                    if input_path != file_path:
                        await asyncio.to_thread(input_path.unlink, missing_ok=True)
            else:
                source_path = next(iter(inputs.values()))
                await asyncio.to_thread(source_path.replace, file_path)
                size = await asyncio.to_thread(_file_size, file_path)
            workspace_size = await asyncio.to_thread(_workspace_size, job.workspace)
            if workspace_size > self.settings.max_temp_work_bytes:
                raise ApplicationError(
                    "FILE_TOO_LARGE", "El trabajo temporal supera el tamaño permitido.", 413
                )
            job.status = JobStatus.COMPLETED
            job.phase = JobPhase.FINALIZING
            job.progress = 1
            job.file_path = file_path
            job.file_size = size
            job.finished_at = time.time()
            job.message = "Descarga completada"
            self.storage.preserve_workspace(job.workspace)
            logger.info(
                "Download job completed job_id=%s status=%s bytes=%d duration_ms=%d",
                job.id,
                job.status,
                size,
                self._duration_ms(job),
            )
        except asyncio.CancelledError:
            job.status = JobStatus.CANCELLED
            job.phase = None
            job.message = None
            job.finished_at = time.time()
            self.storage.delete_workspace(job.workspace)
            raise
        except ApplicationError as exc:
            self._fail(job, exc.code, exc.message)
        except OSError as exc:
            if exc.errno == errno.ENOSPC:
                self._fail(
                    job, "STORAGE_FULL", "No hay espacio suficiente para guardar el archivo."
                )
            else:
                self._fail(job, "STORAGE_ERROR", "No se pudo escribir el archivo temporal.")
        except Exception as exc:
            logger.error(
                "Unexpected download failure job_id=%s exception_type=%s",
                job.id,
                type(exc).__name__,
            )
            self._fail(job, "DOWNLOAD_FAILED", "No se pudo completar la descarga.")
        finally:
            self._tasks.pop(job.id, None)

    def _fail(self, job: DownloadJob, code: str, message: str) -> None:
        job.status = JobStatus.FAILED
        job.error = ErrorDetail(code=code, message=message)
        job.file_path = None
        job.file_size = None
        job.finished_at = time.time()
        job.phase = None
        job.message = None
        self.storage.delete_workspace(job.workspace)
        logger.warning(
            "Download job failed job_id=%s status=%s bytes=%d duration_ms=%d error_code=%s",
            job.id,
            job.status,
            job.bytes_downloaded,
            self._duration_ms(job),
            code,
        )

    def _require(self, job_id: str) -> DownloadJob:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise ApplicationError("JOB_NOT_FOUND", "La descarga no existe.", 404) from exc

    @staticmethod
    def _snapshot(job: DownloadJob) -> JobResponse:
        return JobResponse(
            id=job.id,
            status=job.status,
            phase=job.phase,
            progress=job.progress,
            bytes_downloaded=job.bytes_downloaded,
            total_bytes=job.total_bytes,
            file_name=job.prepared.filename,
            file_size=job.file_size,
            error=job.error,
            download_url=f"/jobs/{job.id}/file" if job.status == JobStatus.COMPLETED else None,
            message=job.message,
        )

    @staticmethod
    def _duration_ms(job: DownloadJob) -> int:
        finished_at = job.finished_at if job.finished_at is not None else time.time()
        return max(0, round((finished_at - job.created_at) * 1000))

    async def _download_sources(self, job: DownloadJob) -> dict[str, Path]:
        job.status = JobStatus.DOWNLOADING
        completed_bytes = 0
        inputs: dict[str, Path] = {}
        for index, source in enumerate(job.prepared.sources):
            job.phase = (
                JobPhase.DOWNLOADING_VIDEO
                if source.role == "video"
                else JobPhase.DOWNLOADING_AUDIO
                if source.role == "audio"
                else JobPhase.DOWNLOADING
            )
            job.message = _download_message(job.phase)
            path = job.workspace / source.internal_name
            remaining_sizes = tuple(
                item.expected_size for item in job.prepared.sources[index + 1 :]
            )
            with path.open("xb") as output:

                def update(
                    downloaded: int,
                    total: int | None,
                    base: int = completed_bytes,
                    future_sizes: tuple[int | None, ...] = remaining_sizes,
                ) -> None:
                    aggregate = base + downloaded
                    aggregate_total = (
                        base + total + sum(size for size in future_sizes if size is not None)
                        if total is not None and all(size is not None for size in future_sizes)
                        else None
                    )
                    job.bytes_downloaded = aggregate
                    job.total_bytes = aggregate_total
                    job.progress = (
                        min(aggregate / aggregate_total, 1)
                        if aggregate_total is not None and aggregate_total > 0
                        else None
                    )

                remaining = self.settings.max_input_bytes - completed_bytes
                size = await self.http_client.download(
                    source.source_url,
                    expected_type=source.content_type,
                    expected_length=source.expected_size,
                    write=output.write,
                    progress=update,
                    headers=source.headers,
                    max_bytes=(
                        self.settings.max_file_size
                        if job.prepared.provider == "direct"
                        else remaining
                    ),
                )
            completed_bytes += size
            job.bytes_downloaded = completed_bytes
            inputs[source.role] = path
            if completed_bytes > self.settings.max_input_bytes:
                raise ApplicationError(
                    "FILE_TOO_LARGE", "Los streams superan el tamaño permitido.", 413
                )
        return inputs

    @staticmethod
    def _is_active(job: DownloadJob) -> bool:
        return job.status in {
            JobStatus.PENDING,
            JobStatus.PREPARING,
            JobStatus.DOWNLOADING,
            JobStatus.PROCESSING,
        }


def _known_source_size(prepared: PreparedDownload) -> int | None:
    sizes = [source.expected_size for source in prepared.sources]
    return (
        sum(size for size in sizes if size is not None)
        if all(size is not None for size in sizes)
        else None
    )


def _workspace_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.iterdir() if item.is_file())


def _file_size(path: Path) -> int:
    return path.stat().st_size


def _processing_phase(prepared: PreparedDownload) -> JobPhase:
    if prepared.processing == ProcessingMode.MUX:
        return JobPhase.MUXING
    if prepared.processing in {ProcessingMode.AUDIO_M4A, ProcessingMode.AUDIO_MP3}:
        return JobPhase.CONVERTING
    return JobPhase.FINALIZING


def _processing_message(phase: JobPhase) -> str:
    return {
        JobPhase.MUXING: "Combinando video y audio…",
        JobPhase.CONVERTING: "Convirtiendo audio…",
        JobPhase.FINALIZING: "Preparando archivo final…",
    }[phase]


def _download_message(phase: JobPhase) -> str:
    return {
        JobPhase.DOWNLOADING_VIDEO: "Descargando video…",
        JobPhase.DOWNLOADING_AUDIO: "Descargando audio…",
        JobPhase.DOWNLOADING: "Descargando…",
    }[phase]
