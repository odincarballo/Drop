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
        "MAX_INPUT_BYTES": "223456",
        "MAX_OUTPUT_BYTES": "323456",
        "MAX_TEMP_WORK_BYTES": "623456",
        "DOWNLOAD_TIMEOUT": "240",
        "CONNECT_TIMEOUT": "12",
        "MAX_REDIRECTS": "4",
        "TEMP_FILE_TTL": "7200",
        "MAX_ACTIVE_JOBS": "3",
        "MAX_PROCESSING_JOBS": "1",
        "LOG_LEVEL": "WARNING",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    settings = Settings(_env_file=None)

    assert settings.port == 9000
    assert settings.max_file_size == 123456
    assert settings.max_input_bytes == 223456
    assert settings.max_output_bytes == 323456
    assert settings.max_temp_work_bytes == 623456
    assert settings.download_timeout == 240
    assert settings.connect_timeout == 12
    assert settings.max_redirects == 4
    assert settings.temp_file_ttl == 7200
    assert settings.max_active_jobs == 3
    assert settings.max_processing_jobs == 1
    assert settings.log_level == "WARNING"


def test_temp_work_limit_must_cover_input_and_output() -> None:
    with pytest.raises(ValidationError, match="MAX_TEMP_WORK_BYTES"):
        Settings(
            _env_file=None,
            max_input_bytes=100,
            max_output_bytes=100,
            max_temp_work_bytes=199,
        )
