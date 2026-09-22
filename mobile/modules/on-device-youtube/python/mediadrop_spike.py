"""Isolated on-device YouTube engine. Packaged code, no CLI or subprocesses."""

import functools
import hashlib
import json
import math
import re
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from _mediadrop_native import check, get_js_diagnostics, run_js
from safe_network import NetworkBudget, OnDeviceRH
from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP, ScriptSource
from yt_dlp.extractor.youtube.jsc.provider import (
    JsChallengeRequest,
    JsChallengeType,
    NChallengeInput,
    register_preference,
    register_provider,
)
from yt_dlp.utils import DownloadError
from yt_dlp.version import __version__
from yt_dlp_ejs import version as ejs_version

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
EJS_FIXTURE_PLAYER_ID = "74edf1a3"
EJS_FIXTURE_PLAYER_URL = (
    "https://www.youtube.com/s/player/74edf1a3/"
    "player_ias.vflset/en_US/base.js"
)
EJS_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "md_fixtures/player-74edf1a3-main.js"
)
EJS_FIXTURE_SHA256 = (
    "ed9a4ea0646332a6b6c973ebe5a915c62c43db89bb2bb1a31eba07d906ef8ff7"
)
EJS_FIXTURE_INPUT = "IlLiA21ny7gqA2m4p37"
EJS_FIXTURE_EXPECTED = "9nRTxrbM1f0yHg"
js_calls = 0
native_js_calls = 0
process_attempts = 0
ejs_diagnostics = {}
ANALYSIS_TTL_SECONDS = 10 * 60
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_VIDEO_BYTES = 50 * 1024 * 1024
ALLOWED_AUDIO_HEADERS = {
    "accept",
    "accept-language",
    "origin",
    "referer",
    "user-agent",
}
FORBIDDEN_AUDIO_HEADERS = {"authorization", "cookie", "proxy-authorization"}
analysis_sessions = {}


def prohibit_processes(event, args):
    global process_attempts
    if event in {
        "subprocess.Popen",
        "os.system",
        "os.fork",
        "os.posix_spawn",
        "os.exec",
    }:
        process_attempts += 1
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
        global ejs_diagnostics, js_calls
        check()
        js_calls += 1
        ejs_diagnostics.update(
            {
                "providerInvoked": True,
                "runJsInvoked": True,
                "quickJsCompletedNormally": False,
                "scriptLength": len(script.encode("utf-8")),
            }
        )
        try:
            response = execute_js(script)
        except Exception as error:
            ejs_diagnostics["native"] = native_js_diagnostics()
            ejs_diagnostics["runtimeError"] = sanitize_runtime_error(error)
            raise
        ejs_diagnostics["native"] = native_js_diagnostics()
        ejs_diagnostics.update(inspect_ejs_response(response))
        ejs_diagnostics["quickJsCompletedNormally"] = True
        return response


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


def local_options():
    return {
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
        "geo_bypass": False,
        "socket_timeout": 10,
        "retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
    }


def load_ejs_fixture():
    content = EJS_FIXTURE_PATH.read_bytes()
    if hashlib.sha256(content).hexdigest() != EJS_FIXTURE_SHA256:
        raise ValueError("EJS_FIXTURE_INVALID")
    return content.decode("utf-8")


def execute_js(script):
    global native_js_calls
    native_js_calls += 1
    return run_js(script)


def native_js_diagnostics():
    try:
        value = json.loads(get_js_diagnostics())
    except (TypeError, ValueError):
        return {"diagnosticError": "NATIVE_DIAGNOSTICS_INVALID"}
    if not isinstance(value, dict):
        return {"diagnosticError": "NATIVE_DIAGNOSTICS_INVALID"}
    allowed = {
        "scriptBytes",
        "memoryLimitBytes",
        "stackLimitBytes",
        "timeoutSeconds",
        "outputLimitBytes",
        "capturedBytes",
        "consoleCalls",
        "interrupted",
        "timedOut",
        "cancelled",
        "completedNormally",
        "quickJsMallocBytes",
        "quickJsMemoryUsedBytes",
        "captureError",
        "exceptionName",
        "exceptionMessage",
        "exceptionStack",
        "errorCode",
        "elapsedSeconds",
    }
    return {key: value[key] for key in allowed if key in value}


def sanitize_runtime_error(error):
    message = str(error)
    if re.fullmatch(r"LOCAL_[A-Z_]+", message):
        return message
    return type(error).__name__


