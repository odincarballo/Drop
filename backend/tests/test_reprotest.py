import asyncio
import hashlib
import shutil

import httpx2
import pytest

from app.core.config import Settings
from app.reprotest import serve
from app.reprotest.fixtures import FIXTURE_DIRECTORY, generate_large_fixture
from tests.conftest import AUTH_HEADERS, TEST_API_TOKEN

SMALL = (
    "c4-synthetic.m4a",
    2_440_018,
    "76c73ce767d3cfa93778ccbd70fc250d1c5568a57ca3229f96de07a4be8ccaf6",
)
LARGE = (
    "c4-performance-99mib.m4a",
    99 * 1024**2,
    "250bba1a0ff2f113e94a73d189a3eae16887d620406a0815ca7870419652cdb2",
)


def config(tmp_path):
    return Settings(
        _env_file=None,
        environment="production",
        analysis_provider="direct",
        api_token=TEST_API_TOKEN,
        temp_directory=tmp_path / "jobs",
        rate_limit_requests=10,
        temp_file_ttl=30,
    )


async def prepare(client, name):
    analyzed = await client.post("/analyze", json={"url": f"https://media.example.net/{name}"})
    assert analyzed.status_code == 200, analyzed.text
    media = analyzed.json()
    response = await client.post(
        "/jobs",
        json={
            "mediaId": media["id"],
            "downloadType": "AUDIO_ONLY",
            "formatId": media["audioFormats"][0]["id"],
        },
    )
    assert response.status_code == 201, response.text
    path = f"/jobs/{response.json()['id']}"
    async with asyncio.timeout(10):
        while True:
            response = await client.get(path)
            assert response.status_code == 200, response.text
            job = response.json()
            if job["status"] == "COMPLETED":
                return path, job
            assert job["status"] != "FAILED", job
            await asyncio.sleep(0.1)


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory):
    directory = tmp_path_factory.mktemp("reprotest-fixtures")
    shutil.copyfile(FIXTURE_DIRECTORY / SMALL[0], directory / SMALL[0])
    generate_large_fixture(directory)
    return directory


@pytest.fixture
def recorded_delays(monkeypatch):
    delays = []
    sleep = asyncio.sleep

    async def watch(seconds):
        if seconds == 3:
            delays.append(seconds)
        else:
            await sleep(seconds)

    monkeypatch.setattr(serve.asyncio, "sleep", watch)
    return delays


def test_performance_serves_both_complete_fixtures(tmp_path, fixtures, recorded_delays):
    async def run():
        app = serve.create_reprotest(config(tmp_path), fixture_directory=fixtures, performance=True)
        settings = app.app.app.app.state.settings
        assert settings.max_active_jobs == 1
        assert settings.rate_limit_requests == 180 and settings.rate_limit_window_seconds == 60
        assert settings.temp_file_ttl >= 900

        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://reprotest"
        ) as client:
            assert (await client.get("/ready")).status_code == 200
            assert (
                await client.post(
                    "/analyze",
                    json={
                        "url": f"https://media.example.net/{LARGE[0]}",
                    },
                )
            ).status_code == 401
            client.headers.update(AUTH_HEADERS)
            outside = await client.post("/analyze", json={"url": "https://example.org/outside.m4a"})
            assert outside.status_code == 400 and outside.json()["error"]["code"] == "FIXTURE_ONLY"

            for name, size, expected in (SMALL, LARGE):
                path, job = await prepare(client, name)
                assert job["fileSize"] == size
                assert job["fileSha256"] == expected
                assert job["fileContentType"] == "audio/mp4"
                etag = f'"sha256-{expected}"'
                sha256 = hashlib.sha256()
                window = 1024**2
                async with asyncio.timeout(15):
                    for offset in range(0, size, window):
                        end = min(offset + window, size) - 1
                        response = await client.get(
                            path + "/file",
                            headers={
                                "Range": f"bytes={offset}-{end}",
                                "If-Range": etag,
                                "Accept-Encoding": "identity",
                            },
                        )
                        assert response.status_code == 206
                        assert response.headers["etag"] == etag
                        assert response.headers["content-range"] == f"bytes {offset}-{end}/{size}"
                        assert (
                            int(response.headers["content-length"])
                            == len(response.content)
                            == end - offset + 1
                        )
                        sha256.update(response.content)
                assert sha256.hexdigest() == expected
                job_manager = app.app.app.app.state.job_manager
                job_manager._jobs[path.rsplit("/", 1)[-1]].finished_at -= settings.temp_file_ttl
                expired = await client.get(path + "/file")
                assert expired.status_code == 404
                assert expired.json()["error"]["code"] == "FILE_EXPIRED"
                assert (await client.delete(path)).status_code == 200
        assert recorded_delays == []

    asyncio.run(run())


def test_normal_mode_preserves_legacy_and_range_delay(tmp_path, fixtures, recorded_delays):
    async def run():
        app = serve.create_reprotest(config(tmp_path), fixture_directory=fixtures)
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app),
            base_url="http://reprotest",
            headers=AUTH_HEADERS,
        ) as client:
            path, job = await prepare(client, "c4-legacy.m4a")
            assert "fileSha256" not in job and "fileContentType" not in job
            response = await client.get(path + "/file")
            assert response.status_code == 200
            assert len(response.content) == SMALL[1]
            assert hashlib.sha256(response.content).hexdigest() == SMALL[2]
            assert recorded_delays == []
            ranged = await client.get(
                path + "/file",
                headers={
                    "Range": "bytes=0-3",
                    "If-Range": response.headers["etag"],
                },
            )
            assert ranged.status_code == 206
            assert recorded_delays == [3]

    asyncio.run(run())


def test_fixture_rejects_wrong_hash(tmp_path):
    (tmp_path / SMALL[0]).write_bytes(bytes(SMALL[1]))
    with pytest.raises(ValueError, match="Unexpected reprotest fixture"):
        serve.create_reprotest(config(tmp_path), fixture_directory=tmp_path)
