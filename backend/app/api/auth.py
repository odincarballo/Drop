from typing import Annotated, cast

from fastapi import Depends, Header, Request

from app.services.access import APIAccessGuard


def get_access_guard(request: Request) -> APIAccessGuard:
    return cast(APIAccessGuard, request.app.state.access_guard)


def require_api_access(
    request: Request,
    guard: Annotated[APIAccessGuard, Depends(get_access_guard)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    guard.authorize(authorization, request.client.host if request.client else None)
