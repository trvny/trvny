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

# Additive Astro build. Never target Astro's output at site/: keep legacy files safe.
npm --prefix astro ci --no-audit --no-fund
mkdir -p site/assets/vendor
cp astro/node_modules/hls.js/dist/hls.min.js site/assets/vendor/hls.min.js
cp astro/node_modules/hls.js/LICENSE site/assets/vendor/hls.LICENSE
npm --prefix astro run build
cp -R astro/dist/lab site/
cp -R astro/dist/przeglad site/
if [ -d astro/dist/_astro ]; then cp -R astro/dist/_astro site/; fi

# Alternate sitemap formats from the canonical root and digest maps.
node scripts/sitemap-variants.mjs

# Pre-render default badges for the catalogue; live and custom routes stay dynamic.
node scripts/build-badge-previews.mjs

# Static HTML: common navigation, SEO, headers and exact route exclusions.
node scripts/prerender-static.mjs
