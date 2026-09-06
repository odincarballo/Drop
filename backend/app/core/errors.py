class ApplicationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class UnsafeURLError(ApplicationError):
    def __init__(self) -> None:
        super().__init__("UNSAFE_URL", "La URL debe apuntar a un destino HTTP(S) público.")


class DownloadUnavailableError(ApplicationError):
    def __init__(self) -> None:
        super().__init__("DOWNLOAD_UNAVAILABLE", "Las descargas aún no están habilitadas.", 501)
