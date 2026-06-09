---
name: python-scraping-feeds
description: Write Python for fetching web pages and APIs, parsing HTML and JSON, and emitting structured artifacts like RSS/Atom feeds or M3U playlists. Use whenever a task involves HTTP fetching (requests, httpx, curl-cffi, aiohttp), HTML/JSON parsing (BeautifulSoup, lxml, selectolax, parsel), reading or writing feeds (feedgen, feedparser), data validation (Pydantic, dataclasses), timezone-aware datetimes, retry/backoff, caching, or scheduled scrapers in CI. Also use for the travino/feeds feed generators and travino/tvpi generate.py, or any "scraper", "feed generator", "playlist generator", "ETL", or "fetch then parse then write a file" Python task, even when specific libraries are not named.
license: MIT
---

# Python: Scraping, Parsing & Feed Generation

The shape of the task: a scheduled job **fetches** from a flaky upstream,
**parses** out items, and **emits** a stable artifact (feed, playlist, dataset) —
durably enough that one transient failure never wipes good output.

This skill covers the wider toolbox and the tradeoffs between choices, then
points at the `travino/feeds` + `travino/tvpi` code as one concrete
instantiation. Pick tools to fit the job; don't cargo-cult a single stack.
Target Python is **3.11+**.

---

## 1. Fetching

**Pick a client by need, not habit:**

| Need | Reach for | Why |
|------|-----------|-----|
| Simple sync calls | `requests` | Ubiquitous, easy; no async |
| Async / HTTP-2 / modern | `httpx` | Sync *and* async same API, HTTP/2, connection pooling |
| Heavy async fan-out | `aiohttp` | Mature async-first |
| Anti-bot / TLS fingerprinting (403s) | `curl-cffi` | `impersonate="chrome"` defeats JA3/Cloudflare blocks |
| Zero dependencies | stdlib `urllib.request` | Minimal CI steps (what `tvpi/generate.py` uses) |

Non-negotiables regardless of client:

- **Always set a timeout.** A hung connection blocks the whole run forever.
  Use a `(connect, read)` tuple where supported.
- **Check status:** `raise_for_status()` (or inspect `res.ok`) so an error page
  isn't parsed as data.
- **Reuse connections:** a `requests.Session()` / `httpx.Client()` pools sockets
  and shares headers/cookies across calls.
- **Identify yourself:** a browser-like `User-Agent`; a `Referer` when the API
  expects one.

**Retries & backoff** — don't hand-roll naive loops. Options, simplest first:

