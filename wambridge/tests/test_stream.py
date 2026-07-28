from subprocess import CompletedProcess
from unittest import TestCase
from unittest.mock import patch

from wambridge.stream import AudioStreamServer, StreamError


class AudioStreamServerTests(TestCase):
    @patch("wambridge.stream.shutil.which", return_value="C:/ffmpeg/bin/ffmpeg.exe")
    @patch("wambridge.stream.subprocess.run")
    def test_prepare_rejects_invalid_audio(self, run_mock, _which_mock) -> None:
        run_mock.return_value = CompletedProcess([], 1, stderr=b"Invalid data")
        server = AudioStreamServer("broken.opus")
        try:
            with self.assertRaisesRegex(StreamError, "Invalid data"):
                server.prepare()
        finally:
            server.close()
