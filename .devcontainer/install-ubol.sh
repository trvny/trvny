#!/usr/bin/env bash
set -euo pipefail

# Official Chromium asset only. Lock installer, atomically switch versions.
root="${HOME}/.local/share/travny-devbox"
target="${root}/ubol"
mkdir -p "$root/extensions"
exec 9>"$root/.ubol-install.lock"
flock -x 9

tmp="$(mktemp -d "$root/.ubol-stage-XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --retry 3 \
  "https://api.github.com/repos/uBlockOrigin/uBOL-home/releases?per_page=20" \
  -o "$tmp/release.json"

readarray -t release < <(python3 - "$tmp/release.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    releases = json.load(stream)
for release in releases:
    if release.get("draft") or release.get("prerelease"):
        continue
    matches = [item["browser_download_url"] for item in release.get("assets", [])
               if item.get("name", "").endswith(".chromium.zip")
               and item.get("browser_download_url", "").startswith(
                   "https://github.com/uBlockOrigin/uBOL-home/releases/download/")]
    if len(matches) == 1:
        print(release["tag_name"])
        print(matches[0])
        break
else:
    raise SystemExit("No official uBOL Chromium release in recent releases")
PY
)
if [[ "${#release[@]}" -ne 2 || ! "${release[0]}" =~ ^[0-9.]+$ ]]; then
  echo "Invalid uBOL release metadata" >&2
  exit 1
fi
tag="${release[0]}"
url="${release[1]}"
version="$root/extensions/uBOLite-$tag"

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

if [[ ! -e "$version" ]]; then
  mv "$(dirname "$manifest")" "$version"
fi
if [[ ! -f "$version/manifest.json" ]]; then
  echo "Stored uBOL version has no manifest" >&2
  exit 1
fi

# Existing pre-atomic installs are preserved, never deleted mid-upgrade.
if [[ -d "$target" && ! -L "$target" ]]; then
  mv "$target" "$root/extensions/legacy-$(date +%s)-$$"
fi
ln -s "$version" "$tmp/current"
mv -Tf "$tmp/current" "$target"
echo "uBlock Origin Lite $tag installed from the official release"
