#!/usr/bin/env bash
set -euo pipefail

root="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
tmp="${RUNNER_TEMP:-/tmp}"
commit="5595a607ba782bd027e8d4102aa36f556e648015"
rick="$tmp/rickroll-lang-$commit"
manifest="$tmp/instruction-files.txt"

"$root/.github/instruction-checks/changed-files.sh" > "$manifest"
export INSTRUCTION_MANIFEST="$manifest"

if [[ ! -d "$rick/.git" ]]; then
  git init -q "$rick"
  git -C "$rick" remote add origin https://github.com/Rick-Lang/rickroll-lang.git
  git -C "$rick" fetch -q --depth=1 origin "$commit"
  git -C "$rick" checkout -q --detach FETCH_HEAD
fi

cd "$root"
python3 "$rick/src/RickRoll.py" \
  "$root/.github/instruction-checks/never-gonna-deploy-you.rickroll"
