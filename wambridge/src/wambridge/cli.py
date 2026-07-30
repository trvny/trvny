"""Command-line entry point for WAM Bridge."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .discovery import DiscoveredSpeaker, discover, local_ip_for
from .profiles import (
    ProfileError,
    ProfileStore,
    remember_device,
    resolve_device,
)
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
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--speaker", help="Speaker IPv4 address")
    target.add_argument("--device", help="Saved device alias; current IP is resolved automatically")
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
    parser.add_argument("--probe", action="store_true", help="Only test the selected speaker API")
    parser.add_argument("--discover", action="store_true", help="List discovered speakers and exit")
    parser.add_argument("--remember", metavar="ALIAS", help="Save a speaker by stable device ID")
    parser.add_argument("--list-devices", action="store_true", help="List saved device profiles")
    parser.add_argument("--forget", metavar="ALIAS", help="Delete a saved device profile")
    parser.add_argument("--config", type=Path, help="Override the per-user device profile file")
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


def select_discovered_speaker(args: argparse.Namespace) -> str:
    """Discover exactly one speaker."""
    speakers = find_speakers(args)
    if not speakers:
        raise RuntimeError("No Samsung WAM speaker found; pass --speaker IP")
    if len(speakers) > 1:
        addresses = ", ".join(speaker.ip for speaker in speakers)
        raise RuntimeError(f"More than one Samsung WAM found ({addresses}); pass --speaker IP")
    return speakers[0].ip


def select_speaker(
    args: argparse.Namespace,
    store: ProfileStore,
) -> tuple[str, int]:
    """Select a direct address, resolve a saved profile or discover one speaker."""
    if args.device:
        profile = resolve_device(
            args.device,
            store=store,
            timeout=args.discovery_timeout,
            local_addresses=args.interfaces,
            scan=not args.no_scan,
        )
        LOGGER.info(
            "Resolved saved device %s (%s) to %s",
            profile.alias,
            profile.device_id,
            profile.last_ip,
        )
        return profile.last_ip, profile.port
    if args.speaker:
        return args.speaker, args.port
    return select_discovered_speaker(args), args.port


def normalize_source(source: str) -> str:
    """Resolve existing local files while preserving URLs and FFmpeg inputs."""
    path = Path(source).expanduser()
    return str(path.resolve()) if path.exists() else source


def _print_saved_devices(store: ProfileStore) -> int:
    profiles = store.all()
    if not profiles:
        print("No saved Samsung WAM devices")
        return 0
    for profile in profiles:
        print(
            f"{profile.alias}\t{profile.last_ip}:{profile.port}\t"
            f"{profile.device_id}\t{profile.name}"
        )
    return 0


def run(args: argparse.Namespace) -> int:
    """Execute one bridge session."""
    store = ProfileStore(args.config)

    if args.list_devices:
        return _print_saved_devices(store)

    if args.forget:
        removed = store.remove(args.forget)
        print(f"Forgot Samsung WAM device {removed.alias}")
        return 0

    if args.discover:
        speakers = find_speakers(args)
        if not speakers:
            print("No Samsung WAM speakers found")
            return 1
        for speaker in speakers:
            print(f"{speaker.ip}\t{speaker.source}\t{speaker.usn or '-'}")
        return 0

    if args.remember:
        if args.device:
            raise ProfileError("--remember cannot be combined with --device")
        speaker_ip = args.speaker or select_discovered_speaker(args)
        profile = remember_device(
            args.remember,
            speaker_ip,
            port=args.port,
            store=store,
        )
        print(
            f"Saved {profile.alias}: {profile.name} at {profile.last_ip}:{profile.port} "
            f"(device {profile.device_id})"
        )
        return 0

    speaker_ip, speaker_port = select_speaker(args, store)
    response = probe(speaker_ip, port=speaker_port)
    LOGGER.info("Speaker %s replied with %s", speaker_ip, response.method or "XML")
    if args.probe:
        print(f"Samsung WAM reachable at {speaker_ip}:{speaker_port}")
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
        play_url(speaker_ip, stream_url, port=speaker_port)
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
    except (RuntimeError, StreamError, WamApiError, ProfileError, ValueError) as error:
        LOGGER.error("%s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
