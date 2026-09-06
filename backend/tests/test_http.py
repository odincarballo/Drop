import asyncio
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import aiohttp
import pytest
import trustme
from aiohttp.abc import AbstractResolver
from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError, UnsafeURLError
from app.services.http import AiohttpPinnedTransport, PinnedResolver, SafeHTTPClient
from app.services.url_safety import PublicDestination, URLSafetyPolicy
from tests.fakes import MemoryResponse, QueueTransport

PUBLIC_TEST_HOST = "public.example.com"


@dataclass(frozen=True)
class TLSMaterials:
    ca: Path
    certificate: Path
    private_key: Path


@pytest.fixture(scope="module")
def tls_materials(tmp_path_factory: pytest.TempPathFactory) -> TLSMaterials:
    """Generate short-lived TLS material instead of tracking a private test key."""
    directory = tmp_path_factory.mktemp("tls")
    authority = trustme.CA()
    certificate = authority.issue_cert(PUBLIC_TEST_HOST)
    materials = TLSMaterials(
        ca=directory / "ca.pem",
        certificate=directory / "server.pem",
        private_key=directory / "server.key",
    )
    authority.cert_pem.write_to_path(materials.ca)
    certificate.cert_chain_pems[0].write_to_path(materials.certificate)
    certificate.private_key_pem.write_to_path(materials.private_key)
    return materials


class LoopbackTestTransport(AiohttpPinnedTransport):
    """Exercise the real TLS transport against a local fixture server only."""

    def _resolver(self, hostname: str, addresses: tuple[str, ...]) -> AbstractResolver:
        return PinnedResolver(hostname, ("127.0.0.1",))


