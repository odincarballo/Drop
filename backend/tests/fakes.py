import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence

from app.services.http import RemoteResponse
from app.services.url_safety import PublicDestination


class MemoryResponse:
    def __init__(
        self,
        status: int,
        headers: Mapping[str, str],
        chunks: list[bytes] | None = None,
        chunk_delay: float = 0,
    ) -> None:
        self.status = status
        self.headers = headers
        self.chunks = chunks or []
        self.chunk_delay = chunk_delay
        self.closed = False

    async def iter_bytes(self, chunk_size: int) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            if self.chunk_delay:
                await asyncio.sleep(self.chunk_delay)
            yield chunk

    async def read_prefix(self, maximum: int) -> bytes:
        return b"".join(self.chunks)[:maximum]

    async def close(self) -> None:
        self.closed = True


class BlockingResponse(MemoryResponse):
    async def iter_bytes(self, chunk_size: int) -> AsyncIterator[bytes]:
        if self.chunks:
            yield self.chunks[0]
        await asyncio.Event().wait()


class QueueTransport:
    def __init__(self, responses: Sequence[RemoteResponse]) -> None:
        self.responses = list(responses)
        self.requests: list[tuple[str, PublicDestination, Mapping[str, str]]] = []

    async def open(
        self,
        method: str,
        destination: PublicDestination,
        headers: Mapping[str, str],
    ) -> RemoteResponse:
        self.requests.append((method, destination, headers))
        if not self.responses:
            raise AssertionError("Unexpected HTTP request")
        return self.responses.pop(0)
