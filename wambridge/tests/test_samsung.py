from unittest import TestCase
from urllib.parse import parse_qs, urlparse

from wambridge.samsung import build_api_url, build_command


class SamsungCommandTests(TestCase):
    def test_builds_get_command(self) -> None:
        self.assertEqual(build_command("GetSpkName"), "<name>GetSpkName</name>")

    def test_builds_set_url_playback_command(self) -> None:
        command = build_command(
            "SetUrlPlayback",
            [
                ("url", "http://192.168.1.2:8765/live.flac", "cdata"),
                ("buffersize", 0, "dec"),
            ],
        )

        self.assertIn("<name>SetUrlPlayback</name>", command)
        self.assertIn("<![CDATA[http://192.168.1.2:8765/live.flac]]>", command)
        self.assertIn('name="buffersize" val="0"', command)

    def test_builds_encoded_api_url(self) -> None:
        url = build_api_url("192.168.1.50", "GetSpkName")
        parsed = urlparse(url)

        self.assertEqual(parsed.netloc, "192.168.1.50:55001")
        self.assertEqual(parsed.path, "/UIC")
        self.assertEqual(parse_qs(parsed.query)["cmd"], ["<name>GetSpkName</name>"])
