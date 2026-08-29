#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CODEX_ROOT=${CODEX_HOME:-"$HOME/.codex"}
TARGET="$CODEX_ROOT/pets/loopling"

mkdir -p "$TARGET"
cp "$ROOT/pet/pet.json" "$TARGET/pet.json"
cp "$ROOT/pet/spritesheet.webp" "$TARGET/spritesheet.webp"

echo "Loopling installed to $TARGET"
echo "Restart ChatGPT, then open Settings -> Pets and select Loopling."
