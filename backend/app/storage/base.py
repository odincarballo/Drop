from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from pathlib import Path


class TemporaryStorage(ABC):
    @abstractmethod
    def create_workspace(self) -> Path:
        """Create a private active workspace."""

    @abstractmethod
    def preserve_workspace(self, path: Path) -> None:
        """Make a completed workspace eligible for TTL cleanup."""

    @abstractmethod
    def delete_workspace(self, path: Path) -> None:
        """Delete an owned workspace idempotently."""

    @abstractmethod
    def workspace(self) -> AbstractContextManager[Path]:
        """Private directory removed on exit, including on processing failure."""

    @abstractmethod
    def cleanup_expired(self) -> int:
        """Remove abandoned workspaces owned by this storage namespace."""
