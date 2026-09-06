import time
from pathlib import Path
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from app.api.routes import get_analysis_service
from app.core.config import Settings
from app.main import create_app
from app.models.media import DownloadType
from app.providers.direct import DirectMediaProvider
from app.services.analysis import AnalysisService
from app.services.catalog import DirectMediaResource, InMemoryMediaCatalog
from app.services.http import RemoteResponse, SafeHTTPClient
from app.services.jobs import JobManager
from app.services.url_safety import URLSafetyPolicy
from app.storage.local import LocalTemporaryStorage
from tests.conftest import AUTH_HEADERS
from tests.fakes import BlockingResponse, MemoryResponse, QueueTransport


def make_job_app(
    settings: Settings, response: RemoteResponse
) -> tuple[FastAPI, DirectMediaResource]:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    catalog = InMemoryMediaCatalog(60)
    http_client = SafeHTTPClient(
        URLSafetyPolicy(settings, resolver), QueueTransport([response]), settings
    )
    provider = DirectMediaProvider(http_client, catalog)
    storage = LocalTemporaryStorage(settings.temp_directory, settings.temp_file_ttl)
    manager = JobManager(provider, http_client, storage, settings)
    app = create_app(settings)
    app.state.job_manager = manager
    resource = DirectMediaResource(
        id="direct-test",
        url=HttpUrl("https://media.example/file.mp4"),
        format_id="format-original",
        download_type=DownloadType.VIDEO_AUDIO,
        content_type="video/mp4",
        file_name="clip.mp4",
        content_length=12,
        created_at=time.time(),
    )
    catalog.put(resource)
    return app, resource


def create_job(client: TestClient, resource: DirectMediaResource) -> dict[str, object]:
    response = client.post(
        "/jobs",
        json={
            "mediaId": resource.id,
            "downloadType": resource.download_type,
            "formatId": resource.format_id,
        },
    )
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def wait_for_status(client: TestClient, job_id: str, status: str) -> dict[str, object]:
    for _ in range(100):
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        body = cast(dict[str, object], response.json())
        if body["status"] == status:
            return body
        time.sleep(0.01)
    raise AssertionError(f"Job did not reach {status}")


def test_job_created_progresses_and_serves_completed_file(settings: Settings) -> None:
    response = MemoryResponse(
        200,
        {"Content-Type": "video/mp4", "Content-Length": "12"},
        [b"1234", b"5678", b"9012"],
        chunk_delay=0.03,
    )
    app, resource = make_job_app(settings, response)
    with TestClient(app, headers=AUTH_HEADERS) as client:
        created = create_job(client, resource)
        assert created["status"] == "PENDING"
        job_id = cast(str, created["id"])
        partial: dict[str, object] | None = None
        for _ in range(50):
            body = cast(dict[str, object], client.get(f"/jobs/{job_id}").json())
            if body["status"] == "DOWNLOADING" and cast(int, body["bytesDownloaded"]) > 0:
                partial = body
                break
            time.sleep(0.005)
        assert partial is not None
        assert partial["progress"] == 4 / 12
        completed = wait_for_status(client, job_id, "COMPLETED")
        assert completed["progress"] == 1
        assert completed["bytesDownloaded"] == 12
        assert completed["fileSize"] == 12
        assert completed["downloadUrl"] == f"/jobs/{job_id}/file"
        file_response = client.get(completed["downloadUrl"])
        assert file_response.status_code == 200
        assert file_response.content == b"123456789012"
        assert file_response.headers["content-type"] == "video/mp4"
        assert file_response.headers["cache-control"] == "no-store"


def test_active_job_can_be_cancelled_idempotently(settings: Settings) -> None:
    response = BlockingResponse(
        200,
        {"Content-Type": "video/mp4", "Content-Length": "12"},
        [b"1234"],
    )
    app, resource = make_job_app(settings, response)
    with TestClient(app, headers=AUTH_HEADERS) as client:
        created = create_job(client, resource)
        job_id = cast(str, created["id"])
        wait_for_status(client, job_id, "DOWNLOADING")
        cancelled = client.delete(f"/jobs/{job_id}")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "CANCELLED"
        assert client.delete(f"/jobs/{job_id}").json()["status"] == "CANCELLED"
        assert not list(Path(settings.temp_directory).glob("mediadrop-*"))


