from subprocess import CompletedProcess
from unittest import TestCase
from unittest.mock import patch

from wambridge.stream import AudioStreamServer, StreamError, _read_chunk


class ReadOnePipe:
    def __init__(self) -> None:
        self.requested_size: int | None = None

    def read1(self, size: int) -> bytes:
        self.requested_size = size
        return b"fLaC"

    def read(self, _size: int) -> bytes:
        raise AssertionError("read() should not be used when read1() is available")


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

    @patch("wambridge.stream.shutil.which", return_value="C:/ffmpeg/bin/ffmpeg.exe")
    def test_audio_stays_gated_until_released(self, _which_mock) -> None:
        server = AudioStreamServer("track.opus")
        try:
            self.assertFalse(server.audio_released.is_set())
            server.release_audio()
            self.assertTrue(server.audio_released.is_set())
        finally:
            server.close()

    def test_reads_available_pipe_data_without_filling_buffer(self) -> None:
        pipe = ReadOnePipe()

        chunk = _read_chunk(pipe, 4096)  # type: ignore[arg-type]

        self.assertEqual(chunk, b"fLaC")
        self.assertEqual(pipe.requested_size, 4096)
