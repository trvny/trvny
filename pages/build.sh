#!/bin/sh
# Cloudflare Pages build (cwd = pages/). Publishes Quarto renders; source stays in token-worldcup/.
set -eu
out=site/teksty/token-worldcup
mkdir -p "$out"
cp token-worldcup/token-worldcup.html "$out/index.html"
# effort-matrix links to the sibling filename; canonical points at the directory.
cp token-worldcup/token-worldcup.html "$out/token-worldcup.html"
cp token-worldcup/effort-matrix.html "$out/effort-matrix.html"

# Publish pinned Papagenerator sources from travnie/twojstar without forking them.
# Bump this commit after testing upstream changes, not on every hub deployment.
papagenerator_revision=dec8f8a75788ab6fbbb1d0f1b0793c9c0bb0e870
papagenerator_base="https://raw.githubusercontent.com/travnie/twojstar/$papagenerator_revision/papagenerator"
papagenerator_dir=site/papagenerator
mkdir -p "$papagenerator_dir"
for asset in index.html brainrot.js; do
  curl --fail --location --silent --show-error --retry 3 --max-time 45 \
    "$papagenerator_base/$asset" --output "$papagenerator_dir/$asset"
done

# Additive Astro build. Never target Astro's output at site/: keep legacy files safe.
npm --prefix astro ci --no-audit --no-fund
npm --prefix astro run build
cp -R astro/dist/lab site/
if [ -d astro/dist/_astro ]; then cp -R astro/dist/_astro site/; fi
