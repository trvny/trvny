#!/usr/bin/env bash
set -euo pipefail

# Only the official uBOL project release. No CRX mirrors or patched manifest.
root="${HOME}/.local/share/travny-devbox"
target="${root}/ubol"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --retry 3 \
  https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest \
  -o "$tmp/release.json"

url="$(python3 - "$tmp/release.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    release = json.load(stream)
assets = release.get("assets", [])
matches = [item["browser_download_url"] for item in assets
           if item.get("name", "").endswith(".chromium.zip")
           and item.get("browser_download_url", "").startswith(
               "https://github.com/uBlockOrigin/uBOL-home/releases/download/")]
if len(matches) != 1:
    raise SystemExit("Expected one official uBOL Chromium release asset")
print(matches[0])
PY
)"

curl -fsSL --retry 3 "$url" -o "$tmp/ubol.zip"
mkdir -p "$tmp/unpacked"
unzip -q "$tmp/ubol.zip" -d "$tmp/unpacked"

manifest="$(find "$tmp/unpacked" -maxdepth 4 -type f -name manifest.json -print -quit)"
if [[ -z "$manifest" ]]; then
  echo "uBOL release does not contain a Chromium manifest" >&2
  exit 1
fi
python3 - "$manifest" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    manifest = json.load(stream)
if manifest.get("manifest_version") != 3:
    raise SystemExit("Expected a Manifest V3 extension")
PY

mkdir -p "$root"
rm -rf "$target"
mv "$(dirname "$manifest")" "$target"
echo "uBlock Origin Lite installed from $url"
