"""Expose C.1 over the reprotest service with synthetic fixtures only."""

import asyncio
import hmac
import json
import os
import re
from pathlib import Path

import uvicorn
from starlette.responses import JSONResponse

from app.core.config import Settings
from app.main import create_app
from app.reprotest.fixtures import FIXTURE_DIRECTORY, LARGE, LEGACY_NAME, SMALL
from app.reprotest.legacy_job_response import LegacySyntheticJobResponse
from app.reprotest.range_audit import RangeAudit
from app.services.analysis import AnalysisService
from app.services.http import SafeHTTPClient
from app.services.url_safety import URLSafetyPolicy

FIXTURE_ORIGIN = "https://media.example.net"
FIXTURE_URLS = {f"{FIXTURE_ORIGIN}/{name}" for name in (SMALL.name, LARGE.name, LEGACY_NAME)}
PERFORMANCE_RATE_LIMIT = 180
PERFORMANCE_WINDOW_SECONDS = 60
PERFORMANCE_MIN_TTL_SECONDS = 900
ALLOWED = re.compile(
    r"GET /health|POST /(?:analyze|jobs)|(?:GET|DELETE) /jobs/[a-f0-9]{32}"
    r"|GET /jobs/[a-f0-9]{32}/file"
)
NO_STORE = {"Cache-Control": "private, no-store"}


class FixtureResponse:
    status = 200

    def __init__(self, path: Path, size: int, *, include_body: bool):
        self.headers = {"Content-Type": "audio/mp4", "Content-Length": str(size)}
        self.source = path.open("rb") if include_body else None

    async def iter_bytes(self, chunk_size: int):
        if self.source is not None:
            while chunk := self.source.read(chunk_size):
                yield chunk

    async def read_prefix(self, maximum: int) -> bytes:
        return self.source.read(maximum) if self.source is not None else b""

    async def close(self) -> None:
        if self.source is not None:
            self.source.close()


class FixtureTransport:
    def __init__(self, directory: Path):
        small = SMALL.verify(directory)
        large = LARGE.verify(directory)
        self.files = {
            f"{FIXTURE_ORIGIN}/{SMALL.name}": (small, SMALL.size),
            f"{FIXTURE_ORIGIN}/{LEGACY_NAME}": (small, SMALL.size),
            f"{FIXTURE_ORIGIN}/{LARGE.name}": (large, LARGE.size),
        }

    async def open(self, method, destination, headers):
        fixture = self.files.get(str(destination.url))
        if method not in {"GET", "HEAD"} or fixture is None:
            raise OSError("Destination outside reprotest fixtures")
        return FixtureResponse(*fixture, include_body=method == "GET")


async def fixture_dns(host, port):
    if (host, port) != ("media.example.net", 443):
        raise OSError("Destination outside reprotest fixtures")
    # SafeHTTPClient validates this address. FixtureTransport performs no network I/O.
    return ("93.184.216.34",)


def error(status, code, message):
    return JSONResponse(
        {"error": {"code": code, "message": message}}, status_code=status, headers=NO_STORE
    )


class ReprotestGate:
    def __init__(self, app, token, *, performance: bool):
        self.app = app
        self.performance = performance
        self.authorization = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        method, path = scope["method"], scope["path"]
        if method == "GET" and path == "/ready" and not scope["query_string"]:
            return await JSONResponse({"ready": True}, headers=NO_STORE)(scope, receive, send)
        if scope["query_string"] or not ALLOWED.fullmatch(f"{method} {path}"):
            response = error(404, "NOT_FOUND", "Ruta fuera de reprotest.")
            return await response(scope, receive, send)

        authorization = [value for name, value in scope["headers"] if name == b"authorization"]
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0], self.authorization):
            response = error(401, "AUTH_REQUIRED", "Se requiere el token de reprotest.")
            return await response(scope, receive, send)

        if method == "POST":
            body = bytearray()
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                body.extend(event.get("body", b""))
                if len(body) > 8192:
                    response = error(413, "BODY_TOO_LARGE", "Solicitud demasiado grande.")
                    return await response(scope, receive, send)
                if not event.get("more_body", False):
                    break
            if path == "/analyze":
                try:
                    payload = json.loads(body)
                except (ValueError, RecursionError):
                    payload = None
                url = payload.get("url") if isinstance(payload, dict) else None
                if not isinstance(url, str) or url not in FIXTURE_URLS or payload != {"url": url}:
                    response = error(
                        400, "FIXTURE_ONLY", "Solo se admiten las fixtures de reprotest."
                    )
                    return await response(scope, receive, send)

            original_receive = receive

            async def receive_body():
                nonlocal body
                if body is None:
                    return await original_receive()
                content, body = bytes(body), None
                return {"type": "http.request", "body": content, "more_body": False}

            receive = receive_body

        if (
            not self.performance
            and path.endswith("/file")
            and any(name == b"range" for name, _ in scope["headers"])
        ):
            await asyncio.sleep(3)

        async def prevent_caching(event):
            if event["type"] == "http.response.start":
                headers = [(key, val) for key, val in event["headers"] if key != b"cache-control"]
                event = {**event, "headers": [*headers, (b"cache-control", b"private, no-store")]}
            await send(event)

        return await self.app(scope, receive, prevent_caching)


def create_reprotest(
    settings: Settings, *, fixture_directory: Path = FIXTURE_DIRECTORY, performance: bool = False
):
    if settings.environment != "production" or settings.analysis_provider != "direct":
        raise ValueError("Reprotest requires production security and the direct provider")

    limits = {
        "max_file_size": LARGE.size,
        "max_input_bytes": LARGE.size,
        "max_output_bytes": LARGE.size,
        "max_temp_work_bytes": LARGE.size * 3,
        "max_active_jobs": 1,
    }
    if performance:
        limits.update(
            rate_limit_requests=PERFORMANCE_RATE_LIMIT,
            rate_limit_window_seconds=PERFORMANCE_WINDOW_SECONDS,
            temp_file_ttl=max(settings.temp_file_ttl, PERFORMANCE_MIN_TTL_SECONDS),
        )
    constrained = settings.model_copy(update=limits)
    app = create_app(constrained)
    policy = URLSafetyPolicy(constrained, resolver=fixture_dns)
    client = SafeHTTPClient(policy, FixtureTransport(fixture_directory), constrained)
    direct = app.state.direct_provider
    direct.http_client = client
    app.state.job_manager.http_client = client
    app.state.job_manager.provider = direct
    app.state.analysis_service = AnalysisService(direct, policy, constrained)

    legacy = LegacySyntheticJobResponse(
        app, fixture_name=LEGACY_NAME, fixture_size=SMALL.size, fixture_sha256=SMALL.sha256
    )
    return RangeAudit(
        ReprotestGate(legacy, constrained.api_token.get_secret_value(), performance=performance)
    )


def main():
    settings = Settings()
    uvicorn.run(
        create_reprotest(settings, performance=os.environ.get("REPROTEST_PERFORMANCE") == "1"),
        host="0.0.0.0",
        port=settings.port,
        workers=1,
        access_log=False,
        proxy_headers=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
