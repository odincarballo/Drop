"""Capture only the fields required to compare C.4 transfer ranges."""

import json
import logging
import re
import time
from datetime import UTC, datetime


class RangeAudit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/ready":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        job = re.fullmatch(r"/jobs/([a-f0-9]{32})(/file)?", path)
        if job:
            route = "file" if job[2] else "job"
        elif path in {"/health", "/analyze", "/jobs"}:
            route = path[1:]
        else:
            route = "other"
        started = time.monotonic()
        request_headers = dict(scope["headers"])
        record = {
            "utc": datetime.now(UTC).isoformat(),
            "method": scope["method"]
            if scope["method"] in {"GET", "HEAD", "POST", "DELETE"}
            else "other",
            "route": route,
            "job": job[1] if job else None,
            "range": limited_header(request_headers, b"range", rb"bytes=[0-9-]+"),
            "if_range": limited_header(request_headers, b"if-range", rb'"sha256-[a-f0-9]{64}"'),
            "status": None,
            "content_range": None,
            "etag": None,
            "bytes_emitted": 0,
            "body_finished": False,
        }

        async def observe(message):
            await send(message)
            if message["type"] == "http.response.start":
                headers = dict(message["headers"])
                record["status"] = message["status"]
                record["content_range"] = limited_header(
                    headers, b"content-range", rb"bytes (?:[0-9]+-[0-9]+|\*)/[0-9]+"
                )
                record["etag"] = limited_header(headers, b"etag", rb'"sha256-[a-f0-9]{64}"')
            elif message["type"] == "http.response.body":
                record["bytes_emitted"] += len(message.get("body", b""))
                record["body_finished"] = not message.get("more_body", False)

        try:
            await self.app(scope, receive, observe)
        finally:
            record["milliseconds"] = round((time.monotonic() - started) * 1000)
            logging.getLogger("uvicorn.error").info("reprotest %s", json.dumps(record))


def limited_header(headers, name, pattern):
    value = headers.get(name)
    if value is None:
        return None
    if len(value) > 96 or not re.fullmatch(pattern, value):
        return "outside fixture contract"
    return value.decode("ascii")
