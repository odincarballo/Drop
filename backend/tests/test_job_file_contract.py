import asyncio
import hashlib
import os
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from threading import Event
from time import time
from types import SimpleNamespace
from typing import cast

import httpx2
import pytest
import starlette
import uvicorn
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.services import jobs
from app.services.jobs import FILE_BLOCK_BYTES, JobFileRead, JobManager
from tests.conftest import AUTH_HEADERS
from tests.fakes import MemoryResponse
from tests.test_jobs import make_job_app

FIRST = b"123456789012"
SECOND = b"ABCDEFGHIJKL"


def validator(body: bytes) -> str:
    return f'"sha256-{hashlib.sha256(body).hexdigest()}"'


@asynccontextmanager
async def local_server(app: ASGIApp) -> AsyncIterator[httpx2.AsyncClient]:
    assert starlette.__version__ == "1.6.0"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(app, log_level="critical", access_log=False, lifespan="on")
        )
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(5):
                while not server.started:
                    if task.done():
                        task.result()
                        raise RuntimeError("Local test server did not start")
                    await asyncio.sleep(0.01)
            async with httpx2.AsyncClient(
                base_url=f"http://127.0.0.1:{port}", headers=AUTH_HEADERS, trust_env=False
            ) as client:
                yield client
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, timeout=5)


def build_app(settings: Settings, data: bytes = FIRST) -> tuple[ASGIApp, JobManager]:
    app, _ = make_job_app(
        settings,
        MemoryResponse(
            200, {"Content-Type": "video/mp4", "Content-Length": str(len(data))}, [data]
        ),
        content_length=len(data),
    )
    return app, cast(JobManager, app.state.job_manager)


async def completed_job(client: httpx2.AsyncClient) -> str:
    response = await client.post(
        "/jobs",
        json={
            "mediaId": "direct-test",
            "downloadType": "VIDEO_AUDIO",
            "formatId": "format-original",
        },
    )
    assert response.status_code == 201
    job_id = cast(str, response.json()["id"])
    async with asyncio.timeout(5):
        while True:
            status = await client.get(f"/jobs/{job_id}")
            assert status.status_code == 200
            if status.json()["status"] == "COMPLETED":
                return job_id
            assert status.json()["status"] != "FAILED"
            await asyncio.sleep(0.01)


async def test_full_and_partial_contract(settings: Settings) -> None:
    app, _ = build_app(settings)
    async with local_server(app) as client:
        job = await completed_job(client)
        metadata = (await client.get(f"/jobs/{job}")).json()
        path = f"/jobs/{job}/file"
        assert metadata["downloadUrl"] == path
        assert metadata["fileName"] == "clip.mp4"
        assert metadata["fileSize"] == len(FIRST)
        assert metadata["fileSha256"] == hashlib.sha256(FIRST).hexdigest()
        assert metadata["fileContentType"] == "video/mp4"
        unauthorized = client.build_request("GET", path)
        del unauthorized.headers["Authorization"]
        assert (await client.send(unauthorized)).status_code == 401
        whole = await client.get(path)
        assert whole.status_code == 200
        assert whole.content == FIRST
        assert whole.headers["content-length"] == str(len(FIRST))
        assert whole.headers["content-type"] == "video/mp4"
        assert whole.headers["content-disposition"] == 'attachment; filename="clip.mp4"'
        assert whole.headers["cache-control"] == "no-store"
        assert whole.headers["accept-ranges"] == "bytes"
        assert whole.headers["etag"] == validator(FIRST)
        part = await client.get(
            path, headers={"Range": "bytes=4-", "If-Range": whole.headers["etag"]}
        )
        assert part.status_code == 206
        assert part.headers["content-range"] == "bytes 4-11/12"
        assert part.headers["content-length"] == "8"
        assert part.headers["etag"] == validator(FIRST)
        assert part.headers.get("content-encoding", "identity") == "identity"
        assert FIRST[:4] + part.content == whole.content
        by_date = await client.get(
            path, headers={"Range": "bytes=4-", "If-Range": whole.headers["last-modified"]}
        )
        assert by_date.status_code == 200
        assert by_date.content == FIRST


@pytest.mark.parametrize("if_range", [validator(FIRST), f"W/{validator(SECOND)}"])
async def test_different_same_size_file_and_weak_tag_return_full_body(
    settings: Settings, if_range: str
) -> None:
    app, _ = build_app(settings, SECOND)
    async with local_server(app) as client:
        job = await completed_job(client)
        changed = await client.get(
            f"/jobs/{job}/file", headers={"Range": "bytes=4-", "If-Range": if_range}
        )
        assert changed.status_code == 200
        assert changed.content == SECOND
        assert "content-range" not in changed.headers
        assert changed.headers["etag"] == validator(SECOND)
        assert changed.headers["etag"] != validator(FIRST)


