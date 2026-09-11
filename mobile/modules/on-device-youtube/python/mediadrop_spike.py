"""Isolated on-device analysis only. Packaged code, no CLI or download jobs."""

import functools
import json
import math
import re
import sys
import time
from urllib.parse import parse_qs, urlsplit

from _mediadrop_native import check, run_js
from safe_network import NetworkBudget, OnDeviceRH
from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP, ScriptSource
from yt_dlp.extractor.youtube.jsc.provider import register_preference, register_provider
from yt_dlp.utils import DownloadError
from yt_dlp.version import __version__

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
js_calls = 0


def prohibit_processes(event, args):
    if event in {
        "subprocess.Popen",
        "os.system",
        "os.fork",
        "os.posix_spawn",
        "os.exec",
    }:
        raise RuntimeError("LOCAL_PROCESS_FORBIDDEN")


sys.addaudithook(prohibit_processes)


@register_provider
class MediaDropEmbeddedJCP(EJSBaseJCP):
    JS_RUNTIME_NAME = "embedded-quickjs-ng"
    PROVIDER_VERSION = "0.1.0"

    def is_available(self):
        return self._available

    def _iter_script_sources(self):
        # Keep upstream hash/version checks; allow only the bundled EJS package.
        yield ScriptSource.PYPACKAGE, self._pypackage_source

    def _run_js_runtime(self, script):
        global js_calls
        check()
        js_calls += 1
        return run_js(script)


@register_preference(MediaDropEmbeddedJCP)
def embedded_preference(provider, requests):
    return 10000


class SilentLogger:
    def debug(self, message):
        pass

    def info(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


class LocalYoutubeDL(YoutubeDL):
    @functools.cached_property
    def _request_director(self):
        return self.build_request_director([OnDeviceRH])


def canonical_url(raw):
    parsed = urlsplit(raw)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 80, 443)
        or len(raw) > 2048
    ):
        raise ValueError("UNSUPPORTED_URL")
    host = parsed.hostname
    query = parse_qs(parsed.query, keep_blank_values=True)
    video_id = None
    if host == "youtu.be":
        video_id = parsed.path.strip("/")
    elif host in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
    }:
        if parsed.path.rstrip("/") == "/watch" and len(query.get("v", [])) == 1:
            video_id = query["v"][0]
        elif parsed.path.startswith("/shorts/"):
            video_id = parsed.path.removeprefix("/shorts/").rstrip("/")
    if not video_id or not VIDEO_ID.fullmatch(video_id):
        raise ValueError(
            "PLAYLIST_NOT_SUPPORTED" if "list" in query else "UNSUPPORTED_URL"
        )
    return f"https://www.youtube.com/watch?v={video_id}"


def number(value):
    return (
        value
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
        else None
    )


def normalize(payload):
    if payload.get("_type") in {"playlist", "multi_video"}:
        raise ValueError("PLAYLIST_NOT_SUPPORTED")
    if payload.get("is_live") or payload.get("live_status") in {
        "is_live",
        "is_upcoming",
        "post_live",
    }:
        raise ValueError("LIVE_NOT_SUPPORTED")
    if payload.get("availability") == "private":
        raise ValueError("PRIVATE_CONTENT")
    if payload.get("availability") in {"premium_only", "subscriber_only", "needs_auth"}:
        raise ValueError("LOGIN_REQUIRED")
    video_id = payload.get("id", "")
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("YOUTUBE_EXTRACTION_FAILED")
    formats = payload.get("formats", [])
    if formats and all(item.get("has_drm") for item in formats):
        raise ValueError("DRM_NOT_SUPPORTED")
    video, audio = [], []
    for item in formats:
        if item.get("has_drm") or item.get("ext") not in {"mp4", "m4a", "webm"}:
            continue
        has_video = item.get("vcodec") not in {None, "none"}
        has_audio = item.get("acodec") not in {None, "none"}
        if not has_video and not has_audio:
            continue
        height = number(item.get("height"))
        record = {
            "id": str(item["format_id"]),
            "container": item.get("ext"),
            "codec": item.get("vcodec") if has_video else item.get("acodec"),
            "height": height,
            "width": number(item.get("width")),
            "resolution": f"{height}p" if height else None,
            "fps": number(item.get("fps")),
            "hasAudio": has_audio,
            "bitrateKbps": number(item.get("tbr") if has_video else item.get("abr")),
            "estimatedSize": number(
                item.get("filesize") or item.get("filesize_approx")
            ),
            "protocol": item.get("protocol"),
        }
        (video if has_video else audio).append(record)
    if not video and not audio:
        raise ValueError("FORMAT_NOT_AVAILABLE")
    thumbnail = payload.get("thumbnail")
    if thumbnail:
        parsed = urlsplit(thumbnail)
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(
            ".ytimg.com"
        ):
            thumbnail = None
    return {
        "id": video_id,
        "title": str(payload.get("title") or "YouTube")[:240],
        "duration": number(payload.get("duration")),
        "thumbnail": thumbnail,
        "videoFormats": video[:100],
        "audioFormats": audio[:30],
        "resolutions": sorted({item["height"] for item in video if item["height"]}),
    }


def classify(message):
    text = message.casefold()
    if "drm" in text:
        return "DRM_NOT_SUPPORTED"
    if "private" in text:
        return "PRIVATE_CONTENT"
    if "sign in" in text or "login" in text or "members-only" in text:
        return "LOGIN_REQUIRED"
    if "unavailable" in text or "removed" in text:
        return "VIDEO_UNAVAILABLE"
    return "YOUTUBE_EXTRACTION_FAILED"


def analyze(raw):
    global js_calls
    started = time.monotonic()
    js_calls = 0
    budget = NetworkBudget()
    OnDeviceRH.budget = budget
    result = {}
    try:
        url = canonical_url(raw)
        check()
        # Exercise the compiled JS engine even when a video needs no EJS challenge.
        if run_js("console.log(JSON.stringify({ok: 6 * 7 === 42}));") != '{"ok":true}':
            raise ValueError("LOCAL_JS_FAILED")
        options = {
            "quiet": True,
            "no_warnings": True,
            "logger": SilentLogger(),
            "ignoreconfig": True,
            "cachedir": False,
            "noplaylist": True,
            "skip_download": True,
            "allowed_extractors": ["youtube"],
            "js_runtimes": {},
            "remote_components": set(),
            "proxy": "",
            "cookiefile": None,
            "cookiesfrombrowser": None,
            "usenetrc": False,
            "socket_timeout": 10,
            "retries": 0,
            "extractor_retries": 0,
            "fragment_retries": 0,
        }
        with LocalYoutubeDL(options) as downloader:
            payload = downloader.extract_info(url, download=False, process=False)
        check()
        result["metadata"] = normalize(payload)
    except DownloadError as error:
        result["error"] = {"code": budget.error or classify(str(error))}
    except ValueError as error:
        code = str(error)
        result["error"] = {
            "code": code
            if re.fullmatch(r"[A-Z_]+", code)
            else "YOUTUBE_EXTRACTION_FAILED"
        }
    except Exception as error:
        result["error"] = {
            "code": budget.error
            or (
                "LOCAL_CANCELLED"
                if str(error) == "LOCAL_CANCELLED"
                else "LOCAL_RUNTIME_FAILED"
            )
        }
        result["exceptionType"] = type(error).__name__
    result.update(
        {
            "ytDlpVersion": __version__,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            "jsChallengeCalls": js_calls,
            "networkRequests": budget.requests,
            "metadataBytes": budget.bytes,
            "requestHosts": sorted(budget.hosts),
        }
    )
    return json.dumps(result, allow_nan=False)
