import re
import shutil
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from uuid import uuid4

from app.storage.base import TemporaryStorage


class LocalTemporaryStorage(TemporaryStorage):
    """Single-process storage. Never accept a client-supplied filesystem path."""

    _owned_name = re.compile(r"mediadrop-[0-9a-f]{32}")

    def __init__(self, root: Path, ttl_seconds: int) -> None:
        self.root = root
        self.ttl_seconds = ttl_seconds
        self._active: set[Path] = set()
        self._lock = RLock()

    def create_workspace(self) -> Path:
        with self._lock:
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            directory = self.root / f"mediadrop-{uuid4().hex}"
            directory.mkdir(mode=0o700)
            self._active.add(directory)
            return directory

    def preserve_workspace(self, path: Path) -> None:
        with self._lock:
            if path.parent == self.root and self._owned_name.fullmatch(path.name):
                path.touch(exist_ok=True)
                self._active.discard(path)

    def delete_workspace(self, path: Path) -> None:
        with self._lock:
            if path.parent != self.root or not self._owned_name.fullmatch(path.name):
                raise ValueError("Workspace is not owned by MediaDrop")
            try:
                if path.exists() and not path.is_symlink():
                    shutil.rmtree(path)
            finally:
                self._active.discard(path)

    @contextmanager
    def workspace(self) -> Iterator[Path]:
        directory = self.create_workspace()
        try:
            yield directory
        finally:
            self.delete_workspace(directory)

    def cleanup_expired(self) -> int:
        removed = 0
        with self._lock:
            if not self.root.exists():
                return 0
            cutoff = time.time() - self.ttl_seconds
            for path in self.root.iterdir():
                if (
                    self._owned_name.fullmatch(path.name)
                    and path not in self._active
                    and not path.is_symlink()
                    and path.is_dir()
                    and path.stat().st_mtime < cutoff
                ):
                    shutil.rmtree(path)
                    removed += 1
        return removed
