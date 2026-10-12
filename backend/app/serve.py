import uvicorn

from app.core.config import Settings


def main() -> None:
    # pydantic-settings loads the required token from the environment at runtime.
    settings = Settings()  # type: ignore[call-arg]
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        log_level=settings.log_level.lower(),
        workers=1,
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
