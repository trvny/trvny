from unittest import TestCase

from wambridge.discovery import parse_ssdp_response


class ParseSsdpResponseTests(TestCase):
    def test_parses_headers_case_insensitively(self) -> None:
        payload = (
            b"HTTP/1.1 200 OK\r\n"
            b"LOCATION: http://192.168.1.50:55001/description.xml\r\n"
            b"USN: uuid:test::urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n"
        )

        headers = parse_ssdp_response(payload)

        self.assertEqual(headers["location"], "http://192.168.1.50:55001/description.xml")
        self.assertEqual(
            headers["usn"],
            "uuid:test::urn:samsung.com:device:RemoteControlReceiver:1",
        )
