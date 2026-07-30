"""Process protocol for streaming foobar2000 PCM to Samsung WAM."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from time import monotonic
from typing import BinaryIO, TextIO

from .cli import choose_start_volume, select_speaker, volume_level
from .discovery import local_ip_for
from .pcm_stream import PCM_FORMATS, PcmAudioStreamServer
from .profiles import ProfileError, ProfileStore
from .samsung import WamApiError, get_volume, play_url, probe, set_volume
from .stream import OUTPUT_PROFILES, StreamError

LOGGER = logging.getLogger("wambridge")
DEFAULT_MAX_START_VOLUME = 10


def sample_rate(value: str) -> int:
    """Parse a PCM sample rate."""
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("sample rate must be an integer") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("sample rate must be positive")
    return parsed


def channel_count(value: str) -> int:
    """Parse a PCM channel count."""
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("channels must be an integer") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("channels must be positive")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    """Create the helper protocol parser."""
    parser = argparse.ArgumentParser(
        prog="wambridge-pcm",
        description="Read raw PCM from stdin and stream it to Samsung WAM.",
    )
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--speaker", help="Speaker IPv4 address")
    target.add_argument(
        "--device",
        help="Saved device alias; current IP is resolved automatically",
    )
    parser.add_argument("--port", type=int, default=55001)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--discovery-timeout", type=float, default=4.0)
    parser.add_argument(
        "--interface",
        action="append",
        dest="interfaces",
        help="Local IPv4 used for discovery; may be repeated",
    )
    parser.add_argument("--no-scan", action="store_true")
    parser.add_argument(
        "--sample-rate",
        type=sample_rate,
        required=True,
        help="Input PCM sample rate in Hz",
    )
    parser.add_argument(
        "--channels",
        type=channel_count,
        required=True,
        help="Input PCM channel count",
    )
    parser.add_argument(
        "--sample-format",
        choices=PCM_FORMATS,
        default="f32le",
        help="Input PCM sample format",
    )
    parser.add_argument(
        "--format",
        choices=sorted(OUTPUT_PROFILES),
        default="flac",
        help="Format sent to the speaker",
    )
    parser.add_argument("--volume", type=volume_level)
    parser.add_argument(
        "--max-start-volume",
        type=volume_level,
        default=DEFAULT_MAX_START_VOLUME,
    )
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--http-port", type=int, default=0)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument(
        "--startup-timeout",
        type=float,
        default=30.0,
        help="Seconds to wait for the speaker and first PCM frame",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def _wait_for_stream_event(
    server: PcmAudioStreamServer,
    event_name: str,
    *,
    timeout: float,
) -> None:
    event = getattr(server, event_name)
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        if event.wait(timeout=min(0.1, max(0.0, deadline - monotonic()))):
            return
        if server.request_finished.is_set():
            raise StreamError(
                server.error or f"PCM stream ended before {event_name}"
            )
    raise StreamError(f"Timed out waiting for {event_name}")


def run(
    args: argparse.Namespace,
    *,
    pcm_input: BinaryIO | None = None,
    protocol_output: TextIO | None = None,
) -> int:
    """Run one raw-PCM helper session."""
    input_stream = pcm_input if pcm_input is not None else sys.stdin.buffer
    output_stream = protocol_output if protocol_output is not None else sys.stdout
    store = ProfileStore(args.config)
    speaker_ip, speaker_port = select_speaker(args, store)
    response = probe(speaker_ip, port=speaker_port)
    LOGGER.info(
        "Speaker %s replied with %s",
        speaker_ip,
        response.method or "XML",
    )

    host_ip = local_ip_for(speaker_ip)
    server = PcmAudioStreamServer(
        input_stream,
        sample_rate=args.sample_rate,
        channels=args.channels,
        sample_format=args.sample_format,
        profile=args.format,
        bind=args.bind,
        port=args.http_port,
        ffmpeg=args.ffmpeg,
    )
    restore_volume: int | None = None
    startup_complete = False
    try:
        current_volume = get_volume(speaker_ip, port=speaker_port)
        restore_volume = current_volume
        start_volume = choose_start_volume(
            current_volume,
            args.volume,
            args.max_start_volume,
        )
        LOGGER.info(
            "Speaker volume is %s; starting PCM playback at %s",
            current_volume,
            start_volume,
        )

        server.start()
        stream_url = server.url(host_ip)
        LOGGER.info("Offering %s to %s", stream_url, speaker_ip)
        set_volume(speaker_ip, 0, port=speaker_port)
        play_url(speaker_ip, stream_url, port=speaker_port)
        set_volume(speaker_ip, 0, port=speaker_port)

        if not server.request_started.wait(timeout=args.startup_timeout):
            raise StreamError(
                "Speaker accepted URL playback but did not request the PCM stream"
            )
        set_volume(speaker_ip, 0, port=speaker_port)
        server.release_audio()
        _wait_for_stream_event(
            server,
            "encoder_started",
            timeout=args.startup_timeout,
        )
        print("WAMBRIDGE READY", file=output_stream, flush=True)

        _wait_for_stream_event(
            server,
            "audio_started",
            timeout=args.startup_timeout,
        )
        set_volume(speaker_ip, start_volume, port=speaker_port)
        startup_complete = True
        print(
            f"WAMBRIDGE PLAYING volume={start_volume}",
            file=output_stream,
            flush=True,
        )

        while not server.request_finished.wait(timeout=1):
            pass
        if server.error:
            raise StreamError(server.error)
        return 0
    except KeyboardInterrupt:
        print("WAMBRIDGE STOPPING", file=output_stream, flush=True)
        return 130
    finally:
        try:
            server.close()
        finally:
            if restore_volume is not None and not startup_complete:
                try:
                    set_volume(
                        speaker_ip,
                        restore_volume,
                        port=speaker_port,
                    )
                except WamApiError as error:
                    LOGGER.warning(
                        "Could not restore speaker volume after aborted PCM "
                        "startup: %s",
                        error,
                    )


def main(argv: list[str] | None = None) -> int:
    """Run the PCM helper protocol."""
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )
    try:
        return run(args)
    except (
        RuntimeError,
        StreamError,
        WamApiError,
        ProfileError,
        ValueError,
    ) as error:
        LOGGER.error("%s", error)
        print(f"WAMBRIDGE ERROR {error}", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
