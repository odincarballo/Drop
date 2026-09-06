import asyncio
import ipaddress
import logging
import re
import socket
import ssl
from collections.abc import AsyncIterator, Callable, Mapping
from email.message import Message
from pathlib import PurePosixPath
from typing import Protocol
from urllib.parse import unquote, urljoin

import aiohttp
import certifi
from aiohttp.abc import AbstractResolver, ResolveResult
from pydantic import HttpUrl, ValidationError

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.services.url_safety import PublicDestination, URLSafetyPolicy

REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
ALLOWED_MIME_TYPES = frozenset({"video/mp4", "audio/mpeg", "audio/mp4", "audio/aac"})
MIME_EXTENSIONS = {
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
}
PROBE_BYTES = 4096

logger = logging.getLogger(__name__)


class RemoteResponse(Protocol):
    status: int
    headers: Mapping[str, str]

    def iter_bytes(self, chunk_size: int) -> AsyncIterator[bytes]: ...

    async def read_prefix(self, maximum: int) -> bytes: ...

    async def close(self) -> None: ...


class HTTPTransport(Protocol):
    async def open(
        self,
        method: str,
        destination: PublicDestination,
        headers: Mapping[str, str],
    ) -> RemoteResponse: ...


class PinnedResolver(AbstractResolver):
    """Resolve one validated hostname only to its already-checked addresses."""

    def __init__(self, hostname: str, addresses: tuple[str, ...]) -> None:
        self.hostname = hostname.rstrip(".").lower()
        self.addresses = addresses

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_UNSPEC
    ) -> list[ResolveResult]:
        if host.rstrip(".").lower() != self.hostname:
            raise OSError("Unexpected hostname")
        results: list[ResolveResult] = []
        for address in self.addresses:
            version = ipaddress.ip_address(address).version
            address_family = socket.AF_INET6 if version == 6 else socket.AF_INET
            if family not in {socket.AF_UNSPEC, address_family}:
                continue
            results.append(
                ResolveResult(
                    hostname=host,
                    host=address,
                    port=port,
                    family=address_family,
                    proto=0,
                    flags=socket.AI_NUMERICHOST,
                )
            )
        if not results:
            raise OSError("No validated address for requested family")
        return results

    async def close(self) -> None:
        return None


class AiohttpResponse:
    def __init__(self, session: aiohttp.ClientSession, response: aiohttp.ClientResponse) -> None:
        self._session = session
        self._response = response
        self.status = response.status
        self.headers: Mapping[str, str] = response.headers

    async def iter_bytes(self, chunk_size: int) -> AsyncIterator[bytes]:
        async for chunk in self._response.content.iter_chunked(chunk_size):
            yield chunk

    async def read_prefix(self, maximum: int) -> bytes:
        result = bytearray()
        async for chunk in self.iter_bytes(min(maximum, 1024)):
            result.extend(chunk[: maximum - len(result)])
            if len(result) >= maximum:
                break
        return bytes(result)

    async def close(self) -> None:
        self._response.close()
        await self._session.close()


class AiohttpPinnedTransport:
    def __init__(self, settings: Settings, ssl_context: ssl.SSLContext | None = None) -> None:
        self.settings = settings
        self.ssl_context = ssl_context or ssl.create_default_context(cafile=certifi.where())
        if self.ssl_context.verify_mode != ssl.CERT_REQUIRED or not self.ssl_context.check_hostname:
            raise ValueError("TLS certificate and hostname verification are required")

    def _resolver(self, hostname: str, addresses: tuple[str, ...]) -> AbstractResolver:
        return PinnedResolver(hostname, addresses)

    async def open(
        self,
        method: str,
        destination: PublicDestination,
        headers: Mapping[str, str],
    ) -> RemoteResponse:
        host = (destination.url.host or "").strip("[]").rstrip(".")
        resolver = self._resolver(host, destination.addresses)
        connector = aiohttp.TCPConnector(
            resolver=resolver,
            use_dns_cache=False,
            force_close=True,
            ssl=self.ssl_context,
        )
        session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(
                total=None,
                connect=self.settings.connect_timeout,
                sock_connect=self.settings.connect_timeout,
            ),
            auto_decompress=False,
            trust_env=False,
        )
        try:
            response = await session.request(
                method,
                str(destination.url),
                headers=headers,
                allow_redirects=False,
            )
        except (aiohttp.ClientError, TimeoutError, OSError) as exc:
            await session.close()
            logger.warning("Outbound HTTP connection failed error=%s", _safe_exception_details(exc))
            if isinstance(exc, (aiohttp.ServerTimeoutError, TimeoutError)):
                raise ApplicationError(
                    "REMOTE_TIMEOUT", "El servidor remoto tardó demasiado en responder.", 504
                ) from exc
            raise ApplicationError(
                "REMOTE_UNAVAILABLE", "No se pudo conectar con el archivo remoto.", 502
            ) from exc
        return AiohttpResponse(session, response)


