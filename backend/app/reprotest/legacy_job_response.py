"""Test-only wrapper for a C.4 backend restricted to synthetic media."""

import json
import re

JOB_PATH = re.compile(r"/jobs/([0-9a-f]{32})")
MAX_JSON_BYTES = 8192


class LegacySyntheticJobResponse:
    def __init__(self, app, *, fixture_name, fixture_size, fixture_sha256):
        self.app = app
        self.fixture_name = fixture_name
        self.fixture_size = fixture_size
        self.fixture_sha256 = fixture_sha256

    async def __call__(self, scope, receive, send):
        match = JOB_PATH.fullmatch(scope.get("path", ""))
        if scope["type"] != "http" or scope.get("method") != "GET" or not match:
            return await self.app(scope, receive, send)

        start = None
        body = bytearray()

        async def project(event):
            nonlocal start
            event_type = event["type"]
            if event_type == "http.response.start":
                headers = dict(event["headers"])
                if (
                    event["status"] == 200
                    and headers.get(b"content-type", b"").split(b";")[0] == b"application/json"
                    and headers.get(b"content-encoding", b"identity") == b"identity"
                ):
                    start = event
                    return
            if event_type != "http.response.body" or start is None:
                return await send(event)

            chunk = event.get("body", b"")
            if len(body) + len(chunk) > MAX_JSON_BYTES:
                await send(start)
                start = None
                if body:
                    await send(
                        {"type": "http.response.body", "body": bytes(body), "more_body": True}
                    )
                return await send(event)
            body.extend(chunk)
            if event.get("more_body", False):
                return

            output = self.project_job(bytes(body), match[1])
            headers = start["headers"]
            if output != body:
                headers = [
                    (key, value)
                    for key, value in headers
                    if key not in {b"content-length", b"etag", b"content-md5", b"digest"}
                ]
                headers.append((b"content-length", str(len(output)).encode("ascii")))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": output, "more_body": False})

        return await self.app(scope, receive, project)

    def project_job(self, raw, job_id):
        try:
            job = json.loads(raw)
        except (ValueError, RecursionError):
            return raw
        if not isinstance(job, dict) or (
            job.get("id"),
            job.get("status"),
            job.get("fileName"),
            job.get("fileSize"),
            job.get("fileSha256"),
            job.get("downloadUrl"),
        ) != (
            job_id,
            "COMPLETED",
            self.fixture_name,
            self.fixture_size,
            self.fixture_sha256,
            f"/jobs/{job_id}/file",
        ):
            return raw

        job.pop("fileSha256", None)
        job.pop("fileContentType", None)
        return json.dumps(job, ensure_ascii=False, separators=(",", ":")).encode()
