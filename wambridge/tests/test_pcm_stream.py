from io import BytesIO
from unittest import TestCase
from unittest.mock import patch

from wambridge.pcm_stream import PcmAudioStreamServer


class PcmAudioStreamServerTests(TestCase):
    @patch("wambridge.stream.shutil.which", return_value="C:/ffmpeg/bin/ffmpeg.exe")
    def test_builds_raw_pcm_input_arguments(self, _which_mock) -> None:
        pcm_input = BytesIO()
        server = PcmAudioStreamServer(
            pcm_input,
            sample_rate=44100,
            channels=2,
            sample_format="f32le",
        )
        try:
            self.assertEqual(
                server.input_args,
                (
                    "-f",
                    "f32le",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-i",
                    "pipe:0",
                ),
            )
            self.assertIs(server.pcm_input, pcm_input)
            self.assertFalse(server.encoder_started.is_set())
        finally:
            server.close()

    @patch("wambridge.stream.shutil.which", return_value="ffmpeg")
    def test_rejects_invalid_pcm_shape(self, _which_mock) -> None:
        with self.assertRaisesRegex(ValueError, "sample rate"):
            PcmAudioStreamServer(BytesIO(), sample_rate=0, channels=2)
        with self.assertRaisesRegex(ValueError, "channel count"):
            PcmAudioStreamServer(BytesIO(), sample_rate=48000, channels=0)
        with self.assertRaisesRegex(ValueError, "unsupported PCM format"):
            PcmAudioStreamServer(
                BytesIO(),
                sample_rate=48000,
                channels=2,
                sample_format="u8",
            )
