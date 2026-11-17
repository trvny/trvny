"""Notify IndexNow of changed canonical hub URLs. State advances only on acceptance."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

BASE = "https://travny.pages.dev"
HOST = urlsplit(BASE).netloc
KEY = "e5c82dc398a4a68a5dc77951901293a9"
KEY_URL = f"{BASE}/{KEY}.txt"
API = "https://api.indexnow.org/indexnow"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
MAPS = ("/sitemap.xml", "/przeglad/sitemap.xml")
GUIDES = {"/": "/index.md", "/tv/": "/tv/index.md", "/teksty/": "/teksty/index.md",
          "/teksty/githubowa-kraina/": "/teksty/githubowa-kraina/index.md"}
MAX_BYTES = 12 * 1024 * 1024
MAX_BATCH = 100
MAX_URLS = 10000


def read(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "TRAVNY-IndexNow/1.0"}), timeout=30) as response:
        if response.geturl() != url:
            raise ValueError(f"Unexpected redirect: {url}")
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"Response exceeds limit: {url}")
        return data


def canonical(url: str) -> bool:
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.netloc == HOST and
            parsed.path.startswith("/") and not parsed.query and not parsed.fragment)


def entries(documents: list[bytes]) -> dict[str, str]:
    result = {}
    for document in documents:
        root = ElementTree.fromstring(document)
        if root.tag != "{" + NS["s"] + "}urlset":
            raise ValueError("Expected URL sitemap")
        for item in root.findall("s:url", NS):
            loc = item.findtext("s:loc", "", NS).strip()
            if not canonical(loc):
                raise ValueError(f"Noncanonical URL: {loc}")
            updated = item.findtext("s:lastmod", "", NS).strip()
            result[loc] = updated or result.get(loc, "")
    if not result or len(result) > MAX_URLS:
        raise ValueError("Empty or oversized sitemap")
    return result


def snapshot(fetch=read) -> dict[str, str]:
    result = entries([fetch(BASE + name) for name in MAPS])
    for url, lastmod in list(result.items()):
        # Dated issues use maintained lastmod. Undated guides use content hashes.
        if lastmod:
            result[url] = "date:" + lastmod
        else:
            path = urlsplit(url).path
            source = BASE + GUIDES[path] if path in GUIDES else url
            result[url] = "sha256:" + hashlib.sha256(fetch(source)).hexdigest()
    return result


def changes(previous: dict[str, str], current: dict[str, str]) -> list[str]:
    return sorted(url for url in previous.keys() | current.keys()
                  if canonical(url) and previous.get(url) != current.get(url))


def submit(urls: list[str]) -> int:
    payload = json.dumps({"host": HOST, "key": KEY, "keyLocation": KEY_URL, "urlList": urls}).encode()
    request = Request(API, data=payload, headers={"Content-Type": "application/json; charset=utf-8"})
    with urlopen(request, timeout=30) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"Unexpected IndexNow status {response.status}")
        return response.status


def run(state: Path) -> None:
    previous = json.loads(state.read_text()) if state.exists() else {}
    if read(KEY_URL).decode().strip() != KEY:
        raise ValueError("IndexNow verification file not live; retry after deployment")
    current = snapshot()
    pending = changes(previous, current)
    print(f"Canonical URLs: {len(current)}; changed or removed: {len(pending)}")
    for offset in range(0, len(pending), MAX_BATCH):
        batch = pending[offset:offset + MAX_BATCH]
        status = submit(batch)
        print(f"IndexNow accepted {len(batch)} URLs (HTTP {status})")
        for url in batch:
            if url in current:
                previous[url] = current[url]
            else:
                previous.pop(url, None)
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps(previous, sort_keys=True) + "\n")


if __name__ == "__main__":
    run(Path(sys.argv[1]))
