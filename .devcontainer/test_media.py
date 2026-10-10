#!/usr/bin/env python3
"""Offline tests for safe yt-dlp command assembly and local file pickup."""

from contextlib import redirect_stdout
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import media  # noqa: E402


class MediaTests(unittest.TestCase):
    def test_single_video_with_size_and_playlist_guards(self):
        cmd = media.command_for(
            "https://example.com/video?id=2", audio=False, best=False
        )
        self.assertIn("--no-playlist", cmd)
        self.assertIn("--ignore-config", cmd)
        self.assertEqual(cmd[cmd.index("--max-filesize") + 1], "2G")
        self.assertIn("bv*[height<=1080]+ba/b[height<=1080]/best", cmd)
        self.assertEqual(cmd[-1], "https://example.com/video?id=2")

    def test_audio_extracts_mp3_and_best_skips_quality_cap(self):
        audio = media.command_for("https://example.com/video", audio=True, best=False)
        self.assertIn("--audio-format", audio)
        self.assertIn("mp3", audio)
        self.assertNotIn("--format", audio)
        best = media.command_for("https://example.com/video", audio=False, best=True)
        self.assertNotIn("--format", best)

    def test_non_http_urls_and_credentials_fail(self):
        for value in ("file:///etc/passwd", "javascript:alert(1)", "https://x:y@example.com",
                      "not-a-url"):
            with self.subTest(url=value), self.assertRaises(ValueError):
                media.command_for(value, audio=False, best=False)

    def test_fetch_uses_user_local_folder_without_network_side_effects(self):
        with tempfile.TemporaryDirectory() as scratch:
            downloads = Path(scratch) / "downloads"
            with (mock.patch.object(media, "DOWNLOADS", downloads),
                  mock.patch.object(media.shutil, "which", return_value="/usr/bin/tool"),
                  mock.patch.object(media.shutil, "disk_usage", return_value=(10**10, 3*10**9, 3*10**9)),
                  mock.patch.object(media.subprocess, "run") as run,
                  redirect_stdout(io.StringIO())):
                run.return_value.returncode = 0
                self.assertEqual(media.fetch("https://example.com/video",
                                             audio=False, best=False), 0)
                self.assertTrue(downloads.is_dir())
                self.assertEqual(run.call_args.args[0][0], "yt-dlp")

    def test_list_files_reports_only_regular_files(self):
        with tempfile.TemporaryDirectory() as scratch:
            downloads = Path(scratch) / "downloads"
            downloads.mkdir()
            (downloads / "clip.mp4").write_bytes(b"x" * 123)
            with (mock.patch.object(media, "DOWNLOADS", downloads),
                  redirect_stdout(io.StringIO()) as output):
                media.list_files()
            self.assertIn("clip.mp4", output.getvalue())


if __name__ == "__main__":
    unittest.main()