class OpenedResponse:
    def __init__(self, response: RemoteResponse, url: HttpUrl) -> None:
        self.response = response
        self.url = url


class RemoteMetadata:
    def __init__(
        self,
        *,
        final_url: HttpUrl,
        content_type: str,
        content_length: int | None,
        file_name: str,
    ) -> None:
        self.final_url = final_url
        self.content_type = content_type
        self.content_length = content_length
        self.file_name = file_name


class SafeHTTPClient:
    def __init__(
        self,
        policy: URLSafetyPolicy,
        transport: HTTPTransport,
        settings: Settings,
    ) -> None:
        self.policy = policy
        self.transport = transport
        self.settings = settings

    async def _open_following_redirects(
        self, method: str, original_url: HttpUrl, headers: Mapping[str, str]
    ) -> OpenedResponse:
        current = original_url
        redirects = 0
        while True:
            destination = await self.policy.validate_public_destination(current)
            response = await self.transport.open(method, destination, headers)
            if response.status not in REDIRECT_STATUSES:
                return OpenedResponse(response, current)
            location = _header(response.headers, "location")
            await response.close()
            if redirects >= self.settings.max_redirects:
                raise ApplicationError(
                    "TOO_MANY_REDIRECTS", "El enlace tiene demasiadas redirecciones.", 400
                )
            if not location:
                raise ApplicationError(
                    "INVALID_REDIRECT", "El servidor remoto devolvió una redirección inválida.", 400
                )
            try:
                current = HttpUrl(urljoin(str(current), location))
            except ValidationError as exc:
                raise ApplicationError(
                    "INVALID_REDIRECT", "El servidor remoto devolvió una redirección inválida.", 400
                ) from exc
            redirects += 1

    async def probe(self, url: HttpUrl) -> RemoteMetadata:
        common_headers = {"Accept-Encoding": "identity", "User-Agent": "MediaDrop/0.3"}
        opened = await self._open_following_redirects("HEAD", url, common_headers)
        response = opened.response
        if response.status in {405, 501}:
            await response.close()
            return await self._probe_with_range(url, None, None)
        try:
            _ensure_success(response.status)
            if response.status != 200:
                raise ApplicationError(
                    "INVALID_REMOTE_RESPONSE",
                    "El servidor devolvió una respuesta de metadatos inválida.",
                    502,
                )
            _ensure_identity_encoding(response.headers)
            length = _content_length(response.headers)
            self._ensure_size(length)
            raw_type = _content_type(response.headers)
            disposition = _header(response.headers, "content-disposition")
            if raw_type in {"", "application/octet-stream"}:
                return await self._probe_with_range(url, length, disposition)
            if raw_type not in ALLOWED_MIME_TYPES:
                raise ApplicationError(
                    "UNSUPPORTED_MIME", "El enlace no apunta a un archivo multimedia compatible."
                )
            return RemoteMetadata(
                final_url=opened.url,
                content_type=raw_type,
                content_length=length,
                file_name=safe_file_name(disposition, opened.url, raw_type),
            )
        finally:
            await response.close()

    async def _probe_with_range(
        self,
        url: HttpUrl,
        known_length: int | None,
        known_disposition: str | None,
    ) -> RemoteMetadata:
        opened = await self._open_following_redirects(
            "GET",
            url,
            {
                "Accept-Encoding": "identity",
                "Range": f"bytes=0-{PROBE_BYTES - 1}",
                "User-Agent": "MediaDrop/0.3",
            },
        )
        response = opened.response
        try:
            _ensure_success(response.status)
            if response.status not in {200, 206}:
                raise ApplicationError(
                    "INVALID_REMOTE_RESPONSE",
                    "El servidor devolvió una respuesta parcial inválida.",
                    502,
                )
            _ensure_identity_encoding(response.headers)
            response_length = _resource_length(response.headers, response.status)
            if (
                known_length is not None
                and response_length is not None
                and known_length != response_length
            ):
                raise ApplicationError(
                    "INVALID_REMOTE_RESPONSE",
                    "El servidor devolvió metadatos de tamaño contradictorios.",
                    502,
                )
            length = known_length if known_length is not None else response_length
            self._ensure_size(length)
            disposition = known_disposition or _header(response.headers, "content-disposition")
            sample = await response.read_prefix(PROBE_BYTES)
            content_type = sniff_media_type(sample, hinted_extension(disposition, opened.url))
            if content_type is None:
                raise ApplicationError(
                    "UNSUPPORTED_MIME", "No se pudo confirmar un formato multimedia compatible."
                )
            return RemoteMetadata(
                final_url=opened.url,
                content_type=content_type,
                content_length=length,
                file_name=safe_file_name(disposition, opened.url, content_type),
            )
        finally:
            await response.close()

    async def download(
        self,
        url: HttpUrl,
        *,
        expected_type: str,
        expected_length: int | None,
        write: Callable[[bytes], object],
        progress: Callable[[int, int | None], None],
    ) -> int:
        try:
            async with asyncio.timeout(self.settings.download_timeout):
                return await self._download(
                    url,
                    expected_type=expected_type,
                    expected_length=expected_length,
                    write=write,
                    progress=progress,
                )
        except TimeoutError as exc:
            raise ApplicationError(
                "DOWNLOAD_TIMEOUT", "La descarga tardó demasiado y se detuvo.", 504
            ) from exc

    async def _download(
        self,
        url: HttpUrl,
        *,
        expected_type: str,
        expected_length: int | None,
        write: Callable[[bytes], object],
        progress: Callable[[int, int | None], None],
    ) -> int:
        opened = await self._open_following_redirects(
            "GET", url, {"Accept-Encoding": "identity", "User-Agent": "MediaDrop/0.3"}
        )
        response = opened.response
        try:
            _ensure_success(response.status)
            if response.status != 200:
                raise ApplicationError(
                    "REMOTE_PARTIAL_RESPONSE",
                    "El servidor remoto no entregó el archivo completo.",
                    502,
                )
            _ensure_identity_encoding(response.headers)
            length = _content_length(response.headers)
            self._ensure_size(length)
            if expected_length is not None and length is not None and expected_length != length:
                raise ApplicationError(
                    "RESOURCE_CHANGED",
                    "El archivo cambió desde que fue analizado. Analízalo de nuevo.",
                )
            raw_type = _content_type(response.headers)
            needs_sniffing = raw_type == "application/octet-stream"
            if raw_type not in ALLOWED_MIME_TYPES and not needs_sniffing:
                raise ApplicationError(
                    "UNSUPPORTED_MIME", "El servidor ya no entrega un archivo compatible."
                )
            if raw_type in ALLOWED_MIME_TYPES and raw_type != expected_type:
                raise ApplicationError(
                    "RESOURCE_CHANGED",
                    "El archivo cambió desde que fue analizado. Analízalo de nuevo.",
                )
            total = length if length is not None else expected_length
            downloaded = 0
            prefix = bytearray()
            type_confirmed = not needs_sniffing
            async for chunk in response.iter_bytes(64 * 1024):
                downloaded += len(chunk)
                if downloaded > self.settings.max_file_size:
                    raise ApplicationError(
                        "FILE_TOO_LARGE", "El archivo supera el tamaño máximo permitido.", 413
                    )
                if not type_confirmed:
                    prefix.extend(chunk[: max(0, PROBE_BYTES - len(prefix))])
                    detected = sniff_media_type(prefix, MIME_EXTENSIONS[expected_type])
                    if detected is not None:
                        if detected != expected_type:
                            raise ApplicationError(
                                "RESOURCE_CHANGED",
                                "El archivo cambió desde que fue analizado. Analízalo de nuevo.",
                            )
                        type_confirmed = True
                    elif len(prefix) >= PROBE_BYTES:
                        raise ApplicationError(
                            "UNSUPPORTED_MIME", "No se pudo confirmar el formato del archivo."
                        )
                write(chunk)
                progress(downloaded, total)
            if needs_sniffing and not type_confirmed:
                detected = sniff_media_type(prefix, MIME_EXTENSIONS[expected_type])
                if detected != expected_type:
                    raise ApplicationError(
                        "UNSUPPORTED_MIME", "No se pudo confirmar el formato del archivo."
                    )
            if length is not None and downloaded != length:
                raise ApplicationError(
                    "INCOMPLETE_DOWNLOAD",
                    "La conexión se interrumpió antes de completar el archivo.",
                    502,
                )
            if expected_length is not None and downloaded != expected_length:
                raise ApplicationError(
                    "RESOURCE_CHANGED",
                    "El archivo cambió desde que fue analizado. Analízalo de nuevo.",
                )
            if downloaded == 0:
                raise ApplicationError(
                    "EMPTY_FILE", "El servidor remoto entregó un archivo vacío.", 502
                )
            progress(downloaded, total)
            return downloaded
        except aiohttp.ClientError as exc:
            logger.warning("Outbound download interrupted error=%s", _safe_exception_details(exc))
            raise ApplicationError(
                "DOWNLOAD_INTERRUPTED", "La conexión se interrumpió durante la descarga.", 502
            ) from exc
        finally:
            await response.close()

    def _ensure_size(self, length: int | None) -> None:
        if length is not None and length > self.settings.max_file_size:
            raise ApplicationError(
                "FILE_TOO_LARGE", "El archivo supera el tamaño máximo permitido.", 413
            )


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.lower()
    return next((value for key, value in headers.items() if key.lower() == target), None)


