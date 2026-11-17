"""Notify IndexNow of changed canonical public URLs. State advances only on acceptance."""
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field
from functools import partial
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from defusedxml import ElementTree

API = "https://api.indexnow.org/indexnow"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


@dataclass(frozen=True)
class Site:
    root: str  # trailing slash; ownership scope
    key: str
    maps: tuple[str, ...] = ("sitemap.xml",)
    guides: dict[str, str] = field(default_factory=dict)
    pages: tuple[str, ...] = ()  # explicit HTML subset for mixed sitemaps
    guide_only: bool = False  # live telemetry is not search content

    @property
    def host(self):
        return urlsplit(self.root).netloc

    @property
    def key_url(self):
        return self.root + self.key + ".txt"


SITES = {
    "hub": Site("https://travny.pages.dev/", "e5c82dc398a4a68a5dc77951901293a9",
                ("sitemap.xml", "przeglad/sitemap.xml"),
                {"/": "index.md", "/tv/": "tv/index.md", "/teksty/": "teksty/index.md",
                 "/teksty/githubowa-kraina/": "teksty/githubowa-kraina/index.md"}),
    "feedseek": Site("https://trvny.github.io/feedseek/", "81245951337e900395962c61557b6ac6",
                    guides={"/feedseek/": "index.md"}),
    "codebench": Site("https://codebench.travny.workers.dev/", "281aa1aafbb3f6d4d5384132bf3b6542",
                     guides={"/": "index.md"}),
    "docbench": Site("https://docbench.travny.workers.dev/", "b7831eb1aadc5c992606547cdbb615f9",
                    guides={"/": "index.md"}),
    "streambench": Site("https://streambench.travny.workers.dev/", "51cad3603d5fce8b8d6dd3c1a55e8142",
                       guides={"/": "index.md"}),
    "weather": Site("https://weather.travny.workers.dev/", "d715f047a08ac671e4dc69cc036a7410",
                    guides={"/": "index.md"}, pages=("/",), guide_only=True),
    "reactor": Site("https://shitpost-reactor.travny.workers.dev/", "3d7f6f7c227e7f3cd4010a286e1e6065",
                    pages=("/", "/archive")),
}
HUB = SITES["hub"]
BASE = HUB.root.rstrip("/")
MAX_BYTES = 12 * 1024 * 1024
MAX_BATCH = 100
MAX_URLS = 1000

