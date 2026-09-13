#!/usr/bin/env python3
"""Recount the Tokenowy Mundial samples with Claude's real tokenizer.

The committed ranking was counted on o200k_base, which is OpenAI's tokenizer.
Claude tokenizes differently and publishes no offline tokenizer, so the only
way to get real numbers is the Messages API's count_tokens endpoint.

The 27 samples are read straight out of token-worldcup.qmd - the maintained
source - so there is no second copy of the corpus to drift.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...          # or: ant auth login
    python3 recount-claude-tokens.py                      # count, print table
    python3 recount-claude-tokens.py --out claude.json    # also write JSON
    python3 recount-claude-tokens.py --model claude-sonnet-5
    python3 recount-claude-tokens.py --dry-run            # no API, check parsing

Method: count_tokens measures a whole request, so every count carries a fixed
framing overhead. We measure that overhead once with a one-character message
and subtract it. That is exact to within a token or two at the seam, which is
well below the differences the ranking is about (English 95 vs Greek 149 on
o200k_base). Raw counts are kept in the JSON so the adjustment stays auditable.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

QMD = pathlib.Path(__file__).with_name("token-worldcup.qmd")
DEFAULT_MODEL = "claude-opus-5"


def load_samples(qmd: pathlib.Path) -> list[dict]:
    """Pull the sample array out of the maintained Quarto source."""
    src = qmd.read_text(encoding="utf-8")
    m = re.search(r"const data=(\[.*?\]);const base=", src, re.S)
    if not m:
        raise SystemExit(f"{qmd.name}: could not find the sample array - has the page changed?")
    data = json.loads(m.group(1))
    missing = [k for k in ("name", "lang", "text", "tokens") for d in data if k not in d]
    if missing:
        raise SystemExit(f"{qmd.name}: sample entries are missing keys: {sorted(set(missing))}")
    return data


def count_with_api(texts: list[str], model: str) -> tuple[list[int], int]:
    """Return (raw counts, framing overhead) from the Messages API."""
    try:
        import anthropic
    except ImportError:
        raise SystemExit("pip install anthropic  (or: uv pip install anthropic)")

    client = anthropic.Anthropic()  # picks up ANTHROPIC_API_KEY or an `ant auth login` profile

    def count(text: str) -> int:
        return client.messages.count_tokens(
            model=model,
            messages=[{"role": "user", "content": text}],
        ).input_tokens

    overhead = count(".") - 1  # one message, one content token
    return [count(t) for t in texts], overhead


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"model whose tokenizer to use (default: {DEFAULT_MODEL})")
    ap.add_argument("--out", type=pathlib.Path, help="write the full comparison as JSON here")
    ap.add_argument("--dry-run", action="store_true", help="parse and lay out the table without calling the API")
    args = ap.parse_args()

    if args.dry_run and args.out:
        raise SystemExit(
            "--dry-run makes no measurements, so --out would write a result-shaped file "
            "full of zeros that nothing downstream could tell from a real recount. "
            "Drop --out to check parsing, or drop --dry-run to measure for real."
        )

    samples = load_samples(QMD)
    print(f"{len(samples)} samples read from {QMD.name}", file=sys.stderr)

    if args.dry_run:
        counts, overhead = [0] * len(samples), 0
        print("dry run: no API calls, Claude columns will read 0", file=sys.stderr)
    else:
        counts, overhead = count_with_api([s["text"] for s in samples], args.model)
        print(f"framing overhead per request: {overhead} tokens (subtracted)", file=sys.stderr)

    rows = []
    for s, raw in zip(samples, counts):
        rows.append({
            "name": s["name"],
            "lang": s["lang"],
            "o200k_tokens": s["tokens"],
            "claude_raw": raw,
            "claude_tokens": max(raw - overhead, 0),
        })

    def index(rows: list[dict], key: str) -> None:
        base = next(r[key] for r in rows if r["name"] == "English")
        for r in rows:
            r[key.replace("_tokens", "") + "_index"] = round(r[key] / base * 100) if base else 0

    index(rows, "o200k_tokens")
    index(rows, "claude_tokens")

    def rank(rows: list[dict], key: str) -> list[dict]:
        """Competition ranking (1,2,3,4,4,6...), the convention the report itself uses.

        Enumerating positions instead would split tied languages - the corpus has
        ties at 104 and 108 tokens - and every such split would show up as a rank
        shift that only reflects array order, not a real move.
        """
        field = key.replace("_tokens", "") + "_rank"
        ordered = sorted(rows, key=lambda r: r[key])
        value = object()
        held = 0
        for pos, r in enumerate(ordered, 1):
            if r[key] != value:
                value, held = r[key], pos
            r[field] = held
            r[field + "_tied"] = False
        for r in ordered:
            r[field + "_tied"] = sum(1 for o in ordered if o[field] == r[field]) > 1
        return ordered

    rank(rows, "o200k_tokens")
    by_claude = rank(rows, "claude_tokens")
    for r in by_claude:
        r["rank_shift"] = r["o200k_rank"] - r["claude_rank"]

    hdr = f"{'#':>3}  {'language':<12} {'o200k':>6} {'claude':>7} {'oIdx':>5} {'cIdx':>5} {'shift':>6}"
    print("\n" + hdr)
    print("-" * len(hdr))
    for r in by_claude:
        shift = r["rank_shift"]
        arrow = "  -  " if shift == 0 else f"{shift:+d}".rjust(5)
        pos = f"{r['claude_rank']}{'=' if r['claude_rank_tied'] else ''}"
        print(f"{pos:>3}  {r['name']:<12} {r['o200k_tokens']:>6} {r['claude_tokens']:>7} "
              f"{r['o200k_index']:>5} {r['claude_index']:>5} {arrow:>6}")

    if args.out:
        payload = {
            "model": args.model,
            "framing_overhead": overhead,
            "note": "claude_tokens = claude_raw - framing_overhead; o200k_* come from token-worldcup.qmd",
            "rows": by_claude,
        }
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
