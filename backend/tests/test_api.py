import socket
from typing import Never

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.media import MediaAnalysis
from tests.conftest import AUTH_HEADERS


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "MediaDrop"}


def test_health_does_not_require_authentication(settings: Settings) -> None:
    with TestClient(create_app(settings)) as unauthenticated_client:
        response = unauthenticated_client.get("/health")
    assert response.status_code == 200


def test_protected_route_rejects_missing_token(settings: Settings) -> None:
    with TestClient(create_app(settings)) as unauthenticated_client:
        response = unauthenticated_client.post(
            "/analyze", json={"url": "https://example.com/video.mp4"}
        )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_protected_route_rejects_incorrect_token(settings: Settings) -> None:
    with TestClient(
        create_app(settings), headers={"Authorization": "Bearer definitely-not-the-token"}
    ) as unauthenticated_client:
        response = unauthenticated_client.post(
            "/analyze", json={"url": "https://example.com/video.mp4"}
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_INVALID"


def test_protected_route_rejects_example_token(settings: Settings) -> None:
    with TestClient(
        create_app(settings), headers={"Authorization": "Bearer change-me"}
    ) as unauthenticated_client:
        response = unauthenticated_client.post(
            "/analyze", json={"url": "https://example.com/video.mp4"}
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_INVALID"


def test_protected_route_accepts_correct_token(settings: Settings) -> None:
    with TestClient(create_app(settings), headers=AUTH_HEADERS) as authenticated_client:
        response = authenticated_client.post(
            "/analyze", json={"url": "https://example.com/video.mp4"}
        )
    assert response.status_code == 200


def test_rate_limit_is_enforced_for_protected_routes(settings: Settings) -> None:
    limited_settings = settings.model_copy(
        update={"rate_limit_requests": 1, "rate_limit_window_seconds": 60}
    )
    with TestClient(create_app(limited_settings), headers=AUTH_HEADERS) as limited_client:
        assert (
            limited_client.post(
                "/analyze", json={"url": "https://example.com/video.mp4"}
            ).status_code
            == 200
        )
        response = limited_client.post("/analyze", json={"url": "https://example.com/video.mp4"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


@pytest.mark.parametrize(
    "url", ["not-a-url", "", "ftp://example.com/video.mp4", "file:///etc/passwd"]
)
def test_invalid_url(client: TestClient, url: str) -> None:
    response = client.post("/analyze", json={"url": url})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/video",
        "http://localhost./video",
        "http://foo.localhost/video",
        "http://127.0.0.1/video",
        "http://127.99.1.2/video",
        "http://127.1/video",
        "http://2130706433/video",
        "http://0x7f000001/video",
        "http://0177.0.0.1/video",
        "http://0.0.0.0/video",
        "http://10.1.2.3/video",
        "http://172.16.0.1/video",
        "http://192.168.1.2/video",
        "http://169.254.169.254/latest/meta-data",
        "http://100.64.0.1/video",
        "http://224.0.0.1/video",
        "http://[::1]/video",
        "http://[fc00::1]/video",
        "http://[fe80::1]/video",
        "http://[::ffff:127.0.0.1]/video",
        "http://[64:ff9b::7f00:1]/video",
        "http://printer.local/video",
        "http://intranet/video",
        "https://example.com:8080/video",
        "https://user:secret@example.com/video",
    ],
)
def test_unsafe_url(client: TestClient, url: str) -> None:
    response = client.post("/analyze", json={"url": url})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "UNSAFE_URL"
    assert "secret" not in response.text


def test_successful_analysis(client: TestClient) -> None:
    response = client.post("/analyze", json={"url": "https://example.com/video.mp4"})
    assert response.status_code == 200
    body = response.json()
    analysis = MediaAnalysis.model_validate(body)
    assert analysis.source == "mock"
    assert analysis.title == "MediaDrop Demo Video"
    assert analysis.duration == 154
    assert body["thumbnail"].startswith("data:image/png;base64,")
    assert len(body["videoFormats"]) == 3
    assert len(body["audioFormats"]) == 2
    assert body["videoFormats"][2]["hasAudio"] is True
    assert body["audioFormats"][0]["bitrate"] == 128_000
    assert body["estimatedSize"] == 60_000_000
    assert "video_formats" not in body


def test_invalid_body_and_malformed_json(client: TestClient) -> None:
    assert client.post("/analyze", json={}).status_code == 422
    response = client.post("/analyze", content="{", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_long_url(client: TestClient) -> None:
    response = client.post("/analyze", json={"url": "https://example.com/" + "a" * 2030})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "URL_TOO_LONG"


def test_no_download_endpoint(client: TestClient) -> None:
    response = client.post("/download", json={})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "HTTP_ERROR"


def test_mock_analysis_never_resolves_the_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def forbid_dns(*args: object, **kwargs: object) -> Never:
        raise AssertionError("Mock analysis must not resolve DNS")

    monkeypatch.setattr(socket, "getaddrinfo", forbid_dns)
    response = client.post("/analyze", json={"url": "https://offline.example.com/video.mp4"})
    assert response.status_code == 200
    assert response.json()["source"] == "mock"
