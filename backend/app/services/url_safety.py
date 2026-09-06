import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError, UnsafeURLError

type Resolver = Callable[[str, int], Awaitable[tuple[str, ...]]]


async def resolve_host(host: str, port: int) -> tuple[str, ...]:
    entries = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return tuple({str(entry[4][0]) for entry in entries})


def is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        # Reject scoped and transition addresses to avoid indirect private destinations.
        if address.scope_id or address.ipv4_mapped or address.sixtofour or address.teredo:
            return False
        if address in ipaddress.ip_network("64:ff9b::/96"):
            return False
    return address.is_global and not address.is_multicast


@dataclass(frozen=True)
class PublicDestination:
    url: HttpUrl
    addresses: tuple[str, ...]


class URLSafetyPolicy:
    def __init__(self, settings: Settings, resolver: Resolver = resolve_host) -> None:
        self.settings = settings
        self.resolver = resolver

    def validate_syntax(self, url: HttpUrl) -> HttpUrl:
        """Offline gate used for mock analysis; never claims DNS safety."""
        if len(str(url)) > self.settings.max_url_length:
            raise ApplicationError("URL_TOO_LONG", "La URL supera la longitud máxima permitida.")
        host = (url.host or "").strip("[]").rstrip(".").lower()
        if (
            url.scheme not in {"http", "https"}
            or not host
            or url.username is not None
            or url.password is not None
            or url.port not in {80, 443}
            or "%" in host
        ):
            raise UnsafeURLError
        try:
            ipaddress.ip_address(host)
        except ValueError:
            blocked_suffixes = ("localhost", "local", "internal", "home", "lan", "test", "invalid")
            if "." not in host or any(
                host == suffix or host.endswith(f".{suffix}") for suffix in blocked_suffixes
            ):
                raise UnsafeURLError from None
        else:
            if not is_public_address(host):
                raise UnsafeURLError
        return url

    async def validate_public_destination(self, url: HttpUrl) -> PublicDestination:
        """Reject if any DNS answer is non-public before the transport pins it."""
        self.validate_syntax(url)
        host = (url.host or "").strip("[]").rstrip(".")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            try:
                async with asyncio.timeout(self.settings.connect_timeout):
                    addresses = await self.resolver(host, url.port or 443)
            except (OSError, TimeoutError) as exc:
                raise ApplicationError(
                    "DNS_UNAVAILABLE", "No se pudo validar el destino de la URL.", 400
                ) from exc
        else:
            addresses = (host,)
        if not addresses or not all(is_public_address(address) for address in addresses):
            raise UnsafeURLError
        return PublicDestination(url=url, addresses=addresses)
