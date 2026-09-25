"""Offline host tests: not a replacement for execution on the physical iPhone."""

import io
import json
import socket
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
native = types.ModuleType("_mediadrop_native")
native.check = MagicMock()
native.run_js = MagicMock(return_value='{"ok":true}')
native.get_js_diagnostics = MagicMock(return_value="{}")
sys.modules["_mediadrop_native"] = native

import mediadrop_spike as spike  # noqa: E402
import safe_network as network  # noqa: E402
from yt_dlp.networking.common import Request  # noqa: E402
from yt_dlp.networking.exceptions import TransportError  # noqa: E402


class SpikeTests(unittest.TestCase):
    def setUp(self):
        spike.analysis_sessions.clear()
        native.check.reset_mock(side_effect=True)
        native.run_js.reset_mock(side_effect=True)
        native.get_js_diagnostics.reset_mock(side_effect=True)
        native.get_js_diagnostics.return_value = json.dumps(
            {
                "memoryLimitBytes": 192 * 1024 * 1024,
                "stackLimitBytes": 2 * 1024 * 1024,
                "timeoutSeconds": 25,
                "outputLimitBytes": 8 * 1024 * 1024,
                "capturedBytes": 1024,
                "consoleCalls": 1,
                "completedNormally": True,
            }
        )

    @staticmethod
    def audio_payload(**format_overrides):
        audio = {
            "format_id": "140",
            "ext": "m4a",
            "vcodec": "none",
            "acodec": "mp4a.40.2",
            "protocol": "https",
            "abr": 129,
            "filesize": 2_000_000,
            "url": "https://rr1.googlevideo.com/videoplayback?signature=secret",
            "http_headers": {"User-Agent": "MediaDrop test", "Accept": "*/*"},
        }
        audio.update(format_overrides)
        return {
            "id": "AWGPaFraPN4",
            "title": "Own / audio",
            "formats": [audio],
        }

    @staticmethod
    def video_payload(**format_overrides):
        video = {
            "format_id": "134",
            "ext": "mp4",
            "vcodec": "avc1.4d401e",
            "acodec": "none",
            "protocol": None,
            "height": 360,
            "filesize": 5_000_000,
            "url": "https://rr1.googlevideo.com/videoplayback?signature=secret",
            "http_headers": {"User-Agent": "MediaDrop test", "Accept": "*/*"},
        }
        video.update(format_overrides)
        return {
            "id": "AWGPaFraPN4",
            "title": "Own / video",
            "formats": [video],
        }

    @staticmethod
    def js_bridge(response):
        def run(script):
            if script == 'console.log("alpha", 7); console.log(JSON.stringify({ok: true}));':
                return 'alpha 7\n{"ok":true}\n'
            if script == "21 * 2;":
                return ""
            if script == 'throw new Error("fixture error");':
                raise RuntimeError("LOCAL_JS_EVAL_FAILED")
            return response

        return run

    def test_single_urls(self):
        for url in [
            "https://youtu.be/AWGPaFraPN4",
            "https://youtube.com/shorts/AWGPaFraPN4",
            "https://www.youtube.com/watch?v=AWGPaFraPN4&list=ignored",
        ]:
            self.assertEqual(
                spike.canonical_url(url), "https://www.youtube.com/watch?v=AWGPaFraPN4"
            )

    def test_unsupported_urls(self):
        for url in [
            "https://youtube.com/playlist?list=abc",
            "file:///tmp/a",
            "https://youtube.com.evil.test/watch?v=AWGPaFraPN4",
            "https://user:password@youtube.com/watch?v=AWGPaFraPN4",
            "https://youtube.com/watch?v=AWGPaFraPN4&v=AWGPaFraPN4",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                spike.canonical_url(url)

    def test_metadata_is_real_and_stream_urls_never_cross_bridge(self):
        value = spike.normalize(
            {
                "id": "AWGPaFraPN4",
                "title": "Own video",
                "formats": [
                    {
                        "format_id": "137",
                        "ext": "mp4",
                        "vcodec": "avc1",
                        "acodec": "none",
                        "height": 1080,
                        "url": "signed-secret",
                    },
                    {
                        "format_id": "140",
                        "ext": "m4a",
                        "vcodec": "none",
                        "acodec": "aac",
                        "abr": 128,
                    },
                ],
            }
        )
        self.assertEqual(value["resolutions"], [1080])
        self.assertFalse(value["videoFormats"][0]["hasAudio"])
        self.assertEqual(value["audioFormats"][0]["id"], "140")
        self.assertNotIn("signed-secret", json.dumps(value))

    def test_analysis_creates_opaque_catalog_and_selects_compatible_audio(self):
        payload = self.audio_payload()
        with patch.object(spike.LocalYoutubeDL, "extract_info", return_value=payload):
            result = json.loads(spike.analyze("https://youtu.be/AWGPaFraPN4"))
        metadata = result["metadata"]
        self.assertRegex(metadata["analysisId"], r"^[a-f0-9]{32}$")
        self.assertEqual(metadata["preferredAudioFormatId"], "140")
        self.assertNotIn("videoplayback", json.dumps(metadata))
        self.assertNotIn("http_headers", json.dumps(metadata))

    def test_audio_selection_accepts_https_url_when_protocol_is_unset(self):
        payload = self.audio_payload(protocol=None)

        self.assertEqual(spike.preferred_audio(payload["formats"])["format_id"], "140")

    def test_audio_selection_rejects_non_m4a_and_manifest(self):
        for changes in [
            {"ext": "webm", "acodec": "opus"},
            {"protocol": "m3u8_native"},
            {"fragments": [{"url": "https://rr1.googlevideo.com/f"}]},
        ]:
            with self.subTest(changes=changes):
                self.assertFalse(
                    spike.is_direct_m4a_audio(
                        self.audio_payload(**changes)["formats"][0]
                    )
                )

    def test_original_audio_keeps_unique_identity_across_reordered_reextraction(self):
        english = self.audio_payload(
            language="en-US",
            language_preference=-1,
            format_note="English (US), medium",
            abr=130,
            filesize=14_848_193,
            url="https://rr1.googlevideo.com/videoplayback?signature=english",
        )["formats"][0]
        spanish = self.audio_payload(
            language="es-US",
            language_preference=10,
            format_note="Spanish (US) original (default), medium",
            abr=129,
            filesize=14_846_784,
            url="https://rr1.googlevideo.com/videoplayback?signature=spanish",
        )["formats"][0]
        payload = {"id": "HdQHE3zg4SE", "title": "Authorized video", "formats": [english, spanish]}
        refreshed = {
            **payload,
            "formats": [
                {**spanish, "url": "https://rr2.googlevideo.com/videoplayback?signature=new-spanish"},
                {**english, "url": "https://rr2.googlevideo.com/videoplayback?signature=new-english"},
            ],
        }
        with patch.object(
            spike.LocalYoutubeDL, "extract_info", side_effect=[payload, refreshed]
        ):
            metadata = json.loads(spike.analyze("https://youtu.be/HdQHE3zg4SE"))["metadata"]
            selected_id = metadata["preferredAudioFormatId"]
            prepared = json.loads(
                spike.prepare_audio_download(
                    json.dumps({"analysisId": metadata["analysisId"], "formatId": selected_id})
                )
            )
        self.assertNotEqual(selected_id, "140")
        self.assertTrue(selected_id.startswith("140@"))
        self.assertEqual(len({item["id"] for item in metadata["audioFormats"]}), 2)
        self.assertNotIn("signature", json.dumps(metadata))
        self.assertEqual(prepared["descriptor"]["formatId"], selected_id)
        self.assertEqual(prepared["descriptor"]["url"], refreshed["formats"][0]["url"])

    def test_multiple_languages_without_preference_are_not_silently_selected(self):
        english = self.audio_payload(language="en-US", language_preference=-1)["formats"][0]
        spanish = self.audio_payload(language="es-US", language_preference=-1)["formats"][0]
        self.assertIsNone(spike.preferred_audio([english, spanish]))

    def test_original_preference_is_not_tied_to_spanish(self):
        english = self.audio_payload(
            language="en-US", language_preference=10, abr=128
        )["formats"][0]
        spanish = self.audio_payload(
            language="es-US", language_preference=-1, abr=130
        )["formats"][0]
        self.assertIs(spike.preferred_audio([spanish, english]), english)

    def test_direct_audio_identity_does_not_collide_with_manifest_variant(self):
        direct = self.audio_payload(language="es-US", language_preference=10)["formats"][0]
        manifest = {**direct, "protocol": "m3u8_native"}
        formats = [manifest, direct]
        self.assertIs(spike.preferred_audio(formats), direct)
        self.assertNotEqual(
            spike.audio_public_id(manifest, formats),
            spike.audio_public_id(direct, formats),
        )

    def test_reextraction_rejects_missing_or_ambiguous_audio_track(self):
        original = self.audio_payload(
            language="es-US", language_preference=10, format_note="Spanish original"
        )
        analysis_id, selected, _ = spike.create_session(
            "https://www.youtube.com/watch?v=HdQHE3zg4SE", original
        )
        selected_id = spike.audio_public_id(selected, original["formats"])
        missing = self.audio_payload(language="en-US", language_preference=-1)
        ambiguous = {
            **original,
            "formats": [original["formats"][0], {**original["formats"][0], "url": "https://rr2.googlevideo.com/videoplayback?signature=other"}],
        }
        for refreshed, code in [
            (missing, "AUDIO_TRACK_CHANGED"),
            (ambiguous, "AUDIO_TRACK_AMBIGUOUS"),
        ]:
            with self.subTest(code=code), patch.object(
                spike.LocalYoutubeDL, "extract_info", return_value=refreshed
            ):
                prepared = json.loads(
                    spike.prepare_audio_download(
                        json.dumps({"analysisId": analysis_id, "formatId": selected_id})
                    )
                )
            self.assertEqual(prepared["error"]["code"], code)

    def test_video_selection_prefers_direct_360p_avc_mp4(self):
        payload = self.video_payload()
        payload["formats"].extend(
            [
                self.video_payload(format_id="136", height=720)["formats"][0],
                self.video_payload(format_id="137", height=1080)["formats"][0],
            ]
        )

        self.assertEqual(spike.preferred_video(payload["formats"])["format_id"], "134")

    def test_video_selection_rejects_non_direct_or_muxed_formats(self):
        for changes in [
            {"ext": "webm"},
            {"vcodec": "vp09.00.21.08"},
            {"acodec": "mp4a.40.2"},
            {"protocol": "m3u8_native"},
            {"manifest_url": "https://manifest.googlevideo.com/example"},
            {"url": "https://www.youtube.com/watch?v=AWGPaFraPN4"},
        ]:
            with self.subTest(changes=changes):
                self.assertFalse(
                    spike.is_direct_mp4_video(
                        self.video_payload(**changes)["formats"][0]
                    )
                )

    def test_metadata_marks_manifest_video_as_not_direct(self):
        direct = self.video_payload(format_id="136", height=720)["formats"][0]
        manifest = self.video_payload(
            format_id="232",
            height=720,
            protocol="m3u8_native",
            url="https://manifest.googlevideo.com/api/manifest/hls_playlist",
        )["formats"][0]
        payload = {
            "id": "AWGPaFraPN4",
            "title": "Authorized video",
            "formats": [direct, manifest],
        }
        normalized = spike.normalize(payload)
        self.assertEqual(
            [(item["id"], item["directDownload"]) for item in normalized["videoFormats"]],
            [("136", True), ("232", False)],
        )

    def test_oversize_audio_is_not_preselected_and_is_rejected_for_download(self):
        payload = self.audio_payload(filesize=spike.MAX_AUDIO_BYTES + 1)
        self.assertIsNone(spike.preferred_audio(payload["formats"]))
        with self.assertRaisesRegex(ValueError, "AUDIO_FILE_TOO_LARGE"):
            spike.build_audio_descriptor(payload, "140")

    def test_prepare_reextracts_exact_format_and_keeps_descriptor_native(self):
        payload = self.audio_payload()
        analysis_id, _, _ = spike.create_session(
            "https://www.youtube.com/watch?v=AWGPaFraPN4", payload
        )
        with patch.object(
            spike.LocalYoutubeDL, "extract_info", return_value=payload
        ) as extract:
            prepared = json.loads(
                spike.prepare_audio_download(
                    json.dumps({"analysisId": analysis_id, "formatId": "140"})
                )
            )
        extract.assert_called_once()
        self.assertEqual(prepared["descriptor"]["formatId"], "140")
        self.assertEqual(prepared["descriptor"]["container"], "m4a")
        self.assertEqual(
            prepared["descriptor"]["url"], payload["formats"][0]["url"]
        )
        self.assertNotIn("Cookie", prepared["descriptor"]["headers"])

    def test_prepare_rejects_invalid_analysis_and_missing_format(self):
        invalid = json.loads(
            spike.prepare_audio_download(
                json.dumps({"analysisId": "invalid", "formatId": "140"})
            )
        )
        self.assertEqual(invalid["error"]["code"], "ANALYSIS_NOT_FOUND")
        analysis_id, _, _ = spike.create_session(
            "https://www.youtube.com/watch?v=AWGPaFraPN4", self.audio_payload()
        )
        missing = json.loads(
            spike.prepare_audio_download(
                json.dumps({"analysisId": analysis_id, "formatId": "251"})
            )
        )
        self.assertEqual(missing["error"]["code"], "FORMAT_NOT_AVAILABLE")

    def test_prepare_rejects_expired_analysis(self):
        analysis_id, _, _ = spike.create_session(
            "https://www.youtube.com/watch?v=AWGPaFraPN4", self.audio_payload()
        )
        spike.analysis_sessions[analysis_id]["created"] -= spike.ANALYSIS_TTL_SECONDS
        prepared = json.loads(
            spike.prepare_audio_download(
                json.dumps({"analysisId": analysis_id, "formatId": "140"})
            )
        )
        self.assertEqual(prepared["error"]["code"], "ANALYSIS_NOT_FOUND")

    def test_prepare_video_reextracts_exact_format(self):
        payload = self.video_payload()
        analysis_id, _, selected_video = spike.create_session(
            "https://www.youtube.com/watch?v=AWGPaFraPN4", payload
        )
        self.assertEqual(selected_video["format_id"], "134")
        with patch.object(spike.LocalYoutubeDL, "extract_info", return_value=payload):
            prepared = json.loads(
                spike.prepare_video_download(
                    json.dumps({"analysisId": analysis_id, "formatId": "134"})
                )
            )
        descriptor = prepared["descriptor"]
        self.assertEqual(descriptor["formatId"], "134")
        self.assertEqual(descriptor["container"], "mp4")
        self.assertEqual(descriptor["height"], 360)
        self.assertNotIn(descriptor["url"], json.dumps(spike.normalize(payload)))

    def test_oversize_video_is_not_preselected_and_is_rejected(self):
        payload = self.video_payload(filesize=spike.MAX_VIDEO_BYTES + 1)
        self.assertIsNone(spike.preferred_video(payload["formats"]))
        with self.assertRaisesRegex(ValueError, "VIDEO_FILE_TOO_LARGE"):
            spike.build_video_descriptor(payload, "134")

    def test_video_descriptor_rejects_forbidden_headers(self):
        payload = self.video_payload(http_headers={"Cookie": "secret"})
        with self.assertRaisesRegex(ValueError, "VIDEO_HEADERS_FORBIDDEN"):
            spike.build_video_descriptor(payload, "134")

    def test_descriptor_rejects_non_https_host_and_forbidden_headers(self):
        for changes, code in [
            ({"url": "http://rr1.googlevideo.com/file"}, "AUDIO_FORMAT_NOT_SUPPORTED"),
            (
                {"url": "https://youtube.com.evil.test/file"},
                "AUDIO_FORMAT_NOT_SUPPORTED",
            ),
            (
                {"http_headers": {"Cookie": "secret"}},
                "AUDIO_HEADERS_FORBIDDEN",
            ),
        ]:
            with self.subTest(code=code):
                payload = self.audio_payload(**changes)
                if code == "AUDIO_FORMAT_NOT_SUPPORTED":
                    with self.assertRaisesRegex(ValueError, code):
                        spike.build_audio_descriptor(payload, "140")
                else:
                    with self.assertRaisesRegex(ValueError, code):
                        spike.build_audio_descriptor(payload, "140")

    def test_restricted_content_rejected(self):
        for extra, code in [
            ({"is_live": True}, "LIVE_NOT_SUPPORTED"),
            ({"availability": "private"}, "PRIVATE_CONTENT"),
            ({"availability": "needs_auth"}, "LOGIN_REQUIRED"),
            ({"formats": [{"has_drm": True}]}, "DRM_NOT_SUPPORTED"),
        ]:
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, code):
                spike.normalize({"id": "AWGPaFraPN4", **extra})

    def test_error_sanitization(self):
        with patch.object(
            spike.LocalYoutubeDL,
            "extract_info",
            side_effect=RuntimeError("https://secret?token=sensitive"),
        ):
            result = spike.analyze("https://youtu.be/AWGPaFraPN4")
        self.assertNotIn("sensitive", result)
        self.assertEqual(json.loads(result)["error"]["code"], "LOCAL_RUNTIME_FAILED")

    def test_cancellation(self):
        native.check.side_effect = RuntimeError("LOCAL_CANCELLED")
        self.assertEqual(
            json.loads(spike.analyze("https://youtu.be/AWGPaFraPN4"))["error"]["code"],
            "LOCAL_CANCELLED",
        )

    def test_only_local_handler_and_packaged_ejs(self):
        with spike.LocalYoutubeDL(
            {
                "quiet": True,
                "logger": spike.SilentLogger(),
                "proxy": "",
                "cachedir": False,
                "js_runtimes": {},
            }
        ) as downloader:
            self.assertEqual(
                list(downloader._request_director.handlers), [network.OnDeviceRH.RH_KEY]
            )
        with self.assertRaisesRegex(RuntimeError, "LOCAL_PROCESS_FORBIDDEN"):
            spike.prohibit_processes("subprocess.Popen", ())

    def test_fixture_traverses_yt_dlp_ejs_provider(self):
        response = json.dumps(
            {
                "type": "result",
                "responses": [
                    {
                        "type": "result",
                        "data": {
                            spike.EJS_FIXTURE_INPUT: spike.EJS_FIXTURE_EXPECTED
                        },
                    }
                ],
                "preprocessed_player": "fixture",
            }
        )
        native.run_js.side_effect = self.js_bridge(response)
        with patch.object(spike, "load_ejs_fixture", return_value="player-code"):
            result = json.loads(spike.run_ejs_fixture())
        self.assertEqual(result["fixture"]["status"], "passed")
        self.assertEqual(result["fixture"]["provider"], "MediaDropEmbedded")
        self.assertEqual(result["jsChallengeCalls"], 1)
        self.assertEqual(result["nativeRunJsCalls"], 4)
        self.assertEqual(result["processAttempts"], 0)
        self.assertFalse(result["subprocessUsed"])
        self.assertTrue(result["diagnostics"]["providerInvoked"])
        self.assertTrue(result["diagnostics"]["runJsInvoked"])
        self.assertTrue(result["diagnostics"]["quickJsCompletedNormally"])
        self.assertTrue(result["diagnostics"]["consoleLogCaptured"])
        self.assertTrue(result["diagnostics"]["evaluationReturnIgnored"])
        self.assertTrue(result["diagnostics"]["javascriptExceptionCaught"])
        self.assertIsNone(result["diagnostics"]["parserError"])
        self.assertEqual(
            result["diagnostics"]["native"]["memoryLimitBytes"],
            192 * 1024 * 1024,
        )
        script = native.run_js.call_args.args[0]
        self.assertIn("player-code", script)
        self.assertIn(spike.EJS_FIXTURE_INPUT, script)

    def test_fixture_rejects_an_invalid_solver_response(self):
        response = json.dumps(
            {
                "type": "result",
                "responses": [{"type": "result", "data": {}}],
                "preprocessed_player": "fixture",
            }
        )
        native.run_js.side_effect = self.js_bridge(response)
        with patch.object(spike, "load_ejs_fixture", return_value="player-code"):
            result = json.loads(spike.run_ejs_fixture())
        self.assertEqual(result["error"]["code"], "EJS_RESPONSE_MISSING")
        self.assertEqual(result["jsChallengeCalls"], 1)

    def test_ejs_response_diagnostics_for_valid_json(self):
        diagnostics = spike.inspect_ejs_response(
            json.dumps(
                {
                    "type": "result",
                    "responses": [{"type": "result", "data": {"n": "answer"}}],
                    "preprocessed_player": "large-player",
                }
            )
        )
        self.assertEqual(diagnostics["responseType"], "str")
        self.assertEqual(diagnostics["responsePayloadType"], "result")
        self.assertEqual(diagnostics["parserError"], None)
        self.assertIn('"preprocessedPlayerLength": 12', diagnostics["responsePreview"])
        self.assertNotIn("large-player", diagnostics["responsePreview"])

    def test_ejs_response_diagnostics_for_invalid_json(self):
        diagnostics = spike.inspect_ejs_response("not-json")
        self.assertEqual(
            diagnostics["parserError"], "JSONDecodeError line 1 column 1"
        )
        self.assertEqual(diagnostics["responsePreview"], "not-json")

    def test_js_bridge_contract_checks_console_return_and_exception(self):
        native.run_js.side_effect = self.js_bridge("unused")
        self.assertEqual(
            spike.verify_js_bridge_contract(),
            {
                "consoleLogCaptured": True,
                "evaluationReturnIgnored": True,
                "javascriptExceptionCaught": True,
            },
        )

    def test_js_bridge_contract_rejects_bad_console_capture(self):
        native.run_js.side_effect = lambda script: "wrong"
        with self.assertRaisesRegex(ValueError, "EJS_BRIDGE_CONTRACT_INVALID"):
            spike.verify_js_bridge_contract()

    def test_native_diagnostics_are_allowlisted(self):
        native.get_js_diagnostics.return_value = json.dumps(
            {
                "errorCode": "LOCAL_JS_MEMORY_LIMIT",
                "exceptionMessage": "null",
                "secret": "must-not-cross-bridge",
            }
        )
        diagnostics = spike.native_js_diagnostics()
        self.assertEqual(diagnostics["errorCode"], "LOCAL_JS_MEMORY_LIMIT")
        self.assertNotIn("secret", diagnostics)


