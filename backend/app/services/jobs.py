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
    JobResponse,
    JobStatus,
    PreparedDownload,
)
from app.providers.direct import DirectMediaProvider
from app.services.http import SafeHTTPClient
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


class JobManager:
    """Single-process job state with one task and one temporary workspace per job."""

    def __init__(
        self,
        provider: DirectMediaProvider,
        http_client: SafeHTTPClient,
        storage: TemporaryStorage,
        settings: Settings,
    ) -> None:
        self.provider = provider
        self.http_client = http_client
        self.storage = storage
        self.settings = settings
        self._jobs: dict[str, DownloadJob] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._create_lock = asyncio.Lock()

    async def create(self, request: DownloadRequest) -> JobResponse:
        async with self._create_lock:
            active_jobs = sum(
                job.status in {JobStatus.PENDING, JobStatus.DOWNLOADING}
                for job in self._jobs.values()
            )
            if active_jobs >= self.settings.max_active_jobs:
                raise ApplicationError(
                    "SERVER_BUSY",
                    "El servidor ya está procesando el máximo de descargas. Inténtalo más tarde.",
                    503,
                )
            prepared = await self.provider.prepare_download(request)
            workspace = self.storage.create_workspace()
            job_id = uuid4().hex
            job = DownloadJob(
                id=job_id,
                status=JobStatus.PENDING,
                workspace=workspace,
                prepared=prepared,
                created_at=time.time(),
                progress=0 if prepared.expected_size is not None else None,
                total_bytes=prepared.expected_size,
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
        file_path = job.workspace / job.prepared.filename
        try:
            job.status = JobStatus.DOWNLOADING
            with file_path.open("xb") as output:

                def update(downloaded: int, total: int | None) -> None:
                    job.bytes_downloaded = downloaded
                    job.total_bytes = total
                    job.progress = (
                        min(downloaded / total, 1) if total is not None and total > 0 else None
                    )

                size = await self.http_client.download(
                    job.prepared.source_url,
                    expected_type=job.prepared.content_type,
                    expected_length=job.prepared.expected_size,
                    write=output.write,
                    progress=update,
                )
            job.status = JobStatus.COMPLETED
            job.progress = 1
            job.file_path = file_path
            job.file_size = size
            job.bytes_downloaded = size
            job.finished_at = time.time()
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
            progress=job.progress,
            bytes_downloaded=job.bytes_downloaded,
            total_bytes=job.total_bytes,
            file_name=job.prepared.filename,
            file_size=job.file_size,
            error=job.error,
            download_url=f"/jobs/{job.id}/file" if job.status == JobStatus.COMPLETED else None,
        )

    @staticmethod
    def _duration_ms(job: DownloadJob) -> int:
        finished_at = job.finished_at if job.finished_at is not None else time.time()
        return max(0, round((finished_at - job.created_at) * 1000))
