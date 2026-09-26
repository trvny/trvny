#!/usr/bin/env bash
set -euo pipefail
python3 .bot/edit-qmd.py
md5sum token-worldcup/token-worldcup.qmd
quarto render token-worldcup/token-worldcup.qmd