class NetworkTests(unittest.TestCase):
    def setUp(self):
        native.check.reset_mock(side_effect=True)
        self.budget = network.NetworkBudget()
        network.OnDeviceRH.budget = self.budget
        self.handler = network.OnDeviceRH(logger=spike.SilentLogger())

    def response(self, status=200, headers=None, body=b"{}"):
        result = MagicMock(status=status)
        result.getheader.side_effect = lambda key, default=None: (headers or {}).get(
            key, default
        )
        result.getheaders.return_value = list((headers or {}).items())
        result.read.side_effect = io.BytesIO(body).read
        return result

    def test_hostname_allowlist(self):
        for url in [
            "http://youtube.com/",
            "https://127.0.0.1/",
            "https://youtube.com.evil.test/",
            "https://user:pass@youtube.com/",
            "https://youtube.com:8443/",
            "https://mediadrop-api.onrender.com/",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                network.validate_url(url)

    def test_private_and_mixed_dns_rejected_before_socket(self):
        for addresses in [
            ["127.0.0.1"],
            ["::1"],
            ["10.0.0.1"],
            ["169.254.0.1"],
            ["224.0.0.1"],
            ["8.8.8.8", "192.168.0.2"],
        ]:
            answers = [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))
                for address in addresses
            ]
            with (
                self.subTest(addresses=addresses),
                patch.object(network.socket, "getaddrinfo", return_value=answers),
                patch.object(network.socket, "socket") as connect,
            ):
                with self.assertRaises(OSError):
                    network.PinnedHTTPSConnection("youtube.com").connect()
                connect.assert_not_called()

    def test_tls_sni_and_pin(self):
        context = MagicMock()
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with (
            patch.object(network.socket, "getaddrinfo", return_value=answers),
            patch.object(network.socket, "socket") as factory,
        ):
            network.PinnedHTTPSConnection(
                "youtube.com", context=context, timeout=10
            ).connect()
        factory.return_value.connect.assert_called_once_with(("8.8.8.8", 443))
        context.wrap_socket.assert_called_once_with(
            factory.return_value, server_hostname="youtube.com"
        )

    def test_redirect_allowlist_and_no_credentials(self):
        with patch.object(network, "PinnedHTTPSConnection") as factory:
            factory.return_value.getresponse.side_effect = [
                self.response(
                    302, {"Location": "https://www.youtube.com/watch?v=AWGPaFraPN4"}
                ),
                self.response(),
            ]
            self.handler.send(
                Request(
                    "https://youtube.com/",
                    headers={"Cookie": "secret", "Authorization": "secret"},
                )
            )
        self.assertEqual(factory.call_count, 2)
        headers = factory.return_value.request.call_args.kwargs["headers"]
        self.assertNotIn("cookie", {key.lower() for key in headers})
        self.assertNotIn("authorization", {key.lower() for key in headers})
        self.assertEqual(self.budget.bytes, 2)

    def test_private_redirect(self):
        with patch.object(network, "PinnedHTTPSConnection") as factory:
            factory.return_value.getresponse.return_value = self.response(
                302, {"Location": "https://127.0.0.1/"}
            )
            with self.assertRaises(TransportError):
                self.handler.send(Request("https://youtube.com/"))
        self.assertEqual(factory.call_count, 1)

    def test_redirect_limit(self):
        with patch.object(network, "PinnedHTTPSConnection") as factory:
            factory.return_value.getresponse.return_value = self.response(
                302, {"Location": "https://youtube.com/again"}
            )
            with self.assertRaises(TransportError):
                self.handler.send(Request("https://youtube.com/"))
        self.assertEqual(factory.call_count, 4)

    def test_response_size_limit(self):
        with patch.object(network, "PinnedHTTPSConnection") as factory:
            factory.return_value.getresponse.return_value = self.response(
                headers={"Content-Length": str(13 * 1024 * 1024)}
            )
            with self.assertRaises(TransportError):
                self.handler.send(Request("https://youtube.com/"))
        self.assertEqual(self.budget.error, "LOCAL_RESOURCE_LIMIT")

    def test_network_error_sanitized(self):
        with patch.object(network, "PinnedHTTPSConnection") as factory:
            factory.return_value.request.side_effect = OSError("secret-url")
            with self.assertRaisesRegex(TransportError, "^REMOTE_UNAVAILABLE$"):
                self.handler.send(Request("https://youtube.com/"))


if __name__ == "__main__":
    unittest.main()
