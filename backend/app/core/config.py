from pathlib import Path
from tempfile import gettempdir
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MEDIADROP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
        allow_inf_nan=False,
        populate_by_name=True,
    )

    app_name: str = "MediaDrop"
    environment: Literal["development", "test", "production"] = "development"
    port: int = Field(
        default=8000,
        ge=1,
        le=65535,
        validation_alias=AliasChoices("PORT", "MEDIADROP_PORT"),
    )
    api_token: SecretStr = Field(default=SecretStr("change-me"), min_length=8, max_length=512)
    analysis_provider: str = Field(default="auto", pattern=r"^(auto|direct|mock)$")
    analysis_timeout_seconds: float = Field(default=10, gt=0)
    max_file_size: int = Field(
        default=100 * 1024 * 1024,
        gt=0,
        validation_alias=AliasChoices("MAX_FILE_SIZE", "MEDIADROP_MAX_FILE_SIZE"),
    )
    max_input_bytes: int = Field(
        default=100 * 1024 * 1024,
        gt=0,
        validation_alias=AliasChoices("MAX_INPUT_BYTES", "MEDIADROP_MAX_INPUT_BYTES"),
    )
    max_output_bytes: int = Field(
        default=100 * 1024 * 1024,
        gt=0,
        validation_alias=AliasChoices("MAX_OUTPUT_BYTES", "MEDIADROP_MAX_OUTPUT_BYTES"),
    )
    max_temp_work_bytes: int = Field(
        default=220 * 1024 * 1024,
        gt=0,
        validation_alias=AliasChoices("MAX_TEMP_WORK_BYTES", "MEDIADROP_MAX_TEMP_WORK_BYTES"),
    )
    download_timeout: float = Field(
        default=120,
        gt=0,
        validation_alias=AliasChoices("DOWNLOAD_TIMEOUT", "MEDIADROP_DOWNLOAD_TIMEOUT"),
    )
    connect_timeout: float = Field(
        default=10,
        gt=0,
        validation_alias=AliasChoices("CONNECT_TIMEOUT", "MEDIADROP_CONNECT_TIMEOUT"),
    )
    max_redirects: int = Field(
        default=3,
        ge=0,
        le=10,
        validation_alias=AliasChoices("MAX_REDIRECTS", "MEDIADROP_MAX_REDIRECTS"),
    )
    max_media_duration_seconds: float = Field(default=600, gt=0)
    max_url_length: int = Field(default=2048, ge=64, le=8192)
    temp_directory: Path = Path(gettempdir()) / "mediadrop"
    temp_file_ttl: int = Field(
        default=3600,
        gt=0,
        validation_alias=AliasChoices("TEMP_FILE_TTL", "MEDIADROP_TEMP_FILE_TTL"),
    )
    temp_cleanup_interval_seconds: float = Field(default=60, gt=0)
    max_active_jobs: int = Field(
        default=2,
        ge=1,
        le=32,
        validation_alias=AliasChoices("MAX_ACTIVE_JOBS", "MEDIADROP_MAX_ACTIVE_JOBS"),
    )
    max_processing_jobs: int = Field(
        default=1,
        ge=1,
        le=4,
        validation_alias=AliasChoices("MAX_PROCESSING_JOBS", "MEDIADROP_MAX_PROCESSING_JOBS"),
    )
    media_processing_timeout_seconds: float = Field(default=300, gt=0, le=3600)
    ffmpeg_path: str = Field(default="ffmpeg", min_length=1, max_length=512)
    ffprobe_path: str = Field(default="ffprobe", min_length=1, max_length=512)
    youtube_socket_timeout_seconds: float = Field(default=10, gt=0, le=60)
    youtube_retries: int = Field(default=1, ge=0, le=5)
    rate_limit_requests: int = Field(default=180, ge=1, le=10_000)
    rate_limit_window_seconds: float = Field(default=60, gt=0, le=3600)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        validation_alias=AliasChoices("LOG_LEVEL", "MEDIADROP_LOG_LEVEL"),
    )

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        token = self.api_token.get_secret_value()
        if token != token.strip():
            raise ValueError("MEDIADROP_API_TOKEN must not contain surrounding whitespace")
        if self.environment == "production" and (token == "change-me" or len(token) < 32):
            raise ValueError("Production requires a unique API token of at least 32 characters")
        if self.max_temp_work_bytes < self.max_input_bytes + self.max_output_bytes:
            raise ValueError("MAX_TEMP_WORK_BYTES must cover MAX_INPUT_BYTES plus MAX_OUTPUT_BYTES")
        return self
