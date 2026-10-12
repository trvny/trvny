#!/bin/sh
# Cloudflare Pages build (cwd = pages/). Publishes Quarto renders; source stays in token-worldcup/.
set -eu
out=site/teksty/token-worldcup
mkdir -p "$out"
cp token-worldcup/token-worldcup.html "$out/index.html"
# effort-matrix links to the sibling filename; canonical points at the directory.
cp token-worldcup/token-worldcup.html "$out/token-worldcup.html"
cp token-worldcup/effort-matrix.html "$out/effort-matrix.html"
