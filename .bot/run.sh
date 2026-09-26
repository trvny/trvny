#!/usr/bin/env bash
set -euo pipefail
cd token-worldcup
python3 -m venv /tmp/venv
/tmp/venv/bin/pip install --quiet -r requirements.txt
/tmp/venv/bin/python recount-claude-tokens.py --model claude-opus-5-5 --out claude-opus-5-5-token-counts.json
