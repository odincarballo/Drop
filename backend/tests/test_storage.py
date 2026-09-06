import os
from pathlib import Path
from uuid import uuid4

import pytest

from app.storage.local import LocalTemporaryStorage


def test_workspace_is_deleted_after_use(tmp_path: Path) -> None:
    storage = LocalTemporaryStorage(tmp_path / "storage", 60)
    with storage.workspace() as workspace:
        assert workspace.is_dir()
        (workspace / "clip.mp4").write_bytes(b"test")
    assert not workspace.exists()


def test_workspace_is_deleted_on_error(tmp_path: Path) -> None:
    storage = LocalTemporaryStorage(tmp_path / "storage", 60)
    with pytest.raises(RuntimeError), storage.workspace() as workspace:
        raise RuntimeError("processing failed")
    assert not workspace.exists()


def test_cleanup_removes_only_expired_owned_directories(tmp_path: Path) -> None:
    storage = LocalTemporaryStorage(tmp_path, 60)
    stale = tmp_path / f"mediadrop-{uuid4().hex}"
    stale.mkdir()
    os.utime(stale, (0, 0))
    foreign = tmp_path / "not-ours"
    foreign.mkdir()
    os.utime(foreign, (0, 0))
    linked = tmp_path / f"mediadrop-{uuid4().hex}"
    linked.symlink_to(foreign, target_is_directory=True)
    with storage.workspace() as active:
        os.utime(active, (0, 0))
        assert storage.cleanup_expired() == 1
        assert active.exists()
        assert foreign.exists()
        assert linked.is_symlink()
        assert not stale.exists()


def test_fresh_workspace_survives_cleanup(tmp_path: Path) -> None:
    storage = LocalTemporaryStorage(tmp_path, 60)
    fresh = tmp_path / f"mediadrop-{uuid4().hex}"
    fresh.mkdir()
    assert storage.cleanup_expired() == 0
    assert fresh.exists()


def test_preserved_job_workspace_is_removed_after_ttl(tmp_path: Path) -> None:
    storage = LocalTemporaryStorage(tmp_path, 60)
    workspace = storage.create_workspace()
    (workspace / "clip.mp4").write_bytes(b"test")
    storage.preserve_workspace(workspace)
    os.utime(workspace, (0, 0))
    assert storage.cleanup_expired() == 1
    assert not workspace.exists()
