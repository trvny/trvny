#!/usr/bin/env python3
"""Offline checks for the private one-shot media handoff."""

from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
import http.client
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from handoff import handler_for, select_file
import handoff


class HandoffTests(unittest.TestCase):
    def test_reject_directory_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            downloads = root / "downloads"
            downloads.mkdir()
            (downloads / "clip.mp4").write_bytes(b"example")
            (downloads / "linked.mp4").symlink_to(downloads / "clip.mp4")
            old = handoff.DOWNLOADS
            handoff.DOWNLOADS = downloads
            try:
                self.assertEqual(select_file("clip.mp4"), downloads / "clip.mp4")
                for filename in ("../clip.mp4", "linked.mp4", "/tmp/clip.mp4"):
                    with self.subTest(filename=filename), self.assertRaises(ValueError):
                        select_file(filename)
            finally:
                handoff.DOWNLOADS = old

    def test_atomic_one_use_transfer_and_rejected_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            payload = b"devbox" * 100000
            video.write_bytes(payload)
            token = "testing-token"
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(video, token))
            server.claim_lock = threading.Lock()
            server.completed = False
            server.active = False
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def post():
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                    try:
                        connection.request(
                            "POST", "/download",
                            body=urlencode({"token": token}),
                            headers={"Content-Type": "application/x-www-form-urlencoded"},
                        )
                        response = connection.getresponse()
                        return response.status, response.read()
                    finally:
                        connection.close()

                with ThreadPoolExecutor(max_workers=2) as executor:
                    futures = [executor.submit(post) for _ in range(2)]
                    results = [future.result(timeout=15) for future in futures]
                self.assertEqual([r[0] for r in results].count(200), 1)
                self.assertEqual([r[1] for r in results if r[0] == 200], [payload])
                self.assertTrue(all(status in (200, 409) for status, _ in results))
                self.assertFalse(video.exists())
                self.assertTrue(server.completed)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
