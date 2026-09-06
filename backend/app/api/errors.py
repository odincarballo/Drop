import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.core.errors import ApplicationError
from app.models.media import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorDetail(code=code, message=message))
    return JSONResponse(status_code=status_code, content=body.model_dump(by_alias=True))


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApplicationError)
    async def application_error(request: Request, exc: ApplicationError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo raw URLs, signed query strings or credentials from invalid input.
        return error_response(422, "INVALID_REQUEST", "Envía una URL HTTP o HTTPS válida.")

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, "HTTP_ERROR", "La solicitud no se pudo completar.")

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # Exception messages/tracebacks can contain signed URLs; log only the type here.
        logger.error("Unhandled backend error: %s", type(exc).__name__)
        return error_response(
            500, "INTERNAL_ERROR", "Ocurrió un error interno. Inténtalo de nuevo."
        )
