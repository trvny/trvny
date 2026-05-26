#!/usr/bin/env python3
"""
interia-bridge
==============
Combines several Interia / partner RSS feeds into a single Atom 1.0 feed.

Each source feed is fetched, parsed, and its entries are merged into one
de-duplicated, newest-first Atom feed. A failure in one source never aborts
the whole run — that feed is simply skipped with a warning.

Usage:
    python3 interia_bridge.py [--output PATH] [--limit N]

Output: feeds/interia-bridge.xml  (Atom 1.0)
"""

from __future__ import annotations

import argparse
import html
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import feedparser

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

FEED_ID = "interia-bridge"
FEED_TITLE = "interia-bridge"
FEED_SUBTITLE = "Combined feed from Interia services and partner sites"
SELF_URL = "https://example.com/feeds/interia-bridge.xml"  # change to your host
USER_AGENT = (
    "Mozilla/5.0 (compatible; interia-bridge/1.0; +https://example.com)"
)

# (source label, feed URL) — the label is attached to every entry as a category
SOURCES: list[tuple[str, str]] = [
    ("wydarzenia.interia.pl", "https://wydarzenia.interia.pl/feed"),
    ("muzyka.interia.pl", "https://muzyka.interia.pl/feed"),
    ("motoryzacja.interia.pl", "https://motoryzacja.interia.pl/feed"),
    ("terazgotuje.pl", "https://terazgotuje.pl/feed"),
    ("geekweek.interia.pl", "https://geekweek.interia.pl/feed"),
    ("top.pl", "https://top.pl/feed"),
]

DEFAULT_OUTPUT = Path("feeds/interia-bridge.xml")
REQUEST_TIMEOUT = 20  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("interia-bridge")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def normalize_link(link: str) -> str:
    """Normalize a URL so the same article isn't counted twice."""
    if not link:
        return ""
    parts = urlsplit(link.strip())
    # drop fragment, lowercase scheme/host, strip trailing slash on path
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(
        (parts.scheme.lower(), parts.netloc.lower(), path, parts.query, "")
    )


def entry_datetime(entry) -> datetime | None:
    """Best-effort UTC datetime for an entry, or None if unavailable."""
    for key in ("published_parsed", "updated_parsed"):
        struct = entry.get(key)
        if struct:
            try:
                return datetime(*struct[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def to_rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def esc(text: str) -> str:
    """Escape text for inclusion in XML element content / attributes."""
    return html.escape(text or "", quote=True)


def fetch_feed(url: str):
    """Parse a feed URL. feedparser handles HTTP, redirects, and encoding."""
    return feedparser.parse(url, agent=USER_AGENT, request_headers={})


# --------------------------------------------------------------------------
# Collection
# --------------------------------------------------------------------------

def collect_entries(sources: list[tuple[str, str]]) -> list[dict]:
    """Fetch every source and return a flat, de-duplicated entry list."""
    seen: set[str] = set()
    collected: list[dict] = []
    now = datetime.now(timezone.utc)

    for label, url in sources:
        log.info("Fetching %s (%s)", label, url)
        try:
            parsed = fetch_feed(url)
        except Exception as exc:  # noqa: BLE001 - never abort the whole run
            log.warning("  failed to fetch %s: %s", label, exc)
            continue

        if parsed.bozo and not parsed.entries:
            log.warning("  %s returned no usable entries (%s)", label, parsed.bozo_exception)
            continue

        count = 0
        for entry in parsed.entries:
            link = entry.get("link", "")
            key = normalize_link(link) or entry.get("id", "")
            if not key or key in seen:
                continue
            seen.add(key)

            # entry body: prefer full content, fall back to summary
            body = ""
            if entry.get("content"):
                body = entry["content"][0].get("value", "")
            if not body:
                body = entry.get("summary", "")

            collected.append(
                {
                    "title": entry.get("title", "(no title)"),
                    "link": link,
                    "id": entry.get("id") or link or key,
                    "summary": body,
                    "author": entry.get("author", ""),
                    "published": entry_datetime(entry),
                    "source_label": label,
                    "source_url": url,
                }
            )
            count += 1
        log.info("  %d new entries from %s", count, label)

    # newest first; entries without a date sink to the bottom
    collected.sort(
        key=lambda e: e["published"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    # give dateless entries a stable timestamp for the Atom <updated> field
    for e in collected:
        if e["published"] is None:
            e["published"] = now
    return collected


# --------------------------------------------------------------------------
# Atom rendering
# --------------------------------------------------------------------------

def render_atom(entries: list[dict]) -> str:
    feed_updated = entries[0]["published"] if entries else datetime.now(timezone.utc)

    lines: list[str] = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom">',
        f"  <id>urn:feed:{esc(FEED_ID)}</id>",
        f"  <title>{esc(FEED_TITLE)}</title>",
        f"  <subtitle>{esc(FEED_SUBTITLE)}</subtitle>",
        f"  <updated>{to_rfc3339(feed_updated)}</updated>",
        f'  <link rel="self" href="{esc(SELF_URL)}"/>',
        "  <author><name>interia-bridge</name></author>",
        '  <generator uri="https://example.com">interia-bridge</generator>',
    ]

    for e in entries:
        lines.append("  <entry>")
        lines.append(f"    <title>{esc(e['title'])}</title>")
        if e["link"]:
            lines.append(f'    <link rel="alternate" href="{esc(e["link"])}"/>')
        lines.append(f"    <id>{esc(e['id'])}</id>")
        lines.append(f"    <updated>{to_rfc3339(e['published'])}</updated>")
        lines.append(f"    <published>{to_rfc3339(e['published'])}</published>")
        if e["author"]:
            lines.append(f"    <author><name>{esc(e['author'])}</name></author>")
        # source feed attribution, usable for filtering by client
        lines.append(
            f'    <category term="{esc(e["source_label"])}" '
            f'scheme="urn:interia-bridge:source"/>'
        )
        lines.append("    <source>")
        lines.append(f"      <title>{esc(e['source_label'])}</title>")
        lines.append(f'      <link rel="self" href="{esc(e["source_url"])}"/>')
        lines.append("    </source>")
        if e["summary"]:
            lines.append(f'    <summary type="html">{esc(e["summary"])}</summary>')
        lines.append("  </entry>")

    lines.append("</feed>")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Build the interia-bridge Atom feed.")
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="output Atom file path"
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="cap total entries (0 = no limit)"
    )
    args = parser.parse_args()

    entries = collect_entries(SOURCES)
    if args.limit > 0:
        entries = entries[: args.limit]

    if not entries:
        log.warning("No entries collected — writing an empty but valid feed.")

    atom = render_atom(entries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(atom, encoding="utf-8")

    log.info("Wrote %d entries to %s", len(entries), args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