def inspect_ejs_response(response):
    diagnostics = {
        "responseType": type(response).__name__,
        "responseLength": len(response.encode("utf-8"))
        if isinstance(response, str)
        else None,
        "parserError": None,
    }
    if not isinstance(response, str):
        diagnostics["responsePreview"] = f"<{type(response).__name__}>"
        return diagnostics
    try:
        parsed = json.loads(response)
    except json.JSONDecodeError as error:
        diagnostics["parserError"] = (
            f"JSONDecodeError line {error.lineno} column {error.colno}"
        )
        diagnostics["responsePreview"] = response[:240]
        return diagnostics
    if isinstance(parsed, dict):
        preview = {
            "type": parsed.get("type"),
            "responses": parsed.get("responses"),
            "preprocessedPlayerLength": len(parsed.get("preprocessed_player", ""))
            if isinstance(parsed.get("preprocessed_player"), str)
            else 0,
        }
        diagnostics["responsePayloadType"] = parsed.get("type")
        diagnostics["responsePreview"] = json.dumps(preview, ensure_ascii=True)[:500]
    else:
        diagnostics["responsePreview"] = repr(parsed)[:240]
    return diagnostics


def verify_js_bridge_contract():
    console_output = execute_js(
        'console.log("alpha", 7); console.log(JSON.stringify({ok: true}));'
    )
    return_output = execute_js("21 * 2;")
    exception_caught = False
    try:
        execute_js('throw new Error("fixture error");')
    except RuntimeError as error:
        exception_caught = sanitize_runtime_error(error) == "LOCAL_JS_EVAL_FAILED"
    diagnostics = {
        "consoleLogCaptured": console_output == 'alpha 7\n{"ok":true}\n',
        "evaluationReturnIgnored": return_output == "",
        "javascriptExceptionCaught": exception_caught,
    }
    if not all(diagnostics.values()):
        raise ValueError("EJS_BRIDGE_CONTRACT_INVALID")
    return diagnostics


def run_ejs_fixture():
    """Run an upstream n-challenge vector through yt-dlp's actual JSC director."""
    global ejs_diagnostics, js_calls, native_js_calls
    started = time.monotonic()
    js_calls = 0
    native_js_calls = 0
    ejs_diagnostics = {
        "providerInvoked": False,
        "runJsInvoked": False,
        "quickJsCompletedNormally": False,
        "quickJsFilesystemAttempts": 0,
        "quickJsNetworkAttempts": 0,
    }
    attempts_before = process_attempts
    result = {}
    try:
        check()
        ejs_diagnostics.update(verify_js_bridge_contract())
        player = load_ejs_fixture()
        with LocalYoutubeDL(local_options()) as downloader:
            extractor = downloader.get_info_extractor("Youtube")
            extractor.initialize()
            director = extractor._jsc_director
            provider_key = MediaDropEmbeddedJCP.PROVIDER_KEY
            if provider_key not in director.providers:
                raise ValueError("EJS_PROVIDER_NOT_REGISTERED")
            provider = director.providers[provider_key]
            if not provider.is_available():
                raise ValueError("EJS_PROVIDER_UNAVAILABLE")

            # Keep the fixture deterministic and offline on-device while still
            # traversing director.bulk_solve -> provider.bulk_solve ->
            # EJSBaseJCP._real_bulk_solve -> _construct_stdin -> run_js.
            provider._get_player = lambda video_id, player_url: player
            request = JsChallengeRequest(
                type=JsChallengeType.N,
                video_id="fixture-ejs",
                input=NChallengeInput(
                    player_url=EJS_FIXTURE_PLAYER_URL,
                    challenges=[EJS_FIXTURE_INPUT],
                ),
            )
            responses = director.bulk_solve([request])
        check()
        if len(responses) != 1:
            raise ValueError("EJS_RESPONSE_MISSING")
        actual = responses[0][1].output.results.get(EJS_FIXTURE_INPUT)
        if actual != EJS_FIXTURE_EXPECTED or js_calls < 1:
            raise ValueError("EJS_RESPONSE_INVALID")
        result["fixture"] = {
            "status": "passed",
            "challengeType": "n",
            "challengeInput": EJS_FIXTURE_INPUT,
            "expected": EJS_FIXTURE_EXPECTED,
            "actual": actual,
            "playerId": EJS_FIXTURE_PLAYER_ID,
            "playerSha256": EJS_FIXTURE_SHA256,
            "provider": provider_key,
            "providerRegistered": True,
            "scriptSource": "yt-dlp-ejs bundled Python package",
            "ejsVersion": ejs_version,
        }
    except ValueError as error:
        code = str(error)
        result["error"] = {
            "code": code if re.fullmatch(r"[A-Z_]+", code) else "EJS_FIXTURE_FAILED"
        }
    except Exception as error:
        result["error"] = {"code": "EJS_FIXTURE_FAILED"}
        result["exceptionType"] = type(error).__name__
    result.update(
        {
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "jsChallengeCalls": js_calls,
            "nativeRunJsCalls": native_js_calls,
            "processAttempts": process_attempts - attempts_before,
            "subprocessUsed": False,
            "quickJsFilesystem": False,
            "quickJsNetwork": False,
            "diagnostics": ejs_diagnostics,
        }
    )
    return json.dumps(result, allow_nan=False)


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


