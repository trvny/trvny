#!/usr/bin/env bash
set -euo pipefail

pattern='(^|/)(AGENTS|CLAUDE)\.md$'
base="${BASE_SHA:-}"
head="${HEAD_SHA:-${GITHUB_SHA:-HEAD}}"

if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git ls-files | grep -E "$pattern" || true
  exit 0
fi

mapfile -t changed < <(git diff --name-only --diff-filter=ACMRT "$base" "$head")
matched=0

for path in "${changed[@]}"; do
  if [[ "$path" =~ $pattern && -f "$path" ]]; then
    printf '%s\n' "$path"
    matched=1
  fi
done

if (( matched == 0 )); then
  for path in "${changed[@]}"; do
    case "$path" in
      .github/instruction-checks/*|.github/workflows/instruction-rot.yml)
        [[ -f AGENTS.md ]] && printf '%s\n' AGENTS.md
        break
        ;;
    esac
  done
fi