class LogicalPublicPolicy(URLSafetyPolicy):
    """Test seam: preserve public logical validation while the fixture uses loopback."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.validated: list[HttpUrl] = []

    async def validate_public_destination(self, url: HttpUrl) -> PublicDestination:
        self.validated.append(url)
        return PublicDestination(url=url, addresses=("93.184.216.34",))


class TLSCapture:
    def __init__(self) -> None:
        self.server_names: list[str | None] = []
        self.host_headers: list[str] = []
        self.paths: list[str] = []


@asynccontextmanager
async def local_tls_server(capture: TLSCapture, materials: TLSMaterials) -> AsyncIterator[int]:
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(materials.certificate, materials.private_key)

    def capture_sni(
        ssl_socket: ssl.SSLSocket | ssl.SSLObject,
        server_name: str | None,
        initial_context: ssl.SSLSocket,
    ) -> int | None:
        capture.server_names.append(server_name)
        return None

    server_context.set_servername_callback(capture_sni)
    port = 0

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            lines = request.decode("latin-1").split("\r\n")
            request_line = lines[0].split()
            path = request_line[1]
            headers = {
                key.lower(): value.strip()
                for line in lines[1:]
                if ":" in line
                for key, value in [line.split(":", 1)]
            }
            capture.paths.append(path)
            capture.host_headers.append(headers["host"])
            if path == "/redirect":
                response = (
                    "HTTP/1.1 302 Found\r\n"
                    f"Location: https://{PUBLIC_TEST_HOST}:{port}/file.mp4\r\n"
                    "Content-Length: 0\r\nConnection: close\r\n\r\n"
                )
            else:
                response = (
                    "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\n"
                    "Content-Length: 42\r\nConnection: close\r\n\r\n"
                )
            writer.write(response.encode("ascii"))
            await writer.drain()
        finally:
            writer.close()
            with suppress(ConnectionError):
                await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=server_context)
    socket_name = server.sockets[0].getsockname()
    port = cast(int, socket_name[1])
    try:
        yield port
    finally:
        server.close()
        await server.wait_closed()


def make_client(
    settings: Settings,
    responses: list[MemoryResponse],
    dns: dict[str, tuple[str, ...]] | None = None,
) -> tuple[SafeHTTPClient, QueueTransport]:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return (dns or {}).get(host, ("93.184.216.34",))

    transport = QueueTransport(responses)
    return SafeHTTPClient(URLSafetyPolicy(settings, resolver), transport, settings), transport


async def test_allowed_mime_and_content_length(settings: Settings) -> None:
    client, transport = make_client(
        settings,
        [
            MemoryResponse(
                200,
                {
                    "Content-Type": "video/mp4; charset=binary",
                    "Content-Length": "1024",
                    "Content-Disposition": 'attachment; filename="../My clip.mov"',
                },
            )
        ],
    )
    metadata = await client.probe(HttpUrl("https://media.example/file"))
    assert metadata.content_type == "video/mp4"
    assert metadata.content_length == 1024
    assert metadata.file_name == "My clip.mp4"
    assert [request[0] for request in transport.requests] == ["HEAD"]


@pytest.mark.parametrize("mime", ["text/html", "image/png", "video/webm", "audio/wav"])
async def test_rejected_mime(settings: Settings, mime: str) -> None:
    client, _ = make_client(settings, [MemoryResponse(200, {"Content-Type": mime})])
    with pytest.raises(ApplicationError) as raised:
        await client.probe(HttpUrl("https://media.example/file"))
    assert raised.value.code == "UNSUPPORTED_MIME"


async def test_octet_stream_requires_matching_signature(settings: Settings) -> None:
    mp4 = b"\0\0\0\x18ftypisom" + b"x" * 20
    client, _ = make_client(
        settings,
        [
            MemoryResponse(200, {"Content-Type": "application/octet-stream"}),
            MemoryResponse(
                206,
                {
                    "Content-Type": "application/octet-stream",
                    "Content-Range": "bytes 0-31/8000",
                },
                [mp4],
            ),
        ],
    )
    metadata = await client.probe(HttpUrl("https://media.example/download.mp4?id=1"))
    assert metadata.content_type == "video/mp4"
    assert metadata.content_length == 8000
    assert metadata.file_name == "download.mp4"


async def test_octet_stream_with_unknown_signature_is_rejected(settings: Settings) -> None:
    client, _ = make_client(
        settings,
        [
            MemoryResponse(200, {"Content-Type": "application/octet-stream"}),
            MemoryResponse(
                206,
                {
                    "Content-Type": "application/octet-stream",
                    "Content-Range": "bytes 0-4/5",
                },
                [b"hello"],
            ),
        ],
    )
    with pytest.raises(ApplicationError) as raised:
        await client.probe(HttpUrl("https://media.example/file.bin"))
    assert raised.value.code == "UNSUPPORTED_MIME"


async def test_octet_mp4_signature_without_safe_extension_is_rejected(
    settings: Settings,
) -> None:
    mp4 = b"\0\0\0\x18ftypisom" + b"x" * 20
    client, _ = make_client(
        settings,
        [
            MemoryResponse(200, {"Content-Type": "application/octet-stream"}),
            MemoryResponse(206, {"Content-Range": "bytes 0-31/32"}, [mp4]),
        ],
    )
    with pytest.raises(ApplicationError) as raised:
        await client.probe(HttpUrl("https://media.example/download?id=1"))
    assert raised.value.code == "UNSUPPORTED_MIME"


async def test_content_length_over_limit_is_rejected_before_body(settings: Settings) -> None:
    settings.max_file_size = 100
    client, _ = make_client(
        settings,
        [MemoryResponse(200, {"Content-Type": "audio/mpeg", "Content-Length": "101"})],
    )
    with pytest.raises(ApplicationError) as raised:
        await client.probe(HttpUrl("https://media.example/audio.mp3"))
    assert raised.value.code == "FILE_TOO_LARGE"


async def test_public_redirect_is_revalidated(settings: Settings) -> None:
    client, transport = make_client(
        settings,
        [
            MemoryResponse(302, {"Location": "https://cdn.example/final.mp4"}),
            MemoryResponse(200, {"Content-Type": "video/mp4", "Content-Length": "10"}),
        ],
    )
    metadata = await client.probe(HttpUrl("https://media.example/start"))
    assert str(metadata.final_url) == "https://cdn.example/final.mp4"
    assert [request[1].url.host for request in transport.requests] == [
        "media.example",
        "cdn.example",
    ]


async def test_redirect_to_private_address_is_rejected(settings: Settings) -> None:
    redirect = MemoryResponse(302, {"Location": "http://10.0.0.8/private.mp4"})
    client, transport = make_client(settings, [redirect])
    with pytest.raises(UnsafeURLError):
        await client.probe(HttpUrl("https://media.example/start"))
    assert redirect.closed
    assert len(transport.requests) == 1


async def test_download_without_length_is_stopped_at_limit(
    settings: Settings, tmp_path: Path
) -> None:
    settings.max_file_size = 5
    response = MemoryResponse(200, {"Content-Type": "audio/mpeg"}, [b"ID3", b"123"])
    client, _ = make_client(settings, [response])
    target = tmp_path / "audio.mp3"
    with target.open("wb") as output, pytest.raises(ApplicationError) as raised:
        await client.download(
            HttpUrl("https://media.example/audio.mp3"),
            expected_type="audio/mpeg",
            expected_length=None,
            write=output.write,
            progress=lambda downloaded, total: None,
        )
    assert raised.value.code == "FILE_TOO_LARGE"
    assert target.stat().st_size == 3


async def test_pinned_resolver_returns_only_validated_addresses() -> None:
    resolver = PinnedResolver("media.example", ("93.184.216.34", "2606:4700::1111"))
    values = await resolver.resolve("media.example", 443)
    assert {value["host"] for value in values} == {"93.184.216.34", "2606:4700::1111"}
    with pytest.raises(OSError):
        await resolver.resolve("different.example", 443)


async def test_transport_maps_network_error_without_public_internet(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def fail_request(
        self: aiohttp.ClientSession,
        method: str,
        url: str,
        **kwargs: object,
    ) -> aiohttp.ClientResponse:
        verification_error = ssl.SSLCertVerificationError(
            1, "certificate verify failed for https://secret.example/?token=hidden"
        )
        raise aiohttp.ClientConnectionError("secret") from verification_error

    monkeypatch.setattr(aiohttp.ClientSession, "request", fail_request)
    caplog.set_level("WARNING", logger="app.services.http")
    destination = PublicDestination(
        url=HttpUrl("https://media.example/file.mp4"),
        addresses=("93.184.216.34",),
    )
    with pytest.raises(ApplicationError) as raised:
        await AiohttpPinnedTransport(settings).open("HEAD", destination, {})
    assert raised.value.code == "REMOTE_UNAVAILABLE"
    assert "ClientConnectionError -> SSLCertVerificationError" in caplog.text
    assert "secret.example" not in caplog.text
    assert "token" not in caplog.text


async def test_https_pinned_transport_preserves_sni_certificate_and_host(
    settings: Settings, tls_materials: TLSMaterials
) -> None:
    capture = TLSCapture()
    client_context = ssl.create_default_context(cafile=str(tls_materials.ca))
    transport = LoopbackTestTransport(settings, client_context)
    async with local_tls_server(capture, tls_materials) as port:
        url = HttpUrl(f"https://{PUBLIC_TEST_HOST}:{port}/file.mp4")
        response = await transport.open(
            "HEAD", PublicDestination(url=url, addresses=("93.184.216.34",)), {}
        )
        try:
            assert response.status == 200
        finally:
            await response.close()
    assert capture.server_names == [PUBLIC_TEST_HOST]
    assert capture.host_headers == [f"{PUBLIC_TEST_HOST}:{port}"]


async def test_https_redirect_revalidates_and_preserves_hostname(
    settings: Settings, tls_materials: TLSMaterials
) -> None:
    capture = TLSCapture()
    policy = LogicalPublicPolicy(settings)
    client_context = ssl.create_default_context(cafile=str(tls_materials.ca))
    client = SafeHTTPClient(policy, LoopbackTestTransport(settings, client_context), settings)
    async with local_tls_server(capture, tls_materials) as port:
        metadata = await client.probe(HttpUrl(f"https://{PUBLIC_TEST_HOST}:{port}/redirect"))
    assert metadata.content_type == "video/mp4"
    assert metadata.content_length == 42
    assert capture.paths == ["/redirect", "/file.mp4"]
    assert capture.server_names == [PUBLIC_TEST_HOST, PUBLIC_TEST_HOST]
    assert capture.host_headers == [f"{PUBLIC_TEST_HOST}:{port}"] * 2
    assert [str(item) for item in policy.validated] == [
        f"https://{PUBLIC_TEST_HOST}:{port}/redirect",
        f"https://{PUBLIC_TEST_HOST}:{port}/file.mp4",
    ]


def test_transport_refuses_disabled_tls_verification(settings: Settings) -> None:
    insecure = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    insecure.check_hostname = False
    insecure.verify_mode = ssl.CERT_NONE
    with pytest.raises(ValueError, match="verification are required"):
        AiohttpPinnedTransport(settings, insecure)
