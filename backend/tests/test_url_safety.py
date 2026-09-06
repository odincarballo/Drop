import asyncio

import pytest
from pydantic import HttpUrl

from app.core.config import Settings
from app.core.errors import ApplicationError, UnsafeURLError
from app.services.url_safety import URLSafetyPolicy


@pytest.mark.parametrize(
    "addresses",
    [
        (),
        ("127.0.0.1",),
        ("10.0.0.1",),
        ("169.254.169.254",),
        ("::1",),
        ("93.184.216.34", "192.168.1.1"),
        ("2606:4700:4700::1111", "fe80::1"),
    ],
)
async def test_dns_rejects_any_nonpublic_answer(
    settings: Settings, addresses: tuple[str, ...]
) -> None:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        return addresses

    policy = URLSafetyPolicy(settings, resolver)
    with pytest.raises(UnsafeURLError):
        await policy.validate_public_destination(HttpUrl("https://example.com/video.mp4"))


async def test_public_dns_answers(settings: Settings) -> None:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        assert host == "example.com"
        assert port == 443
        return ("93.184.216.34", "2606:4700:4700::1111")

    result = await URLSafetyPolicy(settings, resolver).validate_public_destination(
        HttpUrl("https://example.com/video.mp4")
    )
    assert len(result.addresses) == 2


async def test_dns_failure_is_closed(settings: Settings) -> None:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        raise OSError("DNS unavailable")

    with pytest.raises(ApplicationError) as raised:
        await URLSafetyPolicy(settings, resolver).validate_public_destination(
            HttpUrl("https://example.com")
        )
    assert raised.value.code == "DNS_UNAVAILABLE"


async def test_dns_timeout(settings: Settings) -> None:
    async def resolver(host: str, port: int) -> tuple[str, ...]:
        await asyncio.sleep(1)
        return ("93.184.216.34",)

    settings.connect_timeout = 0.001
    with pytest.raises(ApplicationError) as raised:
        await URLSafetyPolicy(settings, resolver).validate_public_destination(
            HttpUrl("https://example.com")
        )
    assert raised.value.code == "DNS_UNAVAILABLE"
