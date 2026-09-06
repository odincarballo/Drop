from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints
from pydantic.alias_generators import to_camel


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", allow_inf_nan=False
    )


class AnalyzeRequest(APIModel):
    url: HttpUrl


class VideoFormat(APIModel):
    id: str = Field(min_length=1)
    resolution: str | None = None
    container: str | None = None
    codec: str | None = None
    has_audio: bool | None = None
    estimated_size: int | None = Field(default=None, ge=0, description="Bytes")


class AudioFormat(APIModel):
    id: str = Field(min_length=1)
    container: str | None = None
    codec: str | None = None
    bitrate: int | None = Field(default=None, gt=0, description="Bits per second")
    estimated_size: int | None = Field(default=None, ge=0, description="Bytes")


class AvailableStreams(APIModel):
    video_formats: list[VideoFormat] = Field(default_factory=list)
    audio_formats: list[AudioFormat] = Field(default_factory=list)


type InlinePNG = Annotated[
    str,
    StringConstraints(pattern=r"^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$", max_length=131072),
]


class MediaAnalysis(AvailableStreams):
    id: str
    title: str | None = None
    thumbnail: HttpUrl | InlinePNG | None = None
    duration: float | None = Field(default=None, ge=0, description="Seconds")
    source: str | None
    estimated_size: int | None = Field(default=None, ge=0, description="Bytes")


class DownloadType(StrEnum):
    VIDEO_AUDIO = "VIDEO_AUDIO"
    VIDEO_ONLY = "VIDEO_ONLY"
    AUDIO_ONLY = "AUDIO_ONLY"


class DownloadRequest(APIModel):
    media_id: str = Field(min_length=1)
    download_type: DownloadType
    format_id: str = Field(min_length=1)


class PreparedDownload(BaseModel):
    """Internal-only provider capability. The source URL is never returned by the API."""

    source_url: HttpUrl
    content_type: str
    filename: str
    expected_size: int | None = Field(default=None, ge=0)


class JobStatus(StrEnum):
    PENDING = "PENDING"
    DOWNLOADING = "DOWNLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ErrorDetail(APIModel):
    code: str
    message: str


class JobResponse(APIModel):
    id: str
    status: JobStatus
    progress: float | None = Field(default=None, ge=0, le=1)
    bytes_downloaded: int = Field(default=0, ge=0)
    total_bytes: int | None = Field(default=None, ge=0)
    file_name: str | None = None
    file_size: int | None = Field(default=None, ge=0)
    error: ErrorDetail | None = None
    download_url: str | None = None


class HealthResponse(APIModel):
    status: Literal["ok"] = "ok"
    service: str


class ErrorResponse(APIModel):
    error: ErrorDetail
