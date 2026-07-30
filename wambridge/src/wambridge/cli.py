"""Command-line entry point for WAM Bridge."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .discovery import DiscoveredSpeaker, discover, local_ip_for
from .samsung import WamApiError, play_url, probe
from .stream import AudioStreamServer, OUTPUT_PROFILES, StreamError

LOGGER = logging.getLogger("wambridge")


def build_parser() -> argparse.ArgumentParser:
    """Create the CLI parser."""
    parser = argparse.ArgumentParser(
        prog="wambridge",
        description="Stream FFmpeg-supported audio to a Samsung WAM speaker over Wi-Fi.",
    )
    parser.add_argument("source", nargs="?", help="Audio file, radio URL or other FFmpeg input")
    parser.add_argument("--speaker", help="Speaker IPv4 address; auto-discovered when omitted")
    parser.add_argument("--port", type=int, default=55001, help="Samsung WAM API port")
    parser.add_argument(
        "--format",
        choices=sorted(OUTPUT_PROFILES),
        default="flac",
        help="Format sent to the speaker (input may be Opus, Ogg, AAC and more)",
    )
    parser.add_argument("--bind", default="0.0.0.0", help="Local HTTP bind address")
    parser.add_argument("--http-port", type=int, default=0, help="Local HTTP port; 0 chooses one")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable or path")
    parser.add_argument("--probe", action="store_true", help="Only test the speaker API")
    parser.add_argument("--discover", action="store_true", help="List discovered speakers and exit")
    parser.add_argument(
        "--discovery-timeout",
        type=float,
        default=4.0,
        help="Seconds to wait for SSDP replies before the API-scan fallback",
    )
    parser.add_argument(
        "--interface",
        action="append",
        dest="interfaces",
        help="Local IPv4 used for SSDP; repeat to try multiple interfaces",
    )
    parser.add_argument(
        "--no-scan",
        action="store_true",
        help="Disable fallback scanning of local /24 networks on port 55001",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def find_speakers(args: argparse.Namespace) -> list[DiscoveredSpeaker]:
    """Run discovery using CLI diagnostics and fallback settings."""
    return discover(
        timeout=args.discovery_timeout,
        local_addresses=args.interfaces,
        port=args.port,
        scan=not args.no_scan,
    )


def select_speaker(args: argparse.Namespace) -> str:
    """Use an explicit IP or discover exactly one speaker."""
    if args.speaker:
        return args.speaker
    speakers = find_speakers(args)
    if not speakers:
        raise RuntimeError("No Samsung WAM speaker found; pass --speaker IP")
    if len(speakers) > 1:
        addresses = ", ".join(speaker.ip for speaker in speakers)
        raise RuntimeError(f"More than one Samsung WAM found ({addresses}); pass --speaker IP")
    return speakers[0].ip


def normalize_source(source: str) -> str:
    """Resolve existing local files while preserving URLs and FFmpeg inputs."""
    path = Path(source).expanduser()
    return str(path.resolve()) if path.exists() else source


def run(args: argparse.Namespace) -> int:
    """Execute one bridge session."""
    if args.discover:
        speakers = find_speakers(args)
        if not speakers:
            print("No Samsung WAM speakers found")
            return 1
        for speaker in speakers:
            print(f"{speaker.ip}\t{speaker.source}\t{speaker.usn or '-'}")
        return 0

    speaker_ip = select_speaker(args)
    response = probe(speaker_ip, port=args.port)
    LOGGER.info("Speaker %s replied with %s", speaker_ip, response.method or "XML")
    if args.probe:
        print(f"Samsung WAM reachable at {speaker_ip}:{args.port}")
        return 0
    if not args.source:
        raise RuntimeError("Provide a file or stream URL, or use --probe")

    host_ip = local_ip_for(speaker_ip)
    server = AudioStreamServer(
        normalize_source(args.source),
        profile=args.format,
        bind=args.bind,
        port=args.http_port,
        ffmpeg=args.ffmpeg,
    )
    try:
        server.prepare()
        server.start()
        stream_url = server.url(host_ip)
        LOGGER.info("Offering %s to %s", stream_url, speaker_ip)
        play_url(speaker_ip, stream_url, port=args.port)
        if not server.request_started.wait(timeout=15):
            raise RuntimeError(
                "Speaker accepted the command but did not request the stream; "
                "check Windows Firewall"
            )
        print(f"Streaming to Samsung WAM at {speaker_ip}. Press Ctrl+C to stop.")
        while not server.request_finished.wait(timeout=1):
            pass
        if server.error:
            raise RuntimeError(server.error)
        return 0
    except KeyboardInterrupt:
        print("\nStopping")
        return 130
    finally:
        server.close()


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )
    try:
        return run(args)
    except (RuntimeError, StreamError, WamApiError, ValueError) as error:
        LOGGER.error("%s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