@pytest.mark.parametrize(
    ("header", "status"),
    [
        ("bytes=garbage", 400),
        ("bytes=+0-1", 400),
        ("bytes=0-1,garbage", 400),
        ("bytes=5-2", 400),
        ("bytes=12-", 416),
    ],
)
async def test_invalid_ranges(settings: Settings, header: str, status: int) -> None:
    app, _ = build_app(settings)
    async with local_server(app) as client:
        job = await completed_job(client)
        result = await client.get(f"/jobs/{job}/file", headers={"Range": header})
        assert result.status_code == status
        if status == 416:
            assert result.headers["content-range"] == "bytes */12"


async def test_suffix_and_multipart_ranges_remain_available(settings: Settings) -> None:
    app, _ = build_app(settings)
    async with local_server(app) as client:
        path = f"/jobs/{await completed_job(client)}/file"
        suffix = await client.get(path, headers={"Range": "BYTES=-2"})
        assert suffix.status_code == 206
        assert suffix.content == FIRST[-2:]
        multipart = await client.get(path, headers={"Range": "bytes=1-2, -2"})
        assert multipart.status_code == 206
        assert multipart.headers["content-type"].startswith("multipart/byteranges; boundary=")
        assert multipart.headers["etag"] == validator(FIRST)
        assert int(multipart.headers["content-length"]) == len(multipart.content)
        assert b"Content-Range: bytes 1-2/12\r\n\r\n23\r\n" in multipart.content
        assert b"Content-Range: bytes 10-11/12\r\n\r\n12\r\n" in multipart.content
        large_offset = "9" * 5000
        outside = await client.get(path, headers={"Range": f"bytes={large_offset}-"})
        assert outside.status_code == 416
        large_end = await client.get(path, headers={"Range": f"bytes=9-{large_offset}"})
        assert large_end.status_code == 206
        assert large_end.content == FIRST[9:]


async def test_response_never_reopens_replaced_path(settings: Settings) -> None:
    app, _ = build_app(settings)

    async def gated(scope: Scope, receive: Receive, send: Send) -> None:
        async def replace_at_headers(message: Message) -> None:
            if (
                scope["type"] == "http"
                and scope["path"].endswith("/file")
                and message["type"] == "http.response.start"
            ):
                path = next(settings.temp_directory.glob("mediadrop-*/clip.mp4"))
                replacement = path.with_suffix(".swap")
                replacement.write_bytes(SECOND)
                replacement.replace(path)
            await send(message)

        await app(scope, receive, replace_at_headers)

    async with local_server(gated) as client:
        job = await completed_job(client)
        response = await client.get(
            f"/jobs/{job}/file", headers={"Range": "bytes=4-", "If-Range": validator(FIRST)}
        )
        assert response.status_code == 206
        assert response.headers["etag"] == validator(FIRST)
        assert response.content == FIRST[4:]


@pytest.mark.parametrize("action", ["overwrite", "truncate"])
async def test_in_place_change_aborts_before_sending_unverified_bytes(
    settings: Settings, action: str
) -> None:
    body = b"a" * FILE_BLOCK_BYTES + b"b" * FILE_BLOCK_BYTES
    app, _ = build_app(settings, body)
    sent = bytearray()

    async def gated(scope: Scope, receive: Receive, send: Send) -> None:
        async def mutate_after_first_chunk(message: Message) -> None:
            if (
                scope["type"] == "http"
                and scope["path"].endswith("/file")
                and message["type"] == "http.response.body"
            ):
                if not sent and message.get("body"):
                    path = next(settings.temp_directory.glob("mediadrop-*/clip.mp4"))
                    with path.open("r+b") as source:
                        if action == "overwrite":
                            source.seek(FILE_BLOCK_BYTES)
                            source.write(b"x" * FILE_BLOCK_BYTES)
                        else:
                            source.truncate(FILE_BLOCK_BYTES)
                sent.extend(message.get("body", b""))
            await send(message)

        await app(scope, receive, mutate_after_first_chunk)

    async with local_server(gated) as client:
        job = await completed_job(client)
        path = f"/jobs/{job}/file"
        workspace = next(settings.temp_directory.glob("mediadrop-*"))
        with pytest.raises(httpx2.RemoteProtocolError):
            await client.get(path, headers={"Range": "bytes=0-", "If-Range": validator(body)})
        assert sent == body[:FILE_BLOCK_BYTES]
        assert (await client.delete(f"/jobs/{job}")).json()["status"] == "CANCELLED"
        assert not workspace.exists()


