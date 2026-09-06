import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_placeholder_token() -> None:
    with pytest.raises(ValidationError, match="unique API token"):
        Settings(_env_file=None, environment="production", api_token="change-me")


def test_production_accepts_strong_token() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        api_token="a-production-token-with-at-least-32-characters",
    )
    assert settings.environment == "production"


def test_container_environment_variable_names(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "PORT": "9000",
        "MAX_FILE_SIZE": "123456",
        "DOWNLOAD_TIMEOUT": "240",
        "CONNECT_TIMEOUT": "12",
        "MAX_REDIRECTS": "4",
        "TEMP_FILE_TTL": "7200",
        "MAX_ACTIVE_JOBS": "3",
        "LOG_LEVEL": "WARNING",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    settings = Settings(_env_file=None)

    assert settings.port == 9000
    assert settings.max_file_size == 123456
    assert settings.download_timeout == 240
    assert settings.connect_timeout == 12
    assert settings.max_redirects == 4
    assert settings.temp_file_ttl == 7200
    assert settings.max_active_jobs == 3
    assert settings.log_level == "WARNING"
