#!/usr/bin/env python3
"""
validate_feed
=============
Validates the interia-bridge Atom output. Exits non-zero on any problem so a
CI run fails loudly instead of committing a broken feed.

Checks:
  * file exists and is well-formed XML
  * root element is an Atom <feed>
  * required feed-level children are present (id, title, updated)
  * feedparser can parse it without a bozo error
  * at least one <entry>, and every entry has id + title + updated

Usage:
    python3 validate_feed.py [PATH]   (default: feeds/interia-bridge.xml)
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import feedparser

ATOM = "{http://www.w3.org/2005/Atom}"
DEFAULT_PATH = Path("feeds/interia-bridge.xml")


def fail(msg: str) -> None:
    print(f"INVALID: {msg}")
    sys.exit(1)


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH

    if not path.exists():
        fail(f"file not found: {path}")

    # 1. well-formed XML
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        fail(f"not well-formed XML: {exc}")

    # 2. root is an Atom feed
    if root.tag != f"{ATOM}feed":
        fail(f"root element is {root.tag!r}, expected an Atom <feed>")

    # 3. required feed-level children
    for child in ("id", "title", "updated"):
        if root.find(f"{ATOM}{child}") is None:
            fail(f"feed is missing required <{child}>")

    # 4. feedparser sanity check
    parsed = feedparser.parse(str(path))
    if parsed.bozo:
        fail(f"feedparser reported an error: {parsed.bozo_exception}")

    # 5. entries
    entries = root.findall(f"{ATOM}entry")
    if not entries:
        fail("feed contains no <entry> elements")

    for i, entry in enumerate(entries, start=1):
        for child in ("id", "title", "updated"):
            if entry.find(f"{ATOM}{child}") is None:
                fail(f"entry #{i} is missing required <{child}>")

    print(f"VALID: {path} — {len(entries)} entries, well-formed Atom 1.0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
