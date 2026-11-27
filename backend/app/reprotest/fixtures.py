"""Build and verify the two disk-backed media fixtures for reprotest."""

import hashlib
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path

FIXTURE_DIRECTORY = Path(__file__).resolve().parent
LEGACY_NAME = "c4-legacy.m4a"


@dataclass(frozen=True)
class Fixture:
    name: str
    size: int
    sha256: str

    def verify(self, directory: Path) -> Path:
        path = directory / self.name
        with path.open("rb") as source:
            if (
                path.stat().st_size != self.size
                or hashlib.file_digest(source, "sha256").hexdigest() != self.sha256
            ):
                raise ValueError(f"Unexpected reprotest fixture: {self.name}")
        return path


SMALL = Fixture(
    "c4-synthetic.m4a",
    2_440_018,
    "76c73ce767d3cfa93778ccbd70fc250d1c5568a57ca3229f96de07a4be8ccaf6",
)
LARGE = Fixture(
    "c4-performance-99mib.m4a",
    99 * 1024**2,
    "250bba1a0ff2f113e94a73d189a3eae16887d620406a0815ca7870419652cdb2",
)


def generate_large_fixture(directory: Path) -> Path:
    small = SMALL.verify(directory)
    padding = LARGE.size - SMALL.size
    target = directory / LARGE.name
    with small.open("rb") as source, target.open("xb") as output:
        shutil.copyfileobj(source, output)
        output.write(struct.pack(">I4s", padding, b"free"))
        zeros = bytes(1024**2)
        blocks, tail = divmod(padding - 8, len(zeros))
        for _ in range(blocks):
            output.write(zeros)
        output.write(zeros[:tail])
    return LARGE.verify(directory)


if __name__ == "__main__":
    generate_large_fixture(FIXTURE_DIRECTORY)
