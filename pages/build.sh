#!/bin/sh
# Cloudflare Pages build (cwd = pages/). Publishes Quarto renders; source stays in token-worldcup/.
set -eu
out=site/teksty/token-worldcup
mkdir -p "$out"
cp token-worldcup/token-worldcup.html "$out/index.html"
cp token-worldcup/effort-matrix.html "$out/effort-matrix.html"
# Pages link these sources by relative name; publish them next to the HTML.
cp token-worldcup/recount-*.py token-worldcup/recount-*.mjs token-worldcup/*-token-counts.json "$out/"

# Publish local Papagenerator runtime files; demos stay in source.
mkdir -p site/papagenerator
cp papagenerator/index.html papagenerator/brainrot.js site/papagenerator/

# Publish generated Astro routes without writing over source HTML.
npm --prefix astro ci --no-audit --no-fund
mkdir -p site/assets/vendor
cp astro/node_modules/hls.js/dist/hls.min.js site/assets/vendor/hls.min.js
cp astro/node_modules/hls.js/LICENSE site/assets/vendor/hls.LICENSE
cp astro/node_modules/animejs/LICENSE.md site/assets/vendor/animejs.LICENSE
cat astro/node_modules/sigma/LICENSE.txt astro/node_modules/graphology/LICENSE.txt \
  astro/node_modules/graphology-utils/LICENSE.txt astro/node_modules/events/LICENSE \
  > site/assets/vendor/universe-webgl.LICENSE
npm --prefix astro run build
cp astro/dist/index.html site/index.html
cp astro/dist/teksty/index.html site/teksty/index.html
cp -R astro/dist/lab site/
cp -R astro/dist/przeglad site/
if [ -d astro/dist/_astro ]; then cp -R astro/dist/_astro site/; fi

# Pre-render default badges for the catalogue; live and custom routes stay dynamic.
node scripts/build-badge-previews.mjs

# Render shared navigation and SEO once for known static HTML routes.
node scripts/build-static-shell.mjs

# Drop digest editions left in the sitemap by older local builds.
node scripts/sitemap-variants.mjs

# Legacy AI Catalog path uses the same ARD manifest; one maintained source.
cp site/.well-known/ard.json site/.well-known/ai-catalog.json