def positive_integer(value):
    value = number(value)
    return int(value) if value and int(value) == value else None


def stream_url(value):
    if not isinstance(value, str) or len(value) > 16384:
        raise ValueError("AUDIO_URL_INVALID")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
        or not (host == "googlevideo.com" or host.endswith(".googlevideo.com"))
    ):
        raise ValueError("AUDIO_URL_INVALID")
    return value


def is_direct_m4a_audio(item):
    if not isinstance(item, dict):
        return False
    codec = str(item.get("acodec") or "").lower()
    protocol = item.get("protocol")
    if (
        item.get("has_drm")
        or item.get("ext") != "m4a"
        or item.get("vcodec") not in {None, "none"}
        or not (codec.startswith("mp4a.") or codec == "aac")
        or (protocol is not None and str(protocol).lower() != "https")
        or item.get("fragments")
        or item.get("manifest_url")
    ):
        return False
    try:
        stream_url(item.get("url"))
    except ValueError:
        return False
    return True


def is_direct_mp4_video(item):
    if not isinstance(item, dict):
        return False
    codec = str(item.get("vcodec") or "").lower()
    audio_codec = item.get("acodec")
    protocol = item.get("protocol")
    if (
        item.get("has_drm")
        or item.get("ext") != "mp4"
        or not (codec.startswith("avc1") or codec.startswith("h264"))
        or audio_codec not in {None, "none"}
        or (protocol is not None and str(protocol).lower() != "https")
        or item.get("fragments")
        or item.get("manifest_url")
    ):
        return False
    try:
        url = stream_url(item.get("url"))
    except ValueError:
        return False
    return urlsplit(url).path.rstrip("/").endswith("/videoplayback")


def preferred_audio(formats):
    candidates = [
        item
        for item in formats
        if is_direct_m4a_audio(item)
        and (
            (positive_integer(item.get("filesize") or item.get("filesize_approx")))
            or 0
        )
        <= MAX_AUDIO_BYTES
    ]
    if not candidates:
        return None

    def rank(item):
        codec = str(item.get("acodec") or "").lower()
        return (
            int(codec.startswith("mp4a.40.2")),
            number(item.get("abr")) or number(item.get("tbr")) or 0,
            str(item.get("format_id") or ""),
        )

    return max(candidates, key=rank)


def preferred_video(formats):
    candidates = [
        item
        for item in formats
        if is_direct_mp4_video(item)
        and (positive_integer(item.get("height")) or 0) <= 720
        and (
            (positive_integer(item.get("filesize") or item.get("filesize_approx")))
            or 0
        )
        <= MAX_VIDEO_BYTES
    ]
    if not candidates:
        return None

    def rank(item):
        height = positive_integer(item.get("height")) or 0
        codec = str(item.get("vcodec") or "").lower()
        return (
            int(height == 360),
            int(codec.startswith("avc1")),
            -abs(height - 360),
            number(item.get("tbr")) or 0,
            str(item.get("format_id") or ""),
        )

    return max(candidates, key=rank)


def clean_sessions(now=None):
    current = time.monotonic() if now is None else now
    expired = [
        key
        for key, session in analysis_sessions.items()
        if current - session["created"] >= ANALYSIS_TTL_SECONDS
    ]
    for key in expired:
        analysis_sessions.pop(key, None)


def create_session(url, payload):
    clean_sessions()
    compatible = {
        str(item.get("format_id"))
        for item in payload.get("formats", [])
        if is_direct_m4a_audio(item)
    }
    compatible_video = {
        str(item.get("format_id"))
        for item in payload.get("formats", [])
        if is_direct_mp4_video(item)
    }
    analysis_id = uuid.uuid4().hex
    analysis_sessions[analysis_id] = {
        "created": time.monotonic(),
        "url": url,
        "title": str(payload.get("title") or "YouTube")[:240],
        "audioFormatIds": compatible,
        "videoFormatIds": compatible_video,
    }
    return (
        analysis_id,
        preferred_audio(payload.get("formats", [])),
        preferred_video(payload.get("formats", [])),
    )


