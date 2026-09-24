#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

BANK_KEY = "kanarek:companion:quip-bank:v2"
EXPECTED_SAFE = 221


def js_hash(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: migrate-kanarek-quip-recovery.py RECOVERY_DIR OUTPUT_JSON"
        )

    recovery_dir = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    recovered: dict[tuple[str, str], dict[str, object]] = {}

    for path in sorted(recovery_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for item in payload.get("entries", []):
            legacy_key = item.get("k")
            quip = item.get("q")
            repository = item.get("repo")
            language = item.get("l")
            if not (
                isinstance(legacy_key, str)
                and len(legacy_key) == 16
                and isinstance(quip, str)
                and isinstance(repository, str)
            ):
                continue

            identity = (legacy_key, quip)
            entry = recovered.setdefault(
                identity,
                {
                    "legacy_key": legacy_key,
                    "quip": quip,
                    "repositories": set(),
                    "languages": set(),
                },
            )
            entry["repositories"].add(repository.strip().lower())
            if isinstance(language, str):
                entry["languages"].add(language)

    bulk: list[dict[str, str]] = []
    ambiguous = 0
    language_conflicts = 0

    for item in recovered.values():
        repositories = item["repositories"]
        languages = item["languages"]
        if len(repositories) != 1:
            ambiguous += 1
            continue
        if len(languages) > 1:
            language_conflicts += 1
            continue

        repository = next(iter(repositories))
        legacy_key = item["legacy_key"]
        quip = item["quip"]
        bank_context = js_hash(
            {
                "repository": repository,
                "legacyQuipKey": legacy_key,
            }
        )
        entry_identity = js_hash(f"{bank_context}\0{quip}")
        value: dict[str, str] = {"k": bank_context, "q": quip}
        if languages:
            value["l"] = next(iter(languages))

        bulk.append(
            {
                "key": f"{BANK_KEY}:entry:{bank_context}:{entry_identity}",
                "value": json.dumps(
                    [value],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            }
        )

    bulk.sort(key=lambda item: item["key"])
    if len(bulk) != EXPECTED_SAFE:
        raise SystemExit(
            "refusing migration: expected "
            f"{EXPECTED_SAFE} safely attributable entries, got {len(bulk)} "
            f"(ambiguous={ambiguous}, language_conflicts={language_conflicts})"
        )

    output_path.write_text(
        json.dumps(bulk, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "safe": len(bulk),
                "ambiguous": ambiguous,
                "language_conflicts": language_conflicts,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
