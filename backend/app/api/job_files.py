from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import aclosing
from secrets import token_hex

from starlette.datastructures import Headers
from starlette.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from starlette.types import Receive, Scope, Send

from app.services.jobs import (
    FILE_BLOCK_BYTES,
    JobFileRead,
    JobManager,
    job_file_unavailable,
)

type ByteRange = tuple[int, int]  # Half-open [start, end).
MAX_RANGES = 100


class JobFileResponse(Response):
    def __init__(self, manager: JobManager, job_id: str) -> None:
        super().__init__()
        self.manager = manager
        self.job_id = job_id

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        with self.manager.read_file(self.job_id) as reader:
            await _serve_file(reader, scope, receive, send)


async def _serve_file(reader: JobFileRead, scope: Scope, receive: Receive, send: Send) -> None:
    file = reader.file
    size = file.metadata.st_size
    request_headers = Headers(scope=scope)
    range_values = request_headers.getlist("range")
    if_range = request_headers.getlist("if-range")
    ranges = None
    if range_values and (not if_range or if_range == [file.etag]):
        try:
            ranges = _parse_ranges(",".join(range_values), size)
        except ValueError:
            response = PlainTextResponse("Malformed range header.", status_code=400)
            await response(scope, receive, send)
            return
        if ranges == []:
            response = PlainTextResponse(
                status_code=416, headers={"Content-Range": f"bytes */{size}"}
            )
            await response(scope, receive, send)
            return

    # Reuse Starlette's attachment and multipart headers. Only the verified
    # descriptor below supplies bytes to the response.
    attachment = FileResponse(
        file.path,
        media_type=file.content_type,
        filename=file.filename,
        stat_result=file.metadata,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "ETag": file.etag,
        },
    )
    headers = attachment.headers
    part_header = None
    closing_boundary = b""
    if ranges is None:
        status = 200
        ranges = [(0, size)] if size else []
    else:
        status = 206
        if len(ranges) == 1:
            start, end = ranges[0]
            headers["content-range"] = f"bytes {start}-{end - 1}/{size}"
            headers["content-length"] = str(end - start)
        else:
            boundary = token_hex(13)
            length, part_header = attachment.generate_multipart(
                ranges, boundary, size, file.content_type
            )
            headers["content-type"] = f"multipart/byteranges; boundary={boundary}"
            headers["content-length"] = str(length)
            closing_boundary = f"--{boundary}--".encode("ascii")

    async with aclosing(_file_body(reader, ranges, part_header, closing_boundary)) as body:
        # Validate the first block while a normal error response is still possible.
        try:
            first = await anext(body, b"")
        except OSError as exc:
            raise job_file_unavailable() from exc

        async def stream() -> AsyncIterator[bytes]:
            yield first
            async for chunk in body:
                yield chunk

        await StreamingResponse(stream(), status_code=status, headers=headers)(scope, receive, send)


async def _file_body(
    reader: JobFileRead,
    ranges: list[ByteRange],
    part_header: Callable[[int, int], bytes] | None,
    closing_boundary: bytes,
) -> AsyncGenerator[bytes]:
    for start, end in ranges:
        for index in range(start // FILE_BLOCK_BYTES, (end - 1) // FILE_BLOCK_BYTES + 1):
            block = await reader.read_block(index)
            offset = index * FILE_BLOCK_BYTES
            if part_header is not None and index == start // FILE_BLOCK_BYTES:
                yield part_header(start, end)
            yield block[max(start - offset, 0) : end - offset]
        if part_header is not None:
            yield b"\r\n"
    if part_header is not None:
        yield closing_boundary


def _parse_ranges(value: str, size: int) -> list[ByteRange] | None:
    unit, _, specifiers = value.partition("=")
    if unit.lower() != "bytes":
        raise ValueError("Unrecognized range unit")
    ranges: list[ByteRange] = []
    # RFC 9110 list recipients tolerate empty elements. Every nonempty element
    # must be valid, even when another element is satisfiable.
    parts = [part for item in specifiers.split(",") if (part := item.strip(" \t"))]
    if not parts:
        raise ValueError("Missing range specifier")
    for part in parts:
        first, dash, last = part.partition("-")
        if not dash or any(not (n.isascii() and n.isdecimal()) for n in (first, last) if n):
            raise ValueError("Invalid range specifier")
        if not first:
            if not last:
                raise ValueError("Missing suffix length")
            end = size
            start = size - _bounded_position(last, size)
        else:
            if last and _number_key(last) < _number_key(first):
                raise ValueError("Descending range")
            start = _bounded_position(first, size)
            end = min(_bounded_position(last, size) + 1, size) if last else size
        if start < end:
            ranges.append((start, end))
    if len(parts) > MAX_RANGES and ranges:
        return None  # Match the existing full-body fallback for excessive range sets.
    merged: list[ByteRange] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            last_start, last_end = merged[-1]
            merged[-1] = last_start, max(last_end, end)
        else:
            merged.append((start, end))
    return merged


def _number_key(digits: str) -> tuple[int, str]:
    normalized = digits.lstrip("0") or "0"
    return len(normalized), normalized


def _bounded_position(digits: str, size: int) -> int:
    # HTTP offsets have arbitrary precision; convert only values smaller than the file.
    key = _number_key(digits)
    return size if key >= _number_key(str(size)) else int(key[1])