async def test_same_job_rejects_changed_file(settings: Settings) -> None:
    app, _ = build_app(settings)
    async with local_server(app) as client:
        job = await completed_job(client)
        path = next(settings.temp_directory.glob("mediadrop-*/clip.mp4"))
        stat = path.stat()
        path.write_bytes(SECOND)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        result = await client.get(f"/jobs/{job}/file", headers={"Range": "bytes=4-"})
        assert result.status_code == 404
        assert result.json()["error"]["code"] == "FILE_EXPIRED"


async def test_request_cancellation_releases_lease_while_worker_owns_its_descriptor(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _ = build_app(settings)
    loop = asyncio.get_running_loop()
    worker_started: asyncio.Future[tuple[JobFileRead, int]] = loop.create_future()
    worker_finished = asyncio.Event()
    release = Event()
    original = JobFileRead._read_verified

    def gated(reader: JobFileRead, fd: int, index: int) -> bytes:
        loop.call_soon_threadsafe(worker_started.set_result, (reader, fd))
        try:
            if not release.wait(5):
                os.close(fd)
                raise TimeoutError("Test never released the read worker")
            return original(reader, fd, index)
        finally:
            loop.call_soon_threadsafe(worker_finished.set)

    monkeypatch.setattr(JobFileRead, "_read_verified", gated)
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app),
        base_url="http://testserver",
        headers=AUTH_HEADERS,
    ) as client:
        job = await completed_job(client)
        workspace = next(settings.temp_directory.glob("mediadrop-*"))
        request = asyncio.create_task(client.get(f"/jobs/{job}/file"))
        try:
            reader, fd = await asyncio.wait_for(worker_started, timeout=5)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):
                await request
            assert reader.source.closed
            assert os.fstat(fd).st_size == len(FIRST)
            assert (await client.delete(f"/jobs/{job}")).json()["status"] == "CANCELLED"
            assert not workspace.exists()
        finally:
            release.set()
            await asyncio.wait_for(worker_finished.wait(), timeout=5)
        with pytest.raises(OSError):
            os.fstat(fd)


@pytest.mark.parametrize("end", ["expire", "cancel", "send_error"])
async def test_cleanup_respects_active_response(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, end: str
) -> None:
    app, manager = build_app(settings)
    now = time()
    clock = SimpleNamespace(time=lambda: now)
    monkeypatch.setattr(jobs, "time", clock)
    serving = asyncio.Event()
    release = asyncio.Event()
    response_finished = asyncio.Event()

    async def gated(scope: Scope, receive: Receive, send: Send) -> None:
        held = False

        async def send_with_gate(message: Message) -> None:
            nonlocal held
            if (
                scope["type"] == "http"
                and scope["path"].endswith("/file")
                and message["type"] == "http.response.start"
                and message["status"] == 206
                and not serving.is_set()
            ):
                held = True
                serving.set()
                await release.wait()
                if end == "send_error":
                    raise OSError("simulated client disconnect")
            await send(message)

        try:
            await app(scope, receive, send_with_gate)
        finally:
            if held:
                response_finished.set()

    async with local_server(gated) as client:
        job = await completed_job(client)
        file_path = f"/jobs/{job}/file"
        workspace: Path = next(settings.temp_directory.glob("mediadrop-*"))
        os.utime(workspace, (0, 0))
        request = asyncio.create_task(client.get(file_path, headers={"Range": "bytes=4-"}))
        try:
            await asyncio.wait_for(serving.wait(), timeout=5)
            if end == "cancel":
                assert (await client.delete(f"/jobs/{job}")).json()["status"] == "CANCELLED"
                assert (await client.get(file_path)).status_code == 409
            else:
                now += settings.temp_file_ttl + 1
                expired = await client.get(file_path)
                assert expired.status_code == 404
                assert expired.json()["error"]["code"] == "FILE_EXPIRED"
            assert manager.cleanup_expired() == 0
            assert manager.storage.cleanup_expired() == 0
            assert await asyncio.to_thread(workspace.is_dir)
            release.set()
            if end == "send_error":
                assert (await request).status_code == 500
            else:
                result = await request
                assert result.status_code == 206
                assert result.content == FIRST[4:]
            await asyncio.wait_for(response_finished.wait(), timeout=5)
            manager.cleanup_expired()
            assert not await asyncio.to_thread(workspace.exists)
            if end != "cancel":
                gone = await client.get(file_path)
                assert gone.status_code == 404
                assert gone.json()["error"]["code"] == "JOB_NOT_FOUND"
        finally:
            release.set()
            with suppress(httpx2.HTTPError):
                await request