# Weather/TV status widgets change continuously; do not turn telemetry into SEO spam.
LIVE_IDS = {"wxtemp", "wxcond", "wxmeta", "wxwarn", "tvcount", "tvbig", "tvchips", "chCount", "rows"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "param", "source", "track", "wbr"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(NoRedirect())


class StableHTML(HTMLParser):
    """Retain document content/metadata, ignoring the known live widget subtrees."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.skipped: list[str] = []

    def handle_starttag(self, tag, attrs):
        if self.skipped or dict(attrs).get("id") in LIVE_IDS:
            if tag not in VOID_TAGS:
                self.skipped.append(tag)
        else:
            self.parts.append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        if not self.skipped and dict(attrs).get("id") not in LIVE_IDS:
            self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if self.skipped:
            if tag == self.skipped[-1]:
                self.skipped.pop()
        else:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skipped:
            self.parts.append(data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")

    def handle_decl(self, decl):
        self.handle_data(f"<!{decl}>")


def read(url: str, site: Site = HUB) -> bytes:
    if not canonical(url, site):
        raise ValueError(f"Unexpected URL: {url}")
    request = Request(url, headers={"User-Agent": "TRAVNY-IndexNow/1.0", "Accept": "text/html, */*;q=0.8"})
    with OPENER.open(request, timeout=30) as response:
        if response.geturl() != url:
            raise ValueError(f"Unexpected redirect: {url}")
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"Response exceeds limit: {url}")
        return data


def canonical(url: str, site: Site = HUB) -> bool:
    parsed = urlsplit(url)
    prefix = urlsplit(site.root).path
    return (parsed.scheme == "https" and parsed.netloc == site.host and
            parsed.path.startswith(prefix) and not parsed.query and not parsed.fragment and
            not any(part in (".", "..") for part in parsed.path.split("/")) and
            "%" not in parsed.path and "\\" not in parsed.path)


def entries(documents: list[bytes], site: Site = HUB) -> dict[str, str]:
    result = {}
    for document in documents:
        root = ElementTree.fromstring(document, forbid_dtd=True, forbid_entities=True, forbid_external=True)
        if root.tag != "{" + NS["s"] + "}urlset":
            raise ValueError("Expected URL sitemap")
        for item in root.findall("s:url", NS):
            loc = item.findtext("s:loc", "", NS).strip()
            if not canonical(loc, site):
                raise ValueError(f"Noncanonical URL: {loc}")
            if site.pages and urlsplit(loc).path not in site.pages:
                continue
            updated = item.findtext("s:lastmod", "", NS).strip()
            result[loc] = updated or result.get(loc, "")
    if not result or len(result) > MAX_URLS:
        raise ValueError("Empty or oversized sitemap")
    return result


def snapshot(fetch=None, site: Site = HUB) -> dict[str, str]:
    if fetch is None:
        fetch = partial(read, site=site)
    result = entries([fetch(site.root + name) for name in site.maps], site)
    for url, lastmod in list(result.items()):
        path = urlsplit(url).path
        html = b"" if site.guide_only else fetch(url)
        if site == HUB and path in ("/", "/tv/"):
            parser = StableHTML()
            parser.feed(html.decode("utf-8"))
            parser.close()
            html = "".join(parser.parts).encode()
        guide = fetch(site.root + site.guides[path]) if path in site.guides else b""
        digest = hashlib.sha256(html).hexdigest() + ":" + hashlib.sha256(guide).hexdigest()
        result[url] = f"{lastmod}:sha256:{digest}"
    return result


def changes(previous: dict[str, str], current: dict[str, str], site: Site = HUB) -> list[str]:
    return sorted(url for url in previous.keys() | current.keys()
                  if canonical(url, site) and previous.get(url) != current.get(url))


def submit(urls: list[str], site: Site = HUB) -> int:
    if not urls or len(urls) > MAX_BATCH or not all(canonical(url, site) for url in urls):
        raise ValueError("Invalid IndexNow batch")
    if urlsplit(API).scheme != "https" or urlsplit(API).netloc != "api.indexnow.org":
        raise ValueError("Unexpected IndexNow endpoint")
    payload = json.dumps({"host": site.host, "key": site.key, "keyLocation": site.key_url, "urlList": urls}).encode()
    request = Request(API, data=payload, headers={"Content-Type": "application/json; charset=utf-8"})
    with OPENER.open(request, timeout=30) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"Unexpected IndexNow status {response.status}")
        return response.status


def run(state: Path, site: Site = HUB) -> None:
    previous = json.loads(state.read_text()) if state.exists() else {}
    if read(site.key_url, site).decode().strip() != site.key:
        raise ValueError("IndexNow verification file not live; retry after deployment")
    current = snapshot(site=site)
    pending = changes(previous, current, site)
    print(f"{site.host}: {len(current)} canonical URLs; {len(pending)} changed or removed")
    for offset in range(0, len(pending), MAX_BATCH):
        batch = pending[offset:offset + MAX_BATCH]
        status = submit(batch, site)
        print(f"IndexNow accepted {len(batch)} URLs (HTTP {status})")
        for url in batch:
            if url in current:
                previous[url] = current[url]
            else:
                previous.pop(url, None)
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps(previous, sort_keys=True) + "\n")


if __name__ == "__main__":
    run(Path(sys.argv[1]), SITES[sys.argv[2]])