def _safe_exception_details(exc: BaseException) -> str:
    """Return diagnostic types/codes only; never include a URL or exception text."""
    details: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        label = type(current).__name__
        if isinstance(current, ssl.SSLCertVerificationError):
            verify_code = getattr(current, "verify_code", None)
            label = f"{label}(verify_code={verify_code})"
        elif isinstance(current, OSError) and current.errno is not None:
            label = f"{label}(errno={current.errno})"
        details.append(label)
        current = current.__cause__ or current.__context__
    return " -> ".join(details)


def _content_type(headers: Mapping[str, str]) -> str:
    return (_header(headers, "content-type") or "").split(";", 1)[0].strip().lower()


def _content_length(headers: Mapping[str, str]) -> int | None:
    value = _header(headers, "content-length")
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ApplicationError(
            "INVALID_REMOTE_RESPONSE", "El servidor devolvió metadatos inválidos.", 502
        ) from exc
    if parsed < 0:
        raise ApplicationError(
            "INVALID_REMOTE_RESPONSE", "El servidor devolvió metadatos inválidos.", 502
        )
    return parsed


def _resource_length(headers: Mapping[str, str], status: int) -> int | None:
    if status == 206:
        content_range = _header(headers, "content-range") or ""
        match = re.fullmatch(r"bytes\s+\d+-\d+/(\d+|\*)", content_range, flags=re.IGNORECASE)
        if not match:
            raise ApplicationError(
                "INVALID_REMOTE_RESPONSE",
                "El servidor devolvió un rango de bytes inválido.",
                502,
            )
        if match.group(1) == "*":
            return None
        return int(match.group(1))
    return _content_length(headers)


