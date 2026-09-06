from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

TEST_API_TOKEN = "test-token-0123456789abcdef0123456789abcdef"
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_API_TOKEN}"}


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    # Tests must not inherit a developer's .env or exported settings.
    import os

    for key in os.environ:
        if key.startswith("MEDIADROP_") or key in {
            "PORT",
            "MAX_FILE_SIZE",
            "DOWNLOAD_TIMEOUT",
            "CONNECT_TIMEOUT",
            "MAX_REDIRECTS",
            "TEMP_FILE_TTL",
            "MAX_ACTIVE_JOBS",
            "LOG_LEVEL",
        }:
            monkeypatch.delenv(key)
    return Settings(
        _env_file=None,
        api_token=TEST_API_TOKEN,
        analysis_provider="mock",
        temp_directory=tmp_path / "media",
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), headers=AUTH_HEADERS) as test_client:
        yield test_client
