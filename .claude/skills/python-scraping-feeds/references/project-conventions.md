# Project conventions — annotated patterns

Concrete, copy-ready patterns drawn from `trvny/feeds` and `trvny/tvpi`.
Prefer importing the shared helpers over reimplementing them.

## Table of contents
- Cache trio (load / save / merge)
- Deserialize cached dates
- Feed link + ordering helpers
- Validate-and-skip registry loader
- M3U / playlist generation (tvpi)
- Last-known-good resolution (tvpi)

---

## Cache trio (`utils.py`)

```python
def load_cache(feed_name: str, entries_key: str = "entries") -> dict:
    cache_file = get_cache_file(feed_name)
    if cache_file.exists():
        try:
            with open(cache_file) as f:
                return json.load(f)
        except json.JSONDecodeError:
            logger.warning(f"Corrupted cache {cache_file}, starting fresh")
    return {"last_updated": None, entries_key: []}

def save_cache(feed_name: str, entries: list[dict], entries_key: str = "entries") -> None:
    serializable = []
    for entry in entries:
        e = entry.copy()
        for k, v in e.items():
            if isinstance(v, datetime):
                e[k] = v.isoformat()          # datetimes -> ISO strings
        serializable.append(e)
    data = {"last_updated": datetime.now(pytz.UTC).isoformat(), entries_key: serializable}
    with open(get_cache_file(feed_name), "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def merge_entries(new, cached, id_field="link", date_field="date") -> list[dict]:
    seen = {e[id_field] for e in cached}
    merged = list(cached)
    for e in new:
        if e[id_field] not in seen:
            merged.append(e); seen.add(e[id_field])
    return sort_posts_for_feed(merged, date_field=date_field)
```

## Deserialize cached dates

```python
def deserialize_entries(entries, date_field="date") -> list[dict]:
    out = []
    for entry in entries:
        e = entry.copy()
        if isinstance(e.get(date_field), str):
            try:
                e[date_field] = datetime.fromisoformat(e[date_field])
            except ValueError:
                e[date_field] = stable_fallback_date(e.get("link", ""))
        out.append(e)
    return out
```

## Feed link + ordering helpers

```python
def setup_feed_links(fg, blog_url, feed_name) -> None:
    # rel="self" MUST come before rel="alternate" for feedgen.
    fg.link(href=f"https://raw.githubusercontent.com/{REPO_SLUG}/main/feeds/feed_{feed_name}.xml",
            rel="self")
    fg.link(href=blog_url, rel="alternate")

def sort_posts_for_feed(posts, date_field="date") -> list[dict]:
    # Ascending (newest last); feedgen reverses on write -> newest first.
    with_date = [p for p in posts if p.get(date_field) is not None]
    without_date = [p for p in posts if p.get(date_field) is None]
    with_date.sort(key=lambda x: x[date_field])
    return with_date + without_date   # dateless items pinned to the end
```

`REPO_SLUG` resolves from env so the self-link is correct in CI:
```python
REPO_SLUG = os.getenv("RSS_REPO_SLUG") or os.getenv("GITHUB_REPOSITORY") or "trvny/feeds"
```

## Validate-and-skip registry loader (`models.py`)

```python
def load_feed_registry(return_skipped: bool = False):
    registry_path = Path(__file__).parent.parent / "feeds.yaml"
    if not registry_path.exists():
        raise FileNotFoundError(f"Feed registry not found: {registry_path}")
    with open(registry_path) as f:
        data = yaml.safe_load(f) or {}

    feeds, skipped = {}, []
    for name, config in data.get("feeds", {}).items():
        try:
            feeds[name] = FeedConfig(**config)        # validate per entry
        except ValidationError as e:
            skipped.append(name)
            errors = "; ".join(
                f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()
            )
            logger.error("Skipping invalid feed config '%s' (%s)", name, errors)
    return (feeds, skipped) if return_skipped else feeds
```

One bad entry is logged and skipped — the rest still load.

## M3U / playlist generation (`tvpi/generate.py`)

Stdlib only (no third-party deps), since it runs in a minimal CI step.

```python
def extinf(ch):
    tvg_id = ch.get("id", ch["slug"])
    return (f'#EXTINF:-1 tvg-id="{tvg_id}" tvg-name="{ch["name"]}" '
            f'tvg-logo="{ch["logo"]}" group-title="{ch["group"]}",{ch["name"]}')

def write_m3u(filename, entries):
    lines = ["#EXTM3U"]
    for ch, url in entries:
        lines.append(f"{extinf(ch)}\n{url}")
    with open(filename, "w", encoding="utf-8") as f:
        f.write("\n\n".join(lines) + "\n")
```

JSON API fetch with stdlib:
```python
req = urllib.request.Request(url, headers=HEADERS)
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.loads(r.read())
src = data.get("sources", {}).get("HLS", [])[0]["src"]   # guard each hop
```

## Last-known-good resolution (`tvpi/generate.py`)

```python
def read_existing_url(filename):
    """Return the last http(s) line already on disk, or None."""
    try:
        with open(filename, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("http"):
                    return line
    except FileNotFoundError:
        pass
    return None

def resolve_url(fresh_url, filename):
    if fresh_url:
        return fresh_url, True                  # 1. fresh fetch
    return read_existing_url(filename), False   # 2. last-known-good on disk
```

Main loop: fresh → reuse cached (leave file untouched) → placeholder. Exit 1
only when zero channels resolved, so a partial run still publishes good data.
