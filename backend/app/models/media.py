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
    format_id: str | None = Field(default=None, min_length=1)
    resolution: str | None = None
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    fps: float | None = Field(default=None, gt=0)
    container: str | None = None
    codec: str | None = None
    bitrate: int | None = Field(default=None, gt=0, description="Bits per second")
    has_audio: bool | None = None
    estimated_size: int | None = Field(default=None, ge=0, description="Bytes")


class AudioFormat(APIModel):
    id: str = Field(min_length=1)
    format_id: str | None = Field(default=None, min_length=1)
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
    provider: Literal["mock", "direct", "youtube"] | None = None
    title: str | None = None
    thumbnail: HttpUrl | InlinePNG | None = None
    duration: float | None = Field(default=None, ge=0, description="Seconds")
    source: str | None
    estimated_size: int | None = Field(default=None, ge=0, description="Bytes")


class DownloadType(StrEnum):
    VIDEO_AUDIO = "VIDEO_AUDIO"
    VIDEO_ONLY = "VIDEO_ONLY"
    AUDIO_ONLY = "AUDIO_ONLY"


class AudioOutputFormat(StrEnum):
    M4A = "M4A"
    MP3 = "MP3"


class DownloadRequest(APIModel):
    media_id: str = Field(min_length=1)
    download_type: DownloadType
    format_id: str = Field(min_length=1)
    audio_format_id: str | None = Field(default=None, min_length=1)
    audio_output_format: AudioOutputFormat | None = None
    audio_bitrate: Literal[128000, 192000, 256000] | None = None


class DownloadSource(BaseModel):
    """Internal-only remote stream selected from a provider-owned capability."""

    role: Literal["media", "video", "audio"]
    source_url: HttpUrl
    content_type: str = Field(min_length=1)
    internal_name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
    expected_size: int | None = Field(default=None, ge=0)
    estimated_size: int | None = Field(default=None, ge=0)
    headers: dict[str, str] = Field(default_factory=dict)


class ProcessingMode(StrEnum):
    DIRECT = "DIRECT"
    STRIP_AUDIO = "STRIP_AUDIO"
    MUX = "MUX"
    AUDIO_M4A = "AUDIO_M4A"
    AUDIO_MP3 = "AUDIO_MP3"


class PreparedDownload(BaseModel):
    """Internal-only plan. Remote stream URLs are never returned by the API."""

    provider: Literal["direct", "youtube"]
    sources: list[DownloadSource] = Field(min_length=1, max_length=2)
    content_type: str
    filename: str
    expected_size: int | None = Field(default=None, ge=0)
    processing: ProcessingMode = ProcessingMode.DIRECT
    duration: float | None = Field(default=None, ge=0)
    audio_bitrate: Literal[128000, 192000, 256000] | None = None

    @property
    def requires_processing(self) -> bool:
        return self.processing != ProcessingMode.DIRECT


class JobStatus(StrEnum):
    PENDING = "PENDING"
    PREPARING = "PREPARING"
    DOWNLOADING = "DOWNLOADING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class JobPhase(StrEnum):
    PREPARING = "PREPARING"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOADING_VIDEO = "DOWNLOADING_VIDEO"
    DOWNLOADING_AUDIO = "DOWNLOADING_AUDIO"
    MUXING = "MUXING"
    CONVERTING = "CONVERTING"
    FINALIZING = "FINALIZING"


class ErrorDetail(APIModel):
    code: str
    message: str


class JobResponse(APIModel):
    id: str
    status: JobStatus
    phase: JobPhase | None = None
    progress: float | None = Field(default=None, ge=0, le=1)
    bytes_downloaded: int = Field(default=0, ge=0)
    total_bytes: int | None = Field(default=None, ge=0)
    file_name: str | None = None
    file_size: int | None = Field(default=None, ge=0)
    error: ErrorDetail | None = None
    download_url: str | None = None
    message: str | None = None


class HealthResponse(APIModel):
    status: Literal["ok"] = "ok"
    service: str


class ErrorResponse(APIModel):
    error: ErrorDetail
