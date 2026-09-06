import hashlib
import secrets
import time
from collections import OrderedDict, deque
from threading import RLock

from pydantic import SecretStr

from app.core.errors import ApplicationError


class SlidingWindowRateLimiter:
    """Bounded, single-process limiter for a personal single-instance deployment."""

    def __init__(self, limit: int, window_seconds: float, max_buckets: int = 4096) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_buckets = max_buckets
        self._events: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = RLock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events.pop(key, deque())
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                self._events[key] = events
                raise ApplicationError(
                    "RATE_LIMITED",
                    "Se hicieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
                    429,
                )
            events.append(now)
            self._events[key] = events
            while len(self._events) > self.max_buckets:
                self._events.popitem(last=False)


class APIAccessGuard:
    """Authenticate without storing or logging the presented bearer token."""

    def __init__(self, api_token: SecretStr, request_limit: int, window_seconds: float) -> None:
        self._expected_token = api_token.get_secret_value()
        self._ip_limiter = SlidingWindowRateLimiter(request_limit, window_seconds)
        self._token_limiter = SlidingWindowRateLimiter(request_limit, window_seconds)

    def authorize(self, authorization: str | None, client_host: str | None) -> None:
        self._ip_limiter.check(f"ip:{client_host or 'unknown'}")
        if authorization is None:
            raise ApplicationError(
                "AUTH_REQUIRED", "Configura el token de acceso de MediaDrop.", 401
            )
        scheme, separator, token = authorization.partition(" ")
        if separator != " " or scheme.lower() != "bearer" or not token:
            raise ApplicationError("AUTH_INVALID", "El token de acceso no es válido.", 403)
        if not secrets.compare_digest(token, self._expected_token):
            raise ApplicationError("AUTH_INVALID", "El token de acceso no es válido.", 403)
        fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
        self._token_limiter.check(f"token:{fingerprint}")
