from unittest import TestCase
from urllib.parse import parse_qs, urlparse

from wambridge.samsung import (
    build_api_url,
    build_command,
    normalize_device_id,
    parse_response,
)


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

    def test_builds_cpm_device_id_url(self) -> None:
        url = build_api_url("10.0.0.118", "GetDeviceId", api_type="CPM")
        self.assertEqual(urlparse(url).path, "/CPM")

    def test_parses_response_values(self) -> None:
        response = parse_response(
            "<CPM><method>DeviceId</method>"
            '<response result="ok"><device_id>A1:B2:C3:D4:E5:F6</device_id></response></CPM>'
        )

        self.assertEqual(response.method, "DeviceId")
        self.assertEqual(response.values["device_id"], "A1:B2:C3:D4:E5:F6")
        self.assertEqual(normalize_device_id(response.values["device_id"]), "A1B2C3D4E5F6")

    def test_parses_parameter_style_values(self) -> None:
        response = parse_response(
            "<UIC><method>SpkName</method>"
            '<response result="ok"><p name="spkname" val="[Samsung] M5"/></response></UIC>'
        )

        self.assertEqual(response.values["spkname"], "[Samsung] M5")
