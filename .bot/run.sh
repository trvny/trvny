#!/usr/bin/env bash
set -euo pipefail
cd token-worldcup
python3 -m venv /tmp/venv
/tmp/venv/bin/pip install --quiet -r requirements.txt
PY=/tmp/venv/bin/python

# Control: the method must reproduce the committed Opus 5 counts first.
$PY recount-claude-tokens.py --openrouter --model anthropic/claude-opus-5 --out /tmp/opus5-control.json
$PY - <<'PY'
import json
old = {r["name"]: r["claude_tokens"] for r in json.load(open("claude-token-counts.json"))["rows"]}
new = {r["name"]: r["claude_tokens"] for r in json.load(open("/tmp/opus5-control.json"))["rows"]}
diff = {n: new[n] - old[n] for n in old if new[n] != old[n]}
print("Opus 5 control vs committed:", diff or "identical")
assert max((abs(v) for v in diff.values()), default=0) <= 1, "control mismatch - method not trustworthy"
PY

$PY recount-claude-tokens.py --openrouter --model anthropic/claude-opus-5.5 --out claude-opus-5-5-token-counts.json
