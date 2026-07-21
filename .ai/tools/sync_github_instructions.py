#!/usr/bin/env python3
"""Synchronize canonical GitHub instructions from .ai into discovery paths."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


MAPPINGS = {
    ".ai/github/copilot-instructions.md": ".github/copilot-instructions.md",
    ".ai/github/instructions/cloudflare.instructions.md": (
        ".github/instructions/cloudflare.instructions.md"
    ),
    ".ai/github/instructions/microsoft.instructions.md": (
        ".github/instructions/microsoft.instructions.md"
    ),
    ".ai/github/agents/trvny-maintainer.md": (
        ".github/agents/trvny-maintainer.md"
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit with status 1 when generated files are out of date.",
    )
    return parser.parse_args()


def add_generated_notice(content: str, source: str) -> str:
    notice = f"<!-- Generated from `{source}`. Edit the source and run the sync tool. -->"
    normalized = content.replace("\r\n", "\n").rstrip() + "\n"

    if normalized.startswith("---\n"):
        closing = normalized.find("\n---\n", 4)
        if closing == -1:
            raise ValueError(f"Unclosed Markdown frontmatter in {source}")
        frontmatter_end = closing + len("\n---\n")
        frontmatter = normalized[:frontmatter_end].rstrip()
        body = normalized[frontmatter_end:].lstrip("\n")
        return f"{frontmatter}\n\n{notice}\n\n{body}"

    return f"{notice}\n\n{normalized}"


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[2]
    drift: list[str] = []

    for source_name, target_name in MAPPINGS.items():
        source = root / source_name
        target = root / target_name

        if not source.is_file():
            print(f"Missing canonical source: {source_name}", file=sys.stderr)
            return 2

        expected = add_generated_notice(source.read_text(encoding="utf-8"), source_name)
        current = target.read_text(encoding="utf-8") if target.is_file() else None

        if current == expected:
            continue

        if args.check:
            drift.append(target_name)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(expected, encoding="utf-8")
        print(f"Synced {target_name}")

    if drift:
        print("Generated GitHub instructions are out of date:", file=sys.stderr)
        for path in drift:
            print(f"- {path}", file=sys.stderr)
        print(
            "Run: python .ai/tools/sync_github_instructions.py",
            file=sys.stderr,
        )
        return 1

    if args.check:
        print("Generated GitHub instructions are in sync.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
