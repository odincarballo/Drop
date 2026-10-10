"""Offline host tests: not a replacement for execution on the physical iPhone."""

import io
import hashlib
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
from yt_dlp.extractor.youtube.jsc.provider import (  # noqa: E402
    JsChallengeRequest,
    JsChallengeType,
    NChallengeInput,
)


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

    def test_phase_one_1080_accepts_sdr_or_unknown_avc_with_known_frame_rate(self):
        valid = self.video_payload(
            format_id="dynamic-1080", height=1080, fps=24,
            dynamic_range="SDR", vcodec="avc1.640028",
        )["formats"][0]
        self.assertTrue(spike.is_selectable_direct_video(valid))
        for dynamic_range in (None, "unknown", "UNKNOWN", ""):
            with self.subTest(accepted_range=dynamic_range):
                candidate = {**valid, "dynamic_range": dynamic_range}
                self.assertTrue(spike.is_selectable_direct_video(candidate))
                record = spike.normalize({"id": "AWGPaFraPN4", "formats": [candidate]})["videoFormats"][0]
                self.assertTrue(record["directDownload"])
                self.assertNotEqual(record["dynamicRange"], "SDR")
        for changes in [
            {"fps": None}, {"fps": 60}, {"dynamic_range": "HDR10"},
            {"dynamic_range": "HLG"}, {"dynamic_range": "DV"},
            {"vcodec": "h264"},
            {"vcodec": "av01.0.08M.08"}, {"vcodec": "vp9", "ext": "webm"},
            {"protocol": "m3u8_native"},
        ]:
            with self.subTest(changes=changes):
                candidate = {**valid, **changes}
                self.assertFalse(spike.is_selectable_direct_video(candidate))
                self.assertFalse(spike.normalize({"id": "AWGPaFraPN4", "formats": [candidate]})["videoFormats"][0]["directDownload"])

    def test_phase_one_1080_descriptor_rechecks_size_after_reextraction(self):
        valid = self.video_payload(
            format_id="dynamic-1080", height=1080, fps=30,
            dynamic_range="SDR", vcodec="avc1.640028",
            filesize=spike.MAX_VIDEO_BYTES,
        )
        self.assertEqual(
            spike.build_video_descriptor(valid, "dynamic-1080")["height"], 1080
        )
        normalized = spike.normalize(valid)["videoFormats"][0]
        self.assertEqual(normalized["exactSize"], spike.MAX_VIDEO_BYTES)
        self.assertEqual(normalized["dynamicRange"], "SDR")
        unknown = {**valid, "formats": [{**valid["formats"][0], "dynamic_range": None}]}
        self.assertEqual(spike.build_video_descriptor(unknown, "dynamic-1080")["height"], 1080)
        for changes, code in [
            ({"filesize": None, "filesize_approx": 1_000_000}, "VIDEO_FORMAT_NOT_SUPPORTED"),
            ({"filesize": spike.MAX_VIDEO_BYTES + 1}, "VIDEO_FILE_TOO_LARGE"),
            ({"fps": 60}, "VIDEO_FORMAT_NOT_SUPPORTED"),
            ({"dynamic_range": "HDR10"}, "VIDEO_FORMAT_NOT_SUPPORTED"),
        ]:
            with self.subTest(changes=changes):
                changed = {**valid, "formats": [{**valid["formats"][0], **changes}]}
                with self.assertRaisesRegex(ValueError, code):
                    spike.build_video_descriptor(changed, "dynamic-1080")

    def catalog_fixture(self):
        base = self.video_payload()["formats"][0]
        formats = [
            {**base, "format_id": "preferred-360"},
            {**base, "format_id": "preferred-720", "height": 720},
        ]
        formats.extend(
            {**base, "format_id": f"filler-{index}", "height": 480}
            for index in range(98)
        )
        high = self.video_payload(
            format_id="preferred-1080", height=1080, fps=24,
            dynamic_range="SDR", vcodec="avc1.640028",
        )["formats"][0]
        return formats, high

    def test_catalog_protects_1080_after_position_100_without_losing_360_or_720(self):
        formats, high = self.catalog_fixture()
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + [high]})["videoFormats"]
        ids = [item["id"] for item in records]
        self.assertEqual(len(records), 100)
        self.assertEqual(ids[:2], ["preferred-360", "preferred-720"])
        self.assertEqual(ids[-1], "preferred-1080")
        self.assertNotIn("filler-97", ids)
        self.assertEqual(len(ids), len(set(ids)))

    def test_catalog_without_eligible_1080_preserves_original_order(self):
        formats, high = self.catalog_fixture()
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + [
            {**high, "dynamic_range": "HDR10"}
        ]})["videoFormats"]
        self.assertEqual([item["id"] for item in records], [item["format_id"] for item in formats])

    def test_catalog_multiple_1080_variants_protects_only_preferred(self):
        formats, high = self.catalog_fixture()
        larger = {**high, "format_id": "larger-1080", "filesize": 10_000_000}
        smaller = {**high, "format_id": "smaller-1080", "filesize": 5_000_000}
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + [larger, smaller]})["videoFormats"]
        ids = [item["id"] for item in records]
        self.assertEqual(len(ids), 100)
        self.assertIn("smaller-1080", ids)
        self.assertNotIn("larger-1080", ids)

    def test_catalog_does_not_duplicate_protected_entries_already_inside_cap(self):
        formats, high = self.catalog_fixture()
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": [high] + formats[:99]})["videoFormats"]
        ids = [item["id"] for item in records]
        self.assertEqual(len(ids), 100)
        self.assertEqual(ids.count("preferred-1080"), 1)
        self.assertEqual(ids[:3], ["preferred-1080", "preferred-360", "preferred-720"])

    def test_catalog_rejects_incompatible_1080_after_cap(self):
        formats, high = self.catalog_fixture()
        extras = [
            {**high, "format_id": "vp9-1080", "vcodec": "vp9", "ext": "webm"},
            {**high, "format_id": "av1-1080", "vcodec": "av01.0.08M.08"},
            {**high, "format_id": "hls-1080", "protocol": "m3u8_native"},
        ]
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + extras})["videoFormats"]
        self.assertEqual([item["id"] for item in records], [item["format_id"] for item in formats])

    def test_catalog_keeps_oversized_1080_only_as_disabled_display_option(self):
        formats, high = self.catalog_fixture()
        oversized = {**high, "format_id": "oversized-1080", "filesize": spike.MAX_VIDEO_BYTES + 1}
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + [oversized]})["videoFormats"]
        self.assertEqual(len(records), 100)
        self.assertEqual(records[-1]["id"], "oversized-1080")
        self.assertTrue(records[-1]["directDownload"])
        self.assertGreater(records[-1]["exactSize"], spike.MAX_VIDEO_BYTES)
        with self.assertRaisesRegex(ValueError, "VIDEO_FILE_TOO_LARGE"):
            spike.build_video_descriptor({"formats": [oversized]}, "oversized-1080")

    def test_catalog_can_protect_preferred_360_and_720_after_cap(self):
        formats, _ = self.catalog_fixture()
        later = [
            {**formats[0], "format_id": "better-360", "filesize": 1_000_000},
            {**formats[1], "format_id": "better-720", "filesize": 1_000_000},
        ]
        records = spike.normalize({"id": "AWGPaFraPN4", "formats": formats + later})["videoFormats"]
        ids = [item["id"] for item in records]
        self.assertEqual(len(ids), 100)
        self.assertEqual(ids[:2], ["preferred-360", "preferred-720"])
        self.assertEqual(ids[-2:], ["better-360", "better-720"])

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
        payload = self.video_payload(
            filesize=spike.video_max_bytes(360) + 1
        )
        self.assertIsNone(spike.preferred_video(payload["formats"]))
        with self.assertRaisesRegex(ValueError, "VIDEO_FILE_TOO_LARGE"):
            spike.build_video_descriptor(payload, "134")

    def test_long_video_policy_is_height_specific(self):
        for height in (360, 720):
            with self.subTest(height=height):
                limit = spike.video_max_bytes(height)
                self.assertEqual(limit, 1024 * 1024 * 1024)
                payload = self.video_payload(height=height, filesize=limit)
                self.assertEqual(spike.build_video_descriptor(payload, "134")["expectedBytes"], limit)
                payload = self.video_payload(height=height, filesize=limit + 1)
                with self.assertRaisesRegex(ValueError, "VIDEO_FILE_TOO_LARGE"):
                    spike.build_video_descriptor(payload, "134")
        self.assertEqual(spike.video_max_bytes(1080), 50 * 1024 * 1024)

    def test_audio_250_mib_and_exact_size_outranks_approximation(self):
        limit = 250 * 1024 * 1024
        payload = self.audio_payload(filesize=limit)
        self.assertEqual(spike.build_audio_descriptor(payload, "140")["expectedBytes"], limit)
        with self.assertRaisesRegex(ValueError, "AUDIO_FILE_TOO_LARGE"):
            spike.build_audio_descriptor(self.audio_payload(filesize=limit + 1), "140")
        payload = self.audio_payload(filesize=limit - 1, filesize_approx=limit + 1)
        self.assertEqual(spike.build_audio_descriptor(payload, "140")["expectedBytes"], limit - 1)

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

    def test_synthetic_fixture_traverses_production_provider_with_mock_native(self):
        fixture_path = Path(__file__).resolve().parent / "fixtures/drop-ejs-diagnostic.js"
        fixture = fixture_path.read_text(encoding="utf-8")
        self.assertEqual(
            hashlib.sha256(fixture.encode("utf-8")).hexdigest(),
            "da37d56875946ef256714d0ad35c485a1414d1abd742d4dc0989d2cc4d4b1683",
        )
        self.assertLess(len(fixture.encode("utf-8")), 4096)
        self.assertNotIn("youtube.com", fixture.lower())
        response = json.dumps(
            {
                "type": "result",
                "responses": [
                    {
                        "type": "result",
                        "data": {"drop-diagnostic": "citsongaid-pord"},
                    }
                ],
                "preprocessed_player": "fixture",
            }
        )
        native.run_js.side_effect = self.js_bridge(response)
        with spike.LocalYoutubeDL(spike.local_options()) as downloader:
            extractor = downloader.get_info_extractor("Youtube")
            extractor.initialize()
            director = extractor._jsc_director
            provider = director.providers[spike.MediaDropEmbeddedJCP.PROVIDER_KEY]
            self.assertTrue(provider.is_available())
            provider._get_player = lambda video_id, player_url: fixture
            request = JsChallengeRequest(
                type=JsChallengeType.N,
                video_id="drop-diagnostic",
                input=NChallengeInput(
                    player_url="https://drop.invalid/diagnostic/player.js",
                    challenges=["drop-diagnostic"],
                ),
            )
            responses = director.bulk_solve([request])
        self.assertEqual(
            responses[0][1].output.results["drop-diagnostic"],
            "citsongaid-pord",
        )
        self.assertEqual(spike.js_calls, 1)
        script = native.run_js.call_args.args[0]
        self.assertIn("createDropProbe", script)
        self.assertIn("drop-diagnostic", script)

    def test_synthetic_fixture_is_not_a_runtime_dependency(self):
        module_root = Path(__file__).resolve().parents[1]
        production = (module_root / "python/mediadrop_spike.py").read_text(
            encoding="utf-8"
        )
        embed = (module_root.parents[1] / "scripts/embed_on_device_python.sh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("drop-ejs-diagnostic.js", production)
        self.assertNotIn("md_fixtures", production)
        self.assertNotIn("md_fixtures", embed)
        self.assertNotIn("vendor/fixtures", embed)
        self.assertIn("MediaDropEmbeddedJCP", production)

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
