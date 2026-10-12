import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

# app.main creates its ASGI app at import time. Set isolated test credentials first.
TEST_API_TOKEN = "test-token-0123456789abcdef0123456789abcdef"
os.environ["MEDIADROP_ENVIRONMENT"] = "test"
os.environ["MEDIADROP_API_TOKEN"] = TEST_API_TOKEN

from app.main import create_app  # noqa: E402 - test token must precede app creation

AUTH_HEADERS = {"Authorization": f"Bearer {TEST_API_TOKEN}"}


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    # Tests must not inherit a developer's .env or exported settings.
    for key in os.environ:
        if key.startswith("MEDIADROP_") or key in {
            "PORT",
            "MAX_FILE_SIZE",
            "MAX_INPUT_BYTES",
            "MAX_OUTPUT_BYTES",
            "MAX_TEMP_WORK_BYTES",
            "DOWNLOAD_TIMEOUT",
            "CONNECT_TIMEOUT",
            "MAX_REDIRECTS",
            "TEMP_FILE_TTL",
            "MAX_ACTIVE_JOBS",
            "MAX_PROCESSING_JOBS",
            "LOG_LEVEL",
        }:
            monkeypatch.delenv(key)
    return Settings(
        _env_file=None,
        environment="test",
        api_token=TEST_API_TOKEN,
        analysis_provider="mock",
        temp_directory=tmp_path / "media",
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), headers=AUTH_HEADERS) as test_client:
        yield test_client
