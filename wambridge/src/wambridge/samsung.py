"""Small client for the local Samsung WAM HTTP API."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen
from xml.etree import ElementTree

DEFAULT_PORT = 55001


class WamApiError(RuntimeError):
    """Raised when a speaker rejects or cannot receive a command."""


@dataclass(frozen=True, slots=True)
class WamResponse:
    """Parsed response returned by the speaker."""

    method: str | None
    result: str | None
    body: str


def build_command(method: str, arguments: list[tuple[str, str | int, str]] | None = None) -> str:
    """Build the XML command accepted by the Samsung WAM API."""
    parts = [f"<name>{method}</name>"]
    for name, value, value_type in arguments or []:
        if value_type == "cdata":
            safe_value = str(value).replace("]]>", "]]]]><![CDATA[>")
            parts.append(
                f'<p type="cdata" name="{name}" val="empty"><![CDATA[{safe_value}]]></p>'
            )
        elif value_type in {"str", "dec"}:
            parts.append(f'<p type="{value_type}" name="{name}" val="{value}"/>')
        else:
            raise ValueError(f"Unsupported WAM value type: {value_type}")
    return "".join(parts)


def build_api_url(
    speaker_ip: str,
    method: str,
    arguments: list[tuple[str, str | int, str]] | None = None,
    *,
    port: int = DEFAULT_PORT,
    api_type: str = "UIC",
) -> str:
    """Build a complete local WAM API URL."""
    command = build_command(method, arguments)
    return f"http://{speaker_ip}:{port}/{api_type}?cmd={quote(command, safe='')}"


def request(
    speaker_ip: str,
    method: str,
    arguments: list[tuple[str, str | int, str]] | None = None,
    *,
    port: int = DEFAULT_PORT,
    timeout: float = 5.0,
) -> WamResponse:
    """Send one command and validate the returned XML."""
    url = build_api_url(speaker_ip, method, arguments, port=port)
    try:
        with urlopen(url, timeout=timeout) as response:  # noqa: S310 - local device URL
            body = response.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise WamApiError(f"Cannot reach Samsung WAM at {speaker_ip}:{port}: {error}") from error

    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError as error:
        raise WamApiError(f"Samsung WAM returned invalid XML: {body[:200]}") from error

    response_node = root.find("response")
    result = response_node.get("result") if response_node is not None else None
    response_method = root.findtext("method")
    if result != "ok":
        error_code = response_node.get("errcode") if response_node is not None else None
        suffix = f" (error {error_code})" if error_code else ""
        raise WamApiError(f"Samsung WAM rejected {method}{suffix}")

    return WamResponse(method=response_method, result=result, body=body)


def probe(speaker_ip: str, *, port: int = DEFAULT_PORT, timeout: float = 5.0) -> WamResponse:
    """Check that the target is a responding Samsung WAM speaker."""
    return request(speaker_ip, "GetSpkName", port=port, timeout=timeout)


def play_url(
    speaker_ip: str,
    stream_url: str,
    *,
    port: int = DEFAULT_PORT,
    timeout: float = 10.0,
) -> WamResponse:
    """Tell the speaker to fetch and play a local HTTP stream."""
    return request(
        speaker_ip,
        "SetUrlPlayback",
        [
            ("url", stream_url, "cdata"),
            ("buffersize", 0, "dec"),
            ("seektime", 0, "dec"),
            ("resume", 0, "dec"),
        ],
        port=port,
        timeout=timeout,
    )
