"""Small client for the local Samsung WAM HTTP API."""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import quote
from urllib.request import ProxyHandler, build_opener
from xml.etree import ElementTree

DEFAULT_PORT = 55001
LOCAL_OPENER = build_opener(ProxyHandler({}))


class WamApiError(RuntimeError):
    """Raised when a speaker rejects or cannot receive a command."""


@dataclass(frozen=True, slots=True)
class WamResponse:
    """Parsed response returned by the speaker."""

    method: str | None
    result: str | None
    body: str
    values: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WamIdentity:
    """Stable identity and current display name returned by a speaker."""

    device_id: str
    name: str | None


def build_command(
    method: str,
    arguments: list[tuple[str, str | int, str]] | None = None,
) -> str:
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


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_response(body: str) -> WamResponse:
    """Parse and validate one XML response from a Samsung WAM speaker."""
    try:
        root = ElementTree.fromstring(body)  # nosec B314 - small response from local speaker
    except ElementTree.ParseError as error:
        raise WamApiError(f"Samsung WAM returned invalid XML: {body[:200]}") from error

    response_node = root.find("response")
    result = response_node.get("result") if response_node is not None else None
    response_method = root.findtext("method")
    if result != "ok":
        error_code = response_node.get("errcode") if response_node is not None else None
        suffix = f" (error {error_code})" if error_code else ""
        raise WamApiError(f"Samsung WAM rejected {response_method or 'request'}{suffix}")

    values: dict[str, str] = {}
    if response_node is not None:
        for node in response_node.iter():
            if node is response_node:
                continue
            name = node.get("name") or _local_name(node.tag)
            value = node.get("val")
            if value is None and node.text:
                value = node.text.strip()
            if name and value:
                values[name] = value

    return WamResponse(
        method=response_method,
        result=result,
        body=body,
        values=values,
    )


def request(
    speaker_ip: str,
    method: str,
    arguments: list[tuple[str, str | int, str]] | None = None,
    *,
    port: int = DEFAULT_PORT,
    timeout: float = 5.0,
    api_type: str = "UIC",
) -> WamResponse:
    """Send one command and validate the returned XML."""
    url = build_api_url(
        speaker_ip,
        method,
        arguments,
        port=port,
        api_type=api_type,
    )
    try:
        with LOCAL_OPENER.open(url, timeout=timeout) as response:  # nosec B310 - local API
            body = response.read().decode("utf-8", errors="replace")
    except OSError as error:
        raise WamApiError(f"Cannot reach Samsung WAM at {speaker_ip}:{port}: {error}") from error
    return parse_response(body)


def normalize_device_id(value: str) -> str:
    """Normalize separator and case differences in Samsung device IDs."""
    return "".join(character for character in value.upper() if character.isalnum())


def _first_value(response: WamResponse, *names: str) -> str | None:
    for name in names:
        if value := response.values.get(name):
            return value
    return None


def probe(speaker_ip: str, *, port: int = DEFAULT_PORT, timeout: float = 5.0) -> WamResponse:
    """Check that the target is a responding Samsung WAM speaker."""
    return request(speaker_ip, "GetSpkName", port=port, timeout=timeout)


def get_device_id(
    speaker_ip: str,
    *,
    port: int = DEFAULT_PORT,
    timeout: float = 5.0,
) -> str:
    """Return the speaker's stable 12-character ID from the CPM API."""
    response = request(
        speaker_ip,
        "GetDeviceId",
        port=port,
        timeout=timeout,
        api_type="CPM",
    )
    raw_device_id = _first_value(response, "device_id", "deviceid")
    if not raw_device_id:
        raise WamApiError("Samsung WAM response did not contain device_id")
    device_id = normalize_device_id(raw_device_id)
    if not device_id:
        raise WamApiError("Samsung WAM returned an empty device_id")
    return device_id


def identify(
    speaker_ip: str,
    *,
    port: int = DEFAULT_PORT,
    timeout: float = 5.0,
) -> WamIdentity:
    """Read stable identity and current display name from a WAM speaker."""
    name_response = probe(speaker_ip, port=port, timeout=timeout)
    name = _first_value(name_response, "spkname", "speakername")
    device_id = get_device_id(speaker_ip, port=port, timeout=timeout)
    return WamIdentity(device_id=device_id, name=name)


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
