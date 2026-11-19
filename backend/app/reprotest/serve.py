"""Expose C.1 over the reprotest service with synthetic fixtures only."""

import asyncio
import hashlib
import hmac
import json
import re
from pathlib import Path

import uvicorn
from starlette.responses import JSONResponse

from app.core.config import Settings
from app.main import create_app
from app.reprotest.legacy_job_response import LegacySyntheticJobResponse
from app.reprotest.range_audit import RangeAudit
from app.services.analysis import AnalysisService
from app.services.http import SafeHTTPClient
from app.services.url_safety import URLSafetyPolicy

FIXTURE_NAME = "c4-synthetic.m4a"
LEGACY_NAME = "c4-legacy.m4a"
FIXTURE_HASH = "76c73ce767d3cfa93778ccbd70fc250d1c5568a57ca3229f96de07a4be8ccaf6"
FIXTURE_SIZE = 2440018
FIXTURE_URLS = {f"https://media.example.net/{name}" for name in (FIXTURE_NAME, LEGACY_NAME)}
ALLOWED = re.compile(
    r"GET /health|POST /(?:analyze|jobs)|(?:GET|DELETE) /jobs/[a-f0-9]{32}"
    r"|GET /jobs/[a-f0-9]{32}/file"
)
NO_STORE = {"Cache-Control": "private, no-store"}


class FixtureResponse:
    status = 200
    headers = {"Content-Type": "audio/mp4", "Content-Length": str(FIXTURE_SIZE)}

    def __init__(self, data: bytes):
        self.data = data

    async def iter_bytes(self, chunk_size: int):
        for start in range(0, len(self.data), chunk_size):
            yield self.data[start : start + chunk_size]

    async def read_prefix(self, maximum: int) -> bytes:
        return self.data[:maximum]

    async def close(self) -> None:
        pass


class FixtureTransport:
    def __init__(self, fixture: bytes):
        self.fixture = fixture

    async def open(self, method, destination, headers):
        if method not in {"GET", "HEAD"} or str(destination.url) not in FIXTURE_URLS:
            raise OSError("Destination outside reprotest fixtures")
        return FixtureResponse(self.fixture if method == "GET" else b"")


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
    def __init__(self, app, token):
        self.app = app
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

        if path.endswith("/file") and any(name == b"range" for name, _ in scope["headers"]):
            await asyncio.sleep(3)

        async def prevent_caching(event):
            if event["type"] == "http.response.start":
                headers = [(key, val) for key, val in event["headers"] if key != b"cache-control"]
                event = {**event, "headers": [*headers, (b"cache-control", b"private, no-store")]}
            await send(event)

        return await self.app(scope, receive, prevent_caching)


def create_reprotest(settings: Settings):
    fixture = Path(__file__).with_name(FIXTURE_NAME).read_bytes()
    if len(fixture) != FIXTURE_SIZE or hashlib.sha256(fixture).hexdigest() != FIXTURE_HASH:
        raise ValueError("Unexpected reprotest fixture")
    if settings.environment != "production" or settings.analysis_provider != "direct":
        raise ValueError("Reprotest requires production security and the direct provider")

    constrained = settings.model_copy(
        update={
            "max_file_size": FIXTURE_SIZE,
            "max_input_bytes": FIXTURE_SIZE,
            "max_output_bytes": FIXTURE_SIZE,
            "max_temp_work_bytes": FIXTURE_SIZE * 3,
            "max_active_jobs": 1,
        }
    )
    app = create_app(constrained)
    policy = URLSafetyPolicy(constrained, resolver=fixture_dns)
    client = SafeHTTPClient(policy, FixtureTransport(fixture), constrained)
    direct = app.state.direct_provider
    direct.http_client = client
    app.state.job_manager.http_client = client
    app.state.job_manager.provider = direct
    app.state.analysis_service = AnalysisService(direct, policy, constrained)

    legacy = LegacySyntheticJobResponse(
        app, fixture_name=LEGACY_NAME, fixture_size=FIXTURE_SIZE, fixture_sha256=FIXTURE_HASH
    )
    return RangeAudit(ReprotestGate(legacy, constrained.api_token.get_secret_value()))


def main():
    settings = Settings()
    uvicorn.run(
        create_reprotest(settings),
        host="0.0.0.0",
        port=settings.port,
        workers=1,
        access_log=False,
        proxy_headers=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