- `urllib3` `Retry` mounted on an `HTTPAdapter` (built into requests' stack).
- `tenacity` — decorator-based, composable (`@retry(wait=wait_exponential_jitter())`).
- `backoff` — lightweight decorator alternative.
- **Always add jitter** to exponential backoff so concurrent clients don't
  retry in lockstep (the "thundering herd").
- Distinguish *transport failure* (retry) from *reached-but-empty* (return
  `None`, fall back) — they call for different responses.

**Caching & rate limits:** `requests-cache` transparently caches responses
(huge for dev iteration and polite scraping); a token-bucket / simple sleep
respects `Retry-After` and rate caps.

## 2. Parsing

**Prefer structured sources over scraping rendered HTML** — they break far less:

1. A real **API** (JSON) if one exists.
2. **Embedded JSON**: `__NEXT_DATA__`, `application/ld+json` (JSON-LD), Redux
   state blobs — `json.loads` the script tag and walk a documented path.
3. **Sitemaps** (`/sitemap.xml`) and **existing feeds** — parse with
   `feedparser` rather than scraping a listing page.
4. Only then, **HTML**.

**HTML parser options:**

| Library | Strength |
|---------|----------|
| BeautifulSoup + `lxml` | Forgiving, ergonomic, the default |
| `lxml` directly | Fast, full **XPath** |
| `selectolax` | Very fast CSS on huge pages |
| `parsel` | Scrapy's selectors (CSS + XPath), standalone |

Parse defensively: `el = soup.select_one(...)` then guard `if el is None`. One
specific selector beats a deep `.find().find()` chain — it's the single line you
edit when markup shifts. Fail *per item*, not the whole run.

## 3. Modeling & validating data

Validate at the boundary so bad input fails there, not three layers deep.

- **Pydantic v2** for config/external data: `BaseModel`, `@field_validator`
  (+`@classmethod`), `StrEnum` for closed value sets; `pydantic-settings` for
  env-driven config.
- **dataclasses / `TypedDict`** when you only need structure, not coercion —
  lighter, stdlib.
- **Validate-and-skip on collections:** when loading many configs, catch
  `ValidationError` per entry, log it, keep the valid ones. One malformed entry
  must never take down the batch.

## 4. Dates — always timezone-aware

Naive datetimes corrupt ordering and `pubDate`. Rules:

- Parse unknown strings with `dateutil.parser`; store/compare in UTC.
- **Prefer stdlib `zoneinfo`** (3.9+) over `pytz` for new code — no
  `localize()` footgun. (`pytz` is fine where a codebase already standardizes
  on it.)
- For dateless items, derive a **stable** fallback from a hash of the
  URL/title — never `datetime.now()` (reshuffles every run) and never builtin
  `hash()` (salted per process). Use `hashlib`.

## 5. Emitting artifacts

- **Feeds:** `feedgen` builds Atom/RSS. Gotchas: set `rel="self"` *before*
  `rel="alternate"`; it writes newest-first by reversing input, so sort
  **ascending**; sanitize every text field (XML 1.0 forbids NULL and most
  C0/C1 control chars).
- **Playlists/other text formats:** build line-by-line (e.g. M3U `#EXTM3U` +
  `#EXTINF` headers).
- **Write atomically:** write to a temp file then `os.replace()` — a crash
  mid-write otherwise leaves a half-truncated artifact that downstreams choke on.
- **Make output deterministic:** stable ordering + stable ids so reruns produce
  byte-identical files when nothing changed (clean diffs, no churn commits).

## 6. Resilience & idempotency (the part that matters)

- **Last-known-good:** resolve each item as fresh → cached/previous → placeholder.
  A transient failure reuses the last good value; never clobber valid output.
- **Incremental cache:** fetch only what's new; merge + dedupe by stable id;
  serialize datetimes to ISO on save; tolerate a corrupt cache by starting fresh.
- **Partial success:** exit non-zero only when *everything* failed, so a partial
  run still publishes good data.
- **Structured logging to stderr;** keep stdout clean for piped output.
- **Idempotent reruns:** running twice produces the same result — essential for
  retried CI jobs.

## 7. Scheduled runtime (CI / cron)

- Secrets and identity via env (`GITHUB_REPOSITORY` is set automatically in
  Actions; provide a local override var).
- Repo-relative paths via `pathlib.Path(__file__)` so CWD doesn't matter.
- Commit/publish only when output actually changed.

---

## Project example (one instantiation)

`travino/feeds` + `travino/tvpi` implement the above with a deliberately small
stack (requests, feedgen, pydantic, pytz, stdlib). Worth knowing if you touch
those repos — but treat it as *an* example, not the only shape:

- `feeds/feed_generators/utils.py` — shared fetch, `sanitize_xml`,
  `stable_fallback_date`, cache trio, feed-link/order helpers. Import, don't
  reimplement.
- `feeds/feed_generators/models.py` — `FeedConfig`/`FeedType` + validate-and-skip
  loader.
- `tvpi/generate.py` — stdlib-only, last-known-good reuse, placeholder on miss,
  M3U output.

**Ideas these repos could adopt** (the "outside perspective"): `zoneinfo`
instead of `pytz`; atomic writes via `os.replace`; `requests-cache` for polite
dev iteration; `tenacity` backoff-with-jitter instead of bare retries;
`feedparser` to ingest sources that already publish a feed.

Annotated repo snippets: `references/project-conventions.md`.
Wider toolbox + tradeoffs: `references/alternatives.md`.

## Quick checklist

1. Right client for the job; timeout + status check + session reuse always.
2. Retry with **jittered** backoff; transport-fail vs reached-empty.
3. Structured source (API/JSON/sitemap/feed) before HTML; defensive selectors.
4. Validate at the boundary; skip-and-log invalid entries in batches.
5. Timezone-aware UTC; stable hash fallback for dateless items.
6. Atomic, deterministic writes; feed link order + ascending sort + sanitize.
7. Last-known-good + incremental cache; partial-success exit codes; idempotent.