def test_active_job_limit_rejects_new_work(settings: Settings) -> None:
    limited_settings = settings.model_copy(update={"max_active_jobs": 1})
    response = BlockingResponse(
        200,
        {"Content-Type": "video/mp4", "Content-Length": "12"},
        [b"1234"],
    )
    app, resource = make_job_app(limited_settings, response)
    with TestClient(app, headers=AUTH_HEADERS) as client:
        first = create_job(client, resource)
        job_id = cast(str, first["id"])
        wait_for_status(client, job_id, "DOWNLOADING")
        second = client.post(
            "/jobs",
            json={
                "mediaId": resource.id,
                "downloadType": resource.download_type,
                "formatId": resource.format_id,
            },
        )
        assert second.status_code == 503
        assert second.json()["error"]["code"] == "SERVER_BUSY"
        client.delete(f"/jobs/{job_id}")


def test_remote_error_marks_job_failed_and_removes_partial_file(settings: Settings) -> None:
    app, resource = make_job_app(settings, MemoryResponse(503, {"Content-Type": "text/plain"}))
    with TestClient(app, headers=AUTH_HEADERS) as client:
        created = create_job(client, resource)
        failed = wait_for_status(client, cast(str, created["id"]), "FAILED")
        error = cast(dict[str, object], failed["error"])
        assert error["code"] == "REMOTE_HTTP_ERROR"
        assert not list(Path(settings.temp_directory).glob("mediadrop-*"))


def test_job_rejects_unknown_format(settings: Settings) -> None:
    app, resource = make_job_app(settings, MemoryResponse(200, {"Content-Type": "video/mp4"}))
    with TestClient(app, headers=AUTH_HEADERS) as client:
        response = client.post(
            "/jobs",
            json={
                "mediaId": resource.id,
                "downloadType": "VIDEO_ONLY",
                "formatId": "different",
            },
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_FORMAT"


def test_direct_analyze_to_job_file_flow_without_public_internet(settings: Settings) -> None:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    policy = URLSafetyPolicy(settings, resolver)
    transport = QueueTransport(
        [
            MemoryResponse(
                200,
                {
                    "Content-Type": "video/mp4",
                    "Content-Length": "12",
                    "Content-Disposition": 'attachment; filename="clip.mp4"',
                },
            ),
            MemoryResponse(
                200,
                {"Content-Type": "video/mp4", "Content-Length": "12"},
                [b"123456789012"],
            ),
        ]
    )
    http_client = SafeHTTPClient(policy, transport, settings)
    catalog = InMemoryMediaCatalog(60)
    provider = DirectMediaProvider(http_client, catalog)
    manager = JobManager(
        provider,
        http_client,
        LocalTemporaryStorage(settings.temp_directory, settings.temp_file_ttl),
        settings,
    )
    app = create_app(settings)
    app.dependency_overrides[get_analysis_service] = lambda: AnalysisService(
        provider, policy, settings
    )
    app.state.job_manager = manager

    with TestClient(app, headers=AUTH_HEADERS) as client:
        analysis_response = client.post("/analyze", json={"url": "https://media.example/clip.mp4"})
        assert analysis_response.status_code == 200
        analysis = analysis_response.json()
        assert analysis["source"] == "direct"
        assert analysis["videoFormats"][0]["resolution"] == "Original"
        create_response = client.post(
            "/jobs",
            json={
                "mediaId": analysis["id"],
                "downloadType": "VIDEO_AUDIO",
                "formatId": analysis["videoFormats"][0]["id"],
            },
        )
        assert create_response.status_code == 201
        job_id = create_response.json()["id"]
        completed = wait_for_status(client, job_id, "COMPLETED")
        download_url = completed["downloadUrl"]
        assert isinstance(download_url, str)
        assert client.get(download_url).content == b"123456789012"