def _ensure_identity_encoding(headers: Mapping[str, str]) -> None:
    encoding = (_header(headers, "content-encoding") or "identity").strip().lower()
    if encoding != "identity":
        raise ApplicationError(
            "UNSUPPORTED_ENCODING",
            "El servidor remoto comprime el archivo de forma no compatible.",
            502,
        )


def _ensure_success(status: int) -> None:
    if 200 <= status < 300:
        return
    if status == 404:
        raise ApplicationError("FILE_NOT_FOUND", "El archivo no fue encontrado.", 404)
    if status in {401, 403, 410}:
        raise ApplicationError(
            "URL_EXPIRED", "El enlace caducó o ya no permite acceder al archivo.", 400
        )
    raise ApplicationError(
        "REMOTE_HTTP_ERROR", "El servidor remoto no pudo entregar el archivo.", 502
    )


def sniff_media_type(sample: bytes | bytearray, extension_hint: str | None = None) -> str | None:
    data = bytes(sample)
    if len(data) >= 12 and data[4:8] == b"ftyp":
        normalized_hint = (extension_hint or "").lower()
        if normalized_hint == ".mp4":
            return "video/mp4"
        if normalized_hint == ".m4a":
            return "audio/mp4"
        return None
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE6 == 0xE2):
        return "audio/mpeg"
    if len(data) >= 2 and data[0] == 0xFF and data[1] & 0xF6 == 0xF0:
        return "audio/aac"
    return None


def hinted_extension(disposition: str | None, url: HttpUrl) -> str | None:
    candidate: str | None = None
    if disposition:
        message = Message()
        message["content-disposition"] = disposition
        candidate = message.get_filename()
    if not candidate:
        candidate = PurePosixPath(unquote(url.path or "")).name
    return PurePosixPath(candidate or "").suffix.lower() or None


def safe_file_name(disposition: str | None, url: HttpUrl, content_type: str) -> str:
    candidate: str | None = None
    if disposition:
        message = Message()
        message["content-disposition"] = disposition
        candidate = message.get_filename()
    if not candidate:
        candidate = PurePosixPath(unquote(url.path or "")).name
    candidate = PurePosixPath(candidate or "media").name
    stem = PurePosixPath(candidate).stem or "media"
    stem = re.sub(r"[^\w .-]", "_", stem, flags=re.UNICODE).strip(" .")[:100] or "media"
    return f"{stem}{MIME_EXTENSIONS[content_type]}"
