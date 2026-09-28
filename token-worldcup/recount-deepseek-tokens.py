#!/usr/bin/env python3
"""Recount Token Worldcup samples with the DeepSeek V4 tokenizer."""

from __future__ import annotations

import argparse
import json
import pathlib
import re

QMD = pathlib.Path(__file__).with_name("token-worldcup.qmd")
ANCHOR = "English"
PREFIX = "deepseek_"
EXPECTED_SPECIAL = {
    "<think>": 128821,
    "</think>": 128822,
    "｜DSML｜": 128825,
    "<｜latest_reminder｜>": 128828,
}


def load_samples() -> tuple[str, re.Match[str], list[dict]]:
    source = QMD.read_text(encoding="utf-8")
    match = re.search(
        r'(<script\b[^>]*\bid=["\']token-worldcup-data["\'][^>]*>)(.*?)(</script>)',
        source,
        re.S,
    )
    if not match:
        raise SystemExit(f"{QMD.name}: token-worldcup-data block not found")
    samples = json.loads(match.group(2))
    if not samples or not any(row.get("name") == ANCHOR for row in samples):
        raise SystemExit(f"{QMD.name}: missing corpus or {ANCHOR!r} anchor")
    return source, match, samples


def tokenizer():
    try:
        from deepseek_tokenizer import ds_token
    except ImportError as exc:
        raise SystemExit("pip install -r requirements.txt") from exc

    for token, expected in EXPECTED_SPECIAL.items():
        actual = ds_token.convert_tokens_to_ids(token)
        if actual != expected:
            raise SystemExit(
                f"unexpected DeepSeek tokenizer: {token}={actual}, expected {expected}"
            )
    return ds_token


def annotate(samples: list[dict]) -> list[dict]:
    tok = tokenizer()
    counts = {row["name"]: len(tok.encode(row["text"])) for row in samples}
    english = counts[ANCHOR]
    frequency = {value: list(counts.values()).count(value) for value in set(counts.values())}
    ordered = sorted(samples, key=lambda row: (counts[row["name"]], row["name"]))

    ranks: dict[str, int] = {}
    previous = None
    held_rank = 0
    for position, row in enumerate(ordered, 1):
        value = counts[row["name"]]
        if value != previous:
            previous, held_rank = value, position
        ranks[row["name"]] = held_rank

    rebuilt = []
    for row in samples:
        tokens = counts[row["name"]]
        index = round(tokens / english * 100)
        rebuilt.append(
            {
                **row,
                "deepseek_tokens": tokens,
                "deepseek_rank": ranks[row["name"]],
                "deepseek_tied": frequency[tokens] > 1,
                "deepseek_index": index,
                "deepseek_overhead": index - 100,
            }
        )
    return rebuilt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if committed counts are stale")
    args = parser.parse_args()

    source, match, samples = load_samples()
    rebuilt = annotate(samples)

    if args.check:
        fields = (
            "deepseek_tokens",
            "deepseek_rank",
            "deepseek_tied",
            "deepseek_index",
            "deepseek_overhead",
        )
        for before, after in zip(samples, rebuilt):
            if any(before.get(field) != after[field] for field in fields):
                raise SystemExit("DeepSeek V4 token counts are stale; run recount-deepseek-tokens.py")
        print(f"DeepSeek V4 token counts current for {len(samples)} samples.")
        return 0

    payload = json.dumps(rebuilt, ensure_ascii=False, separators=(",", ":"))
    next_source = source[: match.start(2)] + payload + source[match.end(2) :]
    QMD.write_text(next_source, encoding="utf-8")
    print(f"Recounted {len(samples)} samples with DeepSeek V4.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
