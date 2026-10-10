#!/usr/bin/env python3
"""Download individual media into the ignored workspace folder for browser pickup."""

import argparse
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit


DOWNLOADS = Path(__file__).resolve().parent.parent / "downloads"
MIB = 1024 * 1024


def validate_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ValueError("Expected an HTTP(S) media URL")
    if parsed.username or parsed.password:
        raise ValueError("Credentials in URLs are not supported")
    return value


# One maintained preset. Prefer MP4 with M4A audio; fall back to other formats.
VIDEO_FORMAT = "bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"
OUTPUT_NAME = "%(uploader).40B_%(title).120B_%(id)s.%(ext)s"


def command_for(url: str, *, audio: bool, best: bool) -> list[str]:
    cmd = [
        "yt-dlp", "--ignore-config", "--no-playlist", "--no-overwrites",
        "--restrict-filenames", "--max-filesize", "4G",
        "--paths", str(DOWNLOADS),
        "--output", OUTPUT_NAME,
        "--print", "after_move:filepath",
        "--embed-metadata", "--embed-chapters",
    ]
    if audio:
        cmd += [
            "-f", "ba/b", "--extract-audio", "--audio-format", "mp3",
            "--audio-quality", "0", "--embed-thumbnail",
            "--convert-thumbnails", "jpg",
        ]
    else:
        cmd += [
            "-f", VIDEO_FORMAT,
            "-S", "res,fps" if best else "res:2160,fps",
            "--merge-output-format", "mp4/mkv",
            "--embed-subs", "--sub-langs", "en.*,pl.*",
            "--sub-format", "srt/best/ass",
        ]
    cmd.append(validate_url(url))
    return cmd


def fetch(url: str, *, audio: bool, best: bool) -> int:
    cmd = command_for(url, audio=audio, best=best)
    for name in ("yt-dlp", "ffmpeg", "ffprobe"):
        if shutil.which(name) is None:
            print(f"Missing {name}. Run: devbox install media")
            return 1
    available = shutil.disk_usage(DOWNLOADS.parent).free
    required = 512 * MIB if audio else 5 * 1024 * MIB
    if available < required:
        print(f"Not enough free disk space ({available // MIB} MiB).")
        return 1
    if DOWNLOADS.is_symlink():
        print("Refusing symlinked downloads folder")
        return 1
    DOWNLOADS.mkdir(mode=0o700, exist_ok=True)
    print(f"Media destination: {DOWNLOADS}", flush=True)
    print("Download only media you have rights or permission to save.", flush=True)
    return subprocess.run(cmd, check=False).returncode


def list_files() -> None:
    if DOWNLOADS.is_symlink():
        raise SystemExit("Refusing symlinked downloads folder")
    if not DOWNLOADS.is_dir():
        print("No downloads yet. Run: devbox fetch <URL>")
        return
    total = 0
    for item in sorted(DOWNLOADS.iterdir(), key=lambda x: x.name.casefold()):
        if item.is_file() and not item.is_symlink():
            size = item.stat().st_size
            total += size
            print(f"{size / MIB:8.1f} MiB  {item.name}")
    print(f"Total: {total / MIB:.1f} MiB")
    print(f"Browse: {DOWNLOADS}")
    print("For automatic cleanup: devbox handoff \"exact filename\"")
    print("VS Code Explorer downloads cannot confirm completion to Devbox.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch", help="Download one video or audio URL")
    fetch_parser.add_argument("url")
    fetch_parser.add_argument("--audio", action="store_true", help="Convert to MP3")
    fetch_parser.add_argument("--best", action="store_true", help="Ignore 2160p preference; choose highest resolution")
    sub.add_parser("files", help="List files available for browser download")
    args = parser.parse_args()
    if args.command == "fetch":
        try:
            return fetch(args.url, audio=args.audio, best=args.best)
        except ValueError as exc:
            parser.error(str(exc))
    list_files()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
