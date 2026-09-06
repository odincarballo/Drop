import asyncio
from collections.abc import Sequence


async def terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return
    try:
        async with asyncio.timeout(2):
            await process.wait()
    except TimeoutError:
        try:
            process.kill()
        except ProcessLookupError:
            return
        await process.wait()


async def read_limited(stream: asyncio.StreamReader | None, maximum: int) -> bytes:
    if stream is None:
        return b""
    captured = bytearray()
    while chunk := await stream.read(8192):
        remaining = maximum - len(captured)
        if remaining > 0:
            captured.extend(chunk[:remaining])
    return bytes(captured)


async def run_captured(
    arguments: Sequence[str], *, execution_timeout: float, maximum_output: int = 256 * 1024
) -> tuple[int, bytes, bytes]:
    process = await asyncio.create_subprocess_exec(
        *arguments,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_task = asyncio.create_task(read_limited(process.stdout, maximum_output))
    stderr_task = asyncio.create_task(read_limited(process.stderr, maximum_output))
    try:
        async with asyncio.timeout(execution_timeout):
            return_code = await process.wait()
        return return_code, await stdout_task, await stderr_task
    except BaseException:
        await terminate_process(process)
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
        raise