def safe_file_name(title, extension="m4a"):
    stem = re.sub(r"[^\w .-]", "_", str(title), flags=re.UNICODE).strip(" .")
    fallback = "YouTube audio" if extension == "m4a" else "YouTube video"
    return f"{(stem[:100] or fallback)}.{extension}"


def audio_headers(payload, item, forbidden_code="AUDIO_HEADERS_FORBIDDEN"):
    merged = {}
    for source in (payload.get("http_headers"), item.get("http_headers")):
        if isinstance(source, dict):
            merged.update(source)
    result = {}
    for raw_name, raw_value in merged.items():
        name = str(raw_name).strip().lower()
        if name in FORBIDDEN_AUDIO_HEADERS and raw_value:
            raise ValueError(forbidden_code)
        if (
            name in ALLOWED_AUDIO_HEADERS
            and isinstance(raw_value, str)
            and len(raw_value) <= 1024
            and "\r" not in raw_value
            and "\n" not in raw_value
        ):
            result["-".join(part.capitalize() for part in name.split("-"))] = raw_value
    return result


def build_audio_descriptor(payload, format_id):
    item = next(
        (
            candidate
            for candidate in payload.get("formats", [])
            if str(candidate.get("format_id")) == format_id
        ),
        None,
    )
    if item is None:
        raise ValueError("FORMAT_NOT_AVAILABLE")
    if not is_direct_m4a_audio(item):
        raise ValueError("AUDIO_FORMAT_NOT_SUPPORTED")
    expected = positive_integer(item.get("filesize"))
    estimated = positive_integer(item.get("filesize_approx"))
    if (expected and expected > MAX_AUDIO_BYTES) or (
        estimated and estimated > MAX_AUDIO_BYTES
    ):
        raise ValueError("AUDIO_FILE_TOO_LARGE")
    return {
        "url": stream_url(item.get("url")),
        "headers": audio_headers(payload, item),
        "fileName": safe_file_name(payload.get("title")),
        "formatId": format_id,
        "container": "m4a",
        "codec": str(item.get("acodec") or "aac")[:100],
        "bitrateKbps": number(item.get("abr") or item.get("tbr")),
        "expectedBytes": expected,
        "estimatedBytes": estimated,
    }


def build_video_descriptor(payload, format_id):
    item = next(
        (
            candidate
            for candidate in payload.get("formats", [])
            if str(candidate.get("format_id")) == format_id
        ),
        None,
    )
    if item is None:
        raise ValueError("FORMAT_NOT_AVAILABLE")
    if not is_direct_mp4_video(item):
        raise ValueError("VIDEO_FORMAT_NOT_SUPPORTED")
    expected = positive_integer(item.get("filesize"))
    estimated = positive_integer(item.get("filesize_approx"))
    if (expected and expected > MAX_VIDEO_BYTES) or (
        estimated and estimated > MAX_VIDEO_BYTES
    ):
        raise ValueError("VIDEO_FILE_TOO_LARGE")
    return {
        "url": stream_url(item.get("url")),
        "headers": audio_headers(payload, item, "VIDEO_HEADERS_FORBIDDEN"),
        "fileName": safe_file_name(payload.get("title"), "mp4"),
        "formatId": format_id,
        "container": "mp4",
        "codec": str(item.get("vcodec") or "unknown")[:100],
        "height": positive_integer(item.get("height")),
        "expectedBytes": expected,
        "estimatedBytes": estimated,
    }


def normalize(payload, analysis_id=None, selected_audio=None, selected_video=None):
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
            "directDownload": (
                is_direct_mp4_video(item)
                if has_video
                else is_direct_m4a_audio(item)
            ),
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
    result = {
        "id": video_id,
        "title": str(payload.get("title") or "YouTube")[:240],
        "duration": number(payload.get("duration")),
        "thumbnail": thumbnail,
        "videoFormats": video[:100],
        "audioFormats": audio[:30],
        "resolutions": sorted({item["height"] for item in video if item["height"]}),
    }
    if analysis_id is not None:
        result["analysisId"] = analysis_id
        result["preferredAudioFormatId"] = (
            str(selected_audio.get("format_id")) if selected_audio else None
        )
        result["preferredVideoFormatId"] = (
            str(selected_video.get("format_id")) if selected_video else None
        )
    return result


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
        if execute_js("console.log(JSON.stringify({ok: 6 * 7 === 42}));").strip() != '{"ok":true}':
            raise ValueError("LOCAL_JS_FAILED")
        with LocalYoutubeDL(local_options()) as downloader:
            payload = downloader.extract_info(url, download=False, process=False)
        check()
        analysis_id, selected_audio, selected_video = create_session(url, payload)
        result["metadata"] = normalize(
            payload, analysis_id, selected_audio, selected_video
        )
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


