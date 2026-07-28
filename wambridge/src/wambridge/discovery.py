"""SSDP discovery for Samsung Wireless Audio Multiroom speakers."""

from __future__ import annotations

import socket
from dataclasses import dataclass
from time import monotonic
from urllib.parse import urlparse

SSDP_ADDRESS = ("239.255.255.250", 1900)
WAM_SEARCH_TARGET = "urn:samsung.com:device:RemoteControlReceiver:1"


@dataclass(frozen=True, slots=True)
class DiscoveredSpeaker:
    """A Samsung WAM device announced over SSDP."""

    ip: str
    location: str
    usn: str | None


def parse_ssdp_response(payload: bytes) -> dict[str, str]:
    """Parse an SSDP response into lower-case header names."""
    text = payload.decode("utf-8", errors="replace")
    headers: dict[str, str] = {}
    for line in text.replace("\r\n", "\n").split("\n")[1:]:
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        headers[name.strip().lower()] = value.strip()
    return headers


def discover(timeout: float = 2.5) -> list[DiscoveredSpeaker]:
    """Discover WAM devices visible in the current local network."""
    message = "\r\n".join(
        [
            "M-SEARCH * HTTP/1.1",
            f"HOST: {SSDP_ADDRESS[0]}:{SSDP_ADDRESS[1]}",
            'MAN: "ssdp:discover"',
            "MX: 2",
            f"ST: {WAM_SEARCH_TARGET}",
            "",
            "",
        ]
    ).encode("ascii")

    found: dict[str, DiscoveredSpeaker] = {}
    deadline = monotonic() + timeout
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.settimeout(min(timeout, 0.5))
        sock.sendto(message, SSDP_ADDRESS)

        while monotonic() < deadline:
            try:
                payload, sender = sock.recvfrom(65535)
            except TimeoutError:
                continue
            headers = parse_ssdp_response(payload)
            location = headers.get("location", "")
            ip = urlparse(location).hostname or sender[0]
            if not ip:
                continue
            found[ip] = DiscoveredSpeaker(
                ip=ip,
                location=location,
                usn=headers.get("usn"),
            )
    return sorted(found.values(), key=lambda item: item.ip)


def local_ip_for(remote_ip: str) -> str:
    """Return the local address selected by the OS for reaching a speaker."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((remote_ip, 9))
        return str(sock.getsockname()[0])
