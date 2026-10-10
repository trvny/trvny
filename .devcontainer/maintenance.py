#!/usr/bin/env python3
"""Conservative Codespaces housekeeping. Never touch workspaces or credentials."""

import argparse
from contextlib import ExitStack
import fcntl
from pathlib import Path
import shutil
import subprocess
import time


WEEK = 7 * 86400
DAY = 86400


def managed_candidates(home: Path, *, manual: bool, now: float) -> list[Path]:
    root = home / ".local/share/travny-devbox"
    if root.is_symlink() or not root.is_dir():
        return []

    result: list[Path] = []

    def aged(base: Path, pattern: str, days: int) -> list[Path]:
        if base.is_symlink() or not base.is_dir():
            return []
        matches = []
        for item in base.glob(pattern):
            # Only immediate, real children in known disposable directories.
            if item.parent != base or item.is_symlink() or not item.exists():
                continue
            if not (item.is_dir() or item.is_file()):
                continue
            if now - item.stat().st_mtime >= days * DAY:
                matches.append(item)
        return matches

    result += aged(root, ".ubol-stage-*", 2)
    result += aged(root / "chromium-profiles", "smoke-*", 2)
    result += aged(root / "logs", "*.log", 21)

    if manual:
        extensions = root / "extensions"
        if not extensions.is_symlink() and extensions.is_dir():
            versions = [
                item for item in extensions.glob("uBOLite-*")
                if item.parent == extensions and item.is_dir() and not item.is_symlink()
            ]
            versions.sort(key=lambda item: item.stat().st_mtime, reverse=True)
            current = (root / "ubol").resolve()
            keep = set(versions[:2]) | {current}
            result += [
                item for item in versions
                if item not in keep and now - item.stat().st_mtime >= 30 * DAY
            ]
            result += aged(extensions, "legacy-*", 30)
    return result


def display_sizes(home: Path) -> None:
    usage = shutil.disk_usage(home)
    print(f"Disk: {usage.free // (1024 ** 3)} GiB free / "
          f"{usage.total // (1024 ** 3)} GiB total")
    targets = {
        "Devbox": home / ".local/share/travny-devbox",
        "uv": home / ".cache/uv",
        "pip": home / ".cache/pip",
        "npm": home / ".npm",
        "Playwright": home / ".cache/ms-playwright",
        "Gradle": home / ".gradle/caches",
    }
    for label, path in targets.items():
        if path.is_symlink() or not path.exists():
            continue
        try:
            result = subprocess.run(
                ["du", "-sh", "--", str(path)],
                capture_output=True, text=True, timeout=15, check=True,
            )
            print(f"{label}: {result.stdout.split()[0]}")
        except (OSError, subprocess.SubprocessError):
            print(f"{label}: size unavailable")


def prune(path: Path) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing symlink: {path}")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()


def deep_prune() -> None:
    # Explicit only: these caches help performance and can be shared by builds.
    for cmd in (
        ["uv", "cache", "prune"],
        ["npm", "cache", "clean", "--force"],
        ["python3", "-m", "pip", "cache", "purge"],
    ):
        if shutil.which(cmd[0]) is None:
            continue
        print("Running:", " ".join(cmd), flush=True)
        result = subprocess.run(cmd, timeout=180, check=False)
        if result.returncode:
            print(f"Warning: {cmd[0]} returned {result.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--auto", action="store_true", help="Weekly safe housekeeping")
    group.add_argument("--clean", action="store_true", help="Prune aged disposable files")
    group.add_argument("--deep", action="store_true", help="Also prune package caches")
    args = parser.parse_args()

    home = Path.home()
    root = home / ".local/share/travny-devbox"
    if root.is_symlink():
        raise SystemExit("Refusing symlinked Devbox directory")
    root.mkdir(parents=True, exist_ok=True)
    marker = root / ".maintenance-last-auto"
    with ExitStack() as locks:
        lock = locks.enter_context((root / ".maintenance.lock").open("a+"))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Housekeeping already running; skipped")
            return 0

        now = time.time()
        if args.auto:
            try:
                previous = float(marker.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                previous = 0.0
            if 0 <= now - previous < WEEK:
                print("Automatic maintenance already completed this week")
                return 0

        manual = args.clean or args.deep
        if manual:
            # Share the uBOL installer lock before inspecting old releases.
            install_lock = locks.enter_context(
                (root / ".ubol-install.lock").open("a+")
            )
            try:
                fcntl.flock(install_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("uBOL installation in progress; retry manual clean later")
                return 1
        candidates = managed_candidates(home, manual=manual, now=now)
        display_sizes(home)
        print(f"Eligible disposable files/directories: {len(candidates)}")
        for path in candidates:
            print(f"  {'delete' if args.auto or manual else 'candidate'}: {path}")
            if args.auto or manual:
                prune(path)
        if args.deep:
            deep_prune()
        if args.auto:
            marker.write_text(f"{now}\n", encoding="utf-8")
        if args.auto or manual:
            print("Housekeeping complete")
        else:
            print("Report only. Run 'devbox clean' to reclaim eligible files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