def prepare_audio_download(raw):
    """Reextract and return a native-only direct M4A descriptor."""
    budget = NetworkBudget()
    OnDeviceRH.budget = budget
    result = {}
    try:
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("AUDIO_REQUEST_INVALID")
        analysis_id = request.get("analysisId")
        format_id = request.get("formatId")
        if not isinstance(analysis_id, str) or not re.fullmatch(
            r"[a-f0-9]{32}", analysis_id
        ):
            raise ValueError("ANALYSIS_NOT_FOUND")
        if not isinstance(format_id, str) or not format_id or len(format_id) > 80:
            raise ValueError("FORMAT_NOT_AVAILABLE")
        clean_sessions()
        session = analysis_sessions.get(analysis_id)
        if session is None:
            raise ValueError("ANALYSIS_NOT_FOUND")
        if format_id not in session["audioFormatIds"]:
            raise ValueError("FORMAT_NOT_AVAILABLE")
        check()
        with LocalYoutubeDL(local_options()) as downloader:
            payload = downloader.extract_info(
                session["url"], download=False, process=False
            )
        check()
        result["descriptor"] = build_audio_descriptor(payload, format_id)
    except json.JSONDecodeError:
        result["error"] = {"code": "AUDIO_REQUEST_INVALID"}
    except DownloadError as error:
        result["error"] = {"code": budget.error or classify(str(error))}
    except ValueError as error:
        code = str(error)
        result["error"] = {
            "code": code if re.fullmatch(r"[A-Z_]+", code) else "AUDIO_PREPARATION_FAILED"
        }
    except Exception as error:
        result["error"] = {
            "code": budget.error
            or (
                "LOCAL_CANCELLED"
                if str(error) == "LOCAL_CANCELLED"
                else "AUDIO_PREPARATION_FAILED"
            )
        }
        result["exceptionType"] = type(error).__name__
    return json.dumps(result, allow_nan=False)


def prepare_video_download(raw):
    """Reextract and return a native-only direct video-only MP4 descriptor."""
    budget = NetworkBudget()
    OnDeviceRH.budget = budget
    result = {}
    try:
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("VIDEO_REQUEST_INVALID")
        analysis_id = request.get("analysisId")
        format_id = request.get("formatId")
        if not isinstance(analysis_id, str) or not re.fullmatch(
            r"[a-f0-9]{32}", analysis_id
        ):
            raise ValueError("ANALYSIS_NOT_FOUND")
        if not isinstance(format_id, str) or not format_id or len(format_id) > 80:
            raise ValueError("FORMAT_NOT_AVAILABLE")
        clean_sessions()
        session = analysis_sessions.get(analysis_id)
        if session is None:
            raise ValueError("ANALYSIS_NOT_FOUND")
        if format_id not in session["videoFormatIds"]:
            raise ValueError("FORMAT_NOT_AVAILABLE")
        check()
        with LocalYoutubeDL(local_options()) as downloader:
            payload = downloader.extract_info(
                session["url"], download=False, process=False
            )
        check()
        result["descriptor"] = build_video_descriptor(payload, format_id)
    except json.JSONDecodeError:
        result["error"] = {"code": "VIDEO_REQUEST_INVALID"}
    except DownloadError as error:
        result["error"] = {"code": budget.error or classify(str(error))}
    except ValueError as error:
        code = str(error)
        result["error"] = {
            "code": code if re.fullmatch(r"[A-Z_]+", code) else "VIDEO_PREPARATION_FAILED"
        }
    except Exception as error:
        result["error"] = {
            "code": budget.error
            or (
                "LOCAL_CANCELLED"
                if str(error) == "LOCAL_CANCELLED"
                else "VIDEO_PREPARATION_FAILED"
            )
        }
        result["exceptionType"] = type(error).__name__
    return json.dumps(result, allow_nan=False)
