"""Raw PCM input streamed through FFmpeg to Samsung WAM."""

from __future__ import annotations

import logging
import subprocess
import threading
from typing import BinaryIO

from .stream import (
    CHUNK_SIZE,
    STARTUP_CHUNK_SIZE,
    STARTUP_SILENCE_MS,
    AudioStreamServer,
    StreamError,
    _read_chunk,
)

LOGGER = logging.getLogger(__name__)
PCM_FORMATS = ("f32le", "s16le")
MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 384000
MIN_CHANNELS = 1
MAX_CHANNELS = 32


class PcmAudioStreamServer(AudioStreamServer):
    """Serve raw PCM received from a parent process as WAM-compatible audio."""

    def __init__(
        self,
        pcm_input: BinaryIO,
        *,
        sample_rate: int,
        channels: int,
        sample_format: str = "f32le",
        profile: str = "flac",
        bind: str = "0.0.0.0",  # nosec B104 - WAM must reach the LAN server
        port: int = 0,
        ffmpeg: str = "ffmpeg",
    ) -> None:
        if not MIN_SAMPLE_RATE <= sample_rate <= MAX_SAMPLE_RATE:
            raise ValueError(
                f"sample rate must be between {MIN_SAMPLE_RATE} and "
                f"{MAX_SAMPLE_RATE} Hz"
            )
        if not MIN_CHANNELS <= channels <= MAX_CHANNELS:
            raise ValueError(
                f"channel count must be between {MIN_CHANNELS} and {MAX_CHANNELS}"
            )
        if sample_format not in PCM_FORMATS:
            raise ValueError(
                f"unsupported PCM format {sample_format!r}; "
                f"choose from {', '.join(PCM_FORMATS)}"
            )

        self.pcm_input = pcm_input
        self.sample_rate = sample_rate
        self.channels = channels
        self.sample_format = sample_format
        self.encoder_started = threading.Event()
        super().__init__(
            "raw PCM input",
            profile=profile,
            bind=bind,
            port=port,
            ffmpeg=ffmpeg,
        )

    @property
    def input_args(self) -> tuple[str, ...]:
        """Return FFmpeg arguments describing the incoming PCM stream."""
        return (
            "-f",
            self.sample_format,
            "-ar",
            str(self.sample_rate),
            "-ac",
            str(self.channels),
            "-i",
            "pipe:0",
        )

    def prepare(self, timeout: float = 20.0) -> None:
        """Skip source preflight because PCM is supplied after the READY marker."""
        del timeout

    def _serve_audio(self, output: BinaryIO) -> None:
        command = [
            self.ffmpeg,
            "-hide_banner",
            "-loglevel",
            "warning",
            *self.input_args,
            "-af",
            f"adelay={STARTUP_SILENCE_MS}:all=1",
            *self.profile.ffmpeg_args,
            "pipe:1",
        ]
        LOGGER.info(
            "Starting FFmpeg for %s Hz, %s channel %s PCM",
            self.sample_rate,
            self.channels,
            self.sample_format,
        )
        process = subprocess.Popen(  # nosec B603 - argv list, resolved executable
            command,
            stdin=self.pcm_input,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        with self._process_lock:
            self._process = process
        self.encoder_started.set()

        assert process.stdout is not None
        first_chunk = _read_chunk(process.stdout, STARTUP_CHUNK_SIZE)
        if not first_chunk:
            process.wait(timeout=5)
            raise StreamError(f"FFmpeg produced no audio (exit {process.returncode})")

        try:
            output.write(first_chunk)
            output.flush()
            self.audio_started.set()
            while chunk := _read_chunk(process.stdout, CHUNK_SIZE):
                output.write(chunk)
                output.flush()
        except (BrokenPipeError, ConnectionResetError):
            LOGGER.info("Speaker closed the PCM stream")
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
            with self._process_lock:
                self._process = None
            if process.returncode not in {0, -15, 1}:
                LOGGER.error("FFmpeg exited with %s", process.returncode)
