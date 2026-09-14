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
