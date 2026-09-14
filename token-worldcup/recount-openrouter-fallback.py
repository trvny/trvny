#!/usr/bin/env python3
"""Temporary fallback: count the same Claude Opus 5 request through OpenRouter.

The result is accepted only if five known rows from the earlier direct Anthropic
count_tokens run match exactly after framing subtraction.
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "claude-token-counts.json"
MODEL = "anthropic/claude-opus-5"
EXPECTED = {"Chinese": 117, "English": 128, "Polish": 199, "Greek": 260, "Hindi": 275}

spec = importlib.util.spec_from_file_location("recount", ROOT / "recount-claude-tokens.py")
if spec is None or spec.loader is None:
    raise SystemExit("could not load recount-claude-tokens.py")
recount = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recount)

key = os.environ.get("OPENROUTER_API_KEY")
if not key:
    raise SystemExit("OPENROUTER_API_KEY is not configured")


def count(text: str) -> int:
    body = json.dumps(
        {
            "model": MODEL,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": text}],
        }
    ).encode()
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/messages",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Title": "Token Worldcup recount",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:1000]
        raise SystemExit(f"OpenRouter HTTP {exc.code}: {detail}") from exc
    try:
        return int(payload["usage"]["input_tokens"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SystemExit(f"OpenRouter response has no input token usage: {payload}") from exc


samples = recount.load_samples(recount.QMD)
overhead = count(".") - 1
rows = []
for sample in samples:
    raw = count(sample["text"])
    rows.append(
        {
            "name": sample["name"],
            "lang": sample["lang"],
            "o200k_tokens": sample["tokens"],
            "claude_raw": raw,
            "claude_tokens": max(raw - overhead, 0),
        }
    )

actual = {row["name"]: row["claude_tokens"] for row in rows}
wrong = {name: (expected, actual.get(name)) for name, expected in EXPECTED.items() if actual.get(name) != expected}
if overhead != 6 or wrong:
    raise SystemExit(f"OpenRouter/native count mismatch: overhead={overhead}, rows={wrong}")


def index(key: str) -> None:
    base = next(row[key] for row in rows if row["name"] == recount.ANCHOR)
    for row in rows:
        row[key.replace("_tokens", "") + "_index"] = round(row[key] / base * 100)


def rank(key: str) -> list[dict]:
    field = key.replace("_tokens", "") + "_rank"
    ordered = sorted(rows, key=lambda row: row[key])
    previous = object()
    held = 0
    for pos, row in enumerate(ordered, 1):
        if row[key] != previous:
            previous, held = row[key], pos
        row[field] = held
    for row in ordered:
        row[field + "_tied"] = sum(1 for other in ordered if other[field] == row[field]) > 1
    return ordered


index("o200k_tokens")
index("claude_tokens")
rank("o200k_tokens")
by_claude = rank("claude_tokens")
for row in by_claude:
    row["rank_shift"] = row["o200k_rank"] - row["claude_rank"]

payload = {
    "model": "claude-opus-5",
    "framing_overhead": overhead,
    "measurement_transport": "OpenRouter /v1/messages usage.input_tokens",
    "verification": {"matched_direct_anthropic_rows": EXPECTED},
    "note": "claude_tokens = claude_raw - framing_overhead; verified against five rows from the earlier direct Anthropic count_tokens run",
    "rows": by_claude,
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUT} with {len(rows)} rows; direct-count anchors matched exactly")
