#!/usr/bin/env bash
set -euo pipefail

pattern='(^|/)(AGENTS|CLAUDE)\.md$'
base="${BASE_SHA:-}"
head="${HEAD_SHA:-${GITHUB_SHA:-HEAD}}"

if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git ls-files | grep -E "$pattern" || true
  exit 0
fi

git diff --name-only --diff-filter=ACMRT "$base" "$head" \
  | grep -E "$pattern" \
  | while IFS= read -r path; do
      [[ -f "$path" ]] && printf '%s\n' "$path"
    done
