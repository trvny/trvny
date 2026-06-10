# Wider toolbox & tradeoffs

A catalogue of options beyond any single project's stack, so you can pick
deliberately. None of this is mandatory — it's the menu.

## HTTP clients

- **requests** — the baseline. Sync only. `Session` for pooling. Mount a
  `urllib3` `Retry` on an `HTTPAdapter` for built-in retries.
- **httpx** — sync *and* async with one API, HTTP/2, timeouts as first-class.
  Good default for new code that may need async later.
- **aiohttp** — async-first; pick when you're fanning out hundreds of concurrent
  requests.
- **curl-cffi** — `requests`-compatible API that impersonates a real browser's
  TLS/JA3 fingerprint (`impersonate="chrome"`). The tool when a site returns 403
  to plain clients (Cloudflare, Akamai). Heavier; use only when needed.
- **stdlib urllib.request** — zero deps; fine for a single JSON GET in a minimal
  CI step.

## Retry / backoff / resilience

- **urllib3 Retry** — declarative, mounts onto requests; `backoff_factor`,
  `status_forcelist`, `respect_retry_after_header`.
- **tenacity** — `@retry(stop=stop_after_attempt(n), wait=wait_exponential_jitter())`;
  composable, supports retry-on-exception predicates.
- **backoff** — lighter decorator alternative.
- **Circuit breaker** (e.g. `pybreaker`) — stop hammering a dead upstream; trip
  open after N failures, half-open to probe recovery. Overkill for small
  scrapers, useful at scale.
- **Jitter is mandatory** on any exponential backoff to avoid synchronized
  retry storms.

## Caching & politeness

- **requests-cache** — transparent response cache (SQLite/Redis/filesystem
  backends). Massive dev-loop speedup; polite to upstreams.
- **Rate limiting** — token bucket (`pyrate-limiter`) or a simple per-host sleep;
  always honor `Retry-After`.
- **Conditional requests** — send `If-None-Match`/`If-Modified-Since`, handle
  `304 Not Modified` to skip re-downloads.

## HTML / data extraction

- **BeautifulSoup + lxml** — forgiving, ergonomic; the default.
- **lxml** — fast, full XPath; when CSS isn't expressive enough.
- **selectolax** — Modest API, very fast on large/many pages.
- **parsel** — Scrapy's selector layer, standalone (CSS + XPath + regex).
- **Structured-first**: `feedparser` (existing RSS/Atom), JSON-LD
  (`application/ld+json`), `__NEXT_DATA__`/embedded state, sitemaps, OpenGraph.
  Always cheaper and more stable than DOM scraping.

## Modeling / validation

- **Pydantic v2** — coercion + validation; `pydantic-settings` for env config.
- **dataclasses** / **attrs** — structure without coercion; lighter.
- **TypedDict** — typing for dict-shaped data with no runtime cost.
- Pattern: validate untrusted input at the boundary; keep the core typed and
  trusting.

## Dates

- **zoneinfo** (stdlib, 3.9+) — preferred for new code; IANA tz, no `localize()`.
- **pytz** — fine where already standardized; remember `.localize()`.
- **dateutil** — robust parsing of arbitrary date strings; relativedelta.

## Emitting

- **feedgen** — Atom + RSS writer.
- **rfeed / pyatom** — alternative feed writers.
- **lxml.etree** — when you need full control over the XML.
- **Atomic writes** — temp file + `os.replace()`; never write the artifact in
  place.

## Scheduling / orchestration

- **GitHub Actions cron** — what these repos use; free, git-native output.
- **APScheduler** — in-process scheduling for a long-running service.
- **Prefect / Dagster / Airflow** — real orchestration with retries, observability,
  backfills — when a handful of scripts grows into a pipeline.

## Observability

- Structured JSON logs (one event per line) parse downstream far better than
  free text.
- Emit a run summary (counts: fetched / new / reused / failed) so a glance at
  the log tells you health.
