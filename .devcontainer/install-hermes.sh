#!/usr/bin/env bash
# Single maintained Hermes installer for bootstrap and on-demand retries.
set -euo pipefail

if command -v hermes >/dev/null 2>&1; then
  echo 'Hermes is already installed'
  exit 0
fi

script="$(mktemp)"
trap 'rm -f "$script"' EXIT
curl -fsSL --retry 3 https://hermes-agent.nousresearch.com/install.sh -o "$script"
HERMES_NONINTERACTIVE=1 bash "$script" --non-interactive --skip-browser --skip-computer-use
