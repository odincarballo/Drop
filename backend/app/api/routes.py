from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse

from app.api.auth import require_api_access
from app.core.config import Settings
from app.models.media import (
    AnalyzeRequest,
    DownloadRequest,
    ErrorResponse,
    HealthResponse,
    JobResponse,
    MediaAnalysis,
)
from app.services.analysis import AnalysisService
from app.services.jobs import JobManager

router = APIRouter()


def get_analysis_service(request: Request) -> AnalysisService:
    return cast(AnalysisService, request.app.state.analysis_service)


def get_job_manager(request: Request) -> JobManager:
    return cast(JobManager, request.app.state.job_manager)


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = cast(Settings, request.app.state.settings)
    return HealthResponse(service=settings.app_name)


@router.post(
    "/analyze",
    response_model=MediaAnalysis,
    dependencies=[Depends(require_api_access)],
    responses={code: {"model": ErrorResponse} for code in (400, 401, 403, 413, 422, 429, 500, 504)},
)
async def analyze(
    body: AnalyzeRequest,
    service: Annotated[AnalysisService, Depends(get_analysis_service)],
) -> MediaAnalysis:
    return await service.analyze(body.url)


@router.post(
    "/jobs",
    response_model=JobResponse,
    status_code=201,
    dependencies=[Depends(require_api_access)],
    responses={
        code: {"model": ErrorResponse} for code in (400, 401, 403, 404, 413, 422, 429, 500, 503)
    },
)
async def create_job(
    body: DownloadRequest,
    manager: Annotated[JobManager, Depends(get_job_manager)],
) -> JobResponse:
    return await manager.create(body)


@router.get(
    "/jobs/{job_id}",
    response_model=JobResponse,
    dependencies=[Depends(require_api_access)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 429)},
)
async def get_job(
    job_id: str, manager: Annotated[JobManager, Depends(get_job_manager)]
) -> JobResponse:
    return manager.get(job_id)


@router.get(
    "/jobs/{job_id}/file",
    responses={code: {"model": ErrorResponse} for code in (404, 409)},
    response_class=FileResponse,
    dependencies=[Depends(require_api_access)],
)
async def get_job_file(
    job_id: str, manager: Annotated[JobManager, Depends(get_job_manager)]
) -> Response:
    path, content_type, filename = manager.get_file(job_id)
    return FileResponse(
        path,
        media_type=content_type,
        filename=filename,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete(
    "/jobs/{job_id}",
    response_model=JobResponse,
    dependencies=[Depends(require_api_access)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 429)},
)
async def cancel_job(
    job_id: str, manager: Annotated[JobManager, Depends(get_job_manager)]
) -> JobResponse:
    return await manager.cancel(job_id)
