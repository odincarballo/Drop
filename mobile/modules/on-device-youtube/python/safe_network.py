"""Metadata-only HTTPS transport. No cookies/proxies; public IP pinning per redirect."""

import http.client
import io
import ipaddress
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit

import certifi
from _mediadrop_native import check
from yt_dlp.networking.common import RequestHandler, Response
from yt_dlp.networking.exceptions import HTTPError, TransportError

ALLOWED_ROOTS = ("youtube.com", "googlevideo.com", "ytimg.com")
ALLOWED_EXACT = {"youtubei.googleapis.com"}


def is_public(address):
    ip = ipaddress.ip_address(address)
    return ip.is_global and not (
        ip.is_multicast
        or ip.is_reserved
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_unspecified
    )


class NetworkBudget:
    def __init__(self):
        self.deadline = time.monotonic() + 90
        self.bytes = 0
        self.requests = 0
        self.hosts = set()
        self.error = None

    def guard(self):
        check()
        if time.monotonic() >= self.deadline:
            self.fail("LOCAL_TIMEOUT")

    def fail(self, code):
        self.error = code
        raise TransportError(code)


def validate_url(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or len(url) > 16384
        or not (
            host in ALLOWED_EXACT
            or any(host == root or host.endswith("." + root) for root in ALLOWED_ROOTS)
        )
    ):
        raise ValueError("LOCAL_UNSAFE_URL")
    return parsed


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Resolve once; never pass the hostname to a second DNS resolver.
        answers = socket.getaddrinfo(self.host, 443, type=socket.SOCK_STREAM)
        if not answers or any(not is_public(a[4][0]) for a in answers):
            raise OSError("LOCAL_UNSAFE_DNS")
        last_error = None
        for family, socktype, proto, _, address in answers:
            check()
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(self.timeout)
            try:
                sock.connect(address)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except OSError as error:
                sock.close()
                last_error = error
        raise last_error or OSError("LOCAL_NETWORK_ERROR")


class OnDeviceRH(RequestHandler):
    _SUPPORTED_URL_SCHEMES = ("https",)
    _SUPPORTED_PROXY_SCHEMES = ()
    RH_NAME = "MediaDrop pinned HTTPS"
    budget = None

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        extensions.pop("cookiejar", None)  # Deliberately never used.
        extensions.pop("timeout", None)

    def _send(self, request):
        budget = self.budget
        url, method, body = request.url, request.method, request.data
        if body is not None and (
            not isinstance(body, bytes) or len(body) > 2 * 1024 * 1024
        ):
            budget.fail("LOCAL_RESOURCE_LIMIT")
        headers = dict(self._get_headers(request))
        headers = {
            k: v
            for k, v in headers.items()
            if k.lower()
            not in {
                "cookie",
                "authorization",
                "proxy-authorization",
                "host",
                "accept-encoding",
            }
        }
        headers["Accept-Encoding"] = "identity"
        for redirect in range(4):
            budget.guard()
            try:
                parsed = validate_url(url)
            except ValueError:
                budget.fail("LOCAL_UNSAFE_URL")
            budget.requests += 1
            budget.hosts.add(parsed.hostname)
            if budget.requests > 40:
                budget.fail("LOCAL_RESOURCE_LIMIT")
            connection = PinnedHTTPSConnection(
                parsed.hostname,
                timeout=min(10, max(1, budget.deadline - time.monotonic())),
                context=ssl.create_default_context(cafile=certifi.where()),
            )
            try:
                target = parsed.path or "/"
                if parsed.query:
                    target += "?" + parsed.query
                connection.request(method, target, body=body, headers=headers)
                response = connection.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    if not location or redirect == 3:
                        budget.fail("LOCAL_REDIRECT_ERROR")
                    url = urljoin(url, location)
                    if (
                        response.status == 303
                        or response.status in {301, 302}
                        and method == "POST"
                    ):
                        method, body = "GET", None
                    continue
                encoding = response.getheader("Content-Encoding", "identity").lower()
                if encoding != "identity":
                    budget.fail("LOCAL_ENCODING_ERROR")
                length = response.getheader("Content-Length")
                if length and (not length.isdigit() or int(length) > 12 * 1024 * 1024):
                    budget.fail("LOCAL_RESOURCE_LIMIT")
                content = bytearray()
                while True:
                    budget.guard()
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    content.extend(chunk)
                    budget.bytes += len(chunk)
                    if (
                        len(content) > 12 * 1024 * 1024
                        or budget.bytes > 32 * 1024 * 1024
                    ):
                        budget.fail("LOCAL_RESOURCE_LIMIT")
                safe_headers = {
                    k: v
                    for k, v in response.getheaders()
                    if k.lower() not in {"set-cookie", "transfer-encoding"}
                }
                result = Response(
                    io.BytesIO(content), url, safe_headers, response.status
                )
                if response.status >= 400:
                    raise HTTPError(result)
                return result
            except (OSError, http.client.HTTPException) as error:
                budget.error = (
                    "LOCAL_TLS_ERROR"
                    if isinstance(error, ssl.SSLError)
                    else "REMOTE_UNAVAILABLE"
                )
                raise TransportError(budget.error) from None
            finally:
                connection.close()
        budget.fail("LOCAL_REDIRECT_ERROR")
