# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.12.9 AS uv
FROM node:22.23.2-bookworm-slim AS node-runtime

FROM python:3.13.5-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        ffmpeg=7:5.1.9-0+deb12u1 \
        libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 mediadrop \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mediadrop

COPY --from=uv /uv /uvx /bin/
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

RUN ffmpeg -version 2>&1 | grep --max-count=1 '^ffmpeg version 5\.1\.9' \
    && ffprobe -version 2>&1 | grep --max-count=1 '^ffprobe version 5\.1\.9' \
    && node --version | grep --max-count=1 '^v22\.23\.2$'

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
RUN uv sync --frozen --no-dev

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/health', timeout=3).read()"

CMD ["python", "-m", "app.serve"]
