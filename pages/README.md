# pages

TRAVNY hub at [travny.pages.dev](https://travny.pages.dev) (canonical).
`trfny.com` serves a distinct English brand homepage; `www` redirects to it.
Its robots and sitemap cover that homepage only. Other custom-domain paths
redirect directly to the stable hub, preserving path and query.
Cloudflare Pages project `travny`, built from this directory: static `site/`, Pages
Functions in `functions/`, build step `build.sh`.

- Deploy: Cloudflare Git build on push to `main` touching `pages/**`; `build.sh` copies `token-worldcup/` renders into `site/teksty/token-worldcup/`; `travny-pages.yml` keeps the
  project's Git source and build settings asserted.
- Checks: `travny-pages.yml` (eslint 10 + `node --test tests/*.test.mjs`).
- Design tokens: `site/assets/tokens.css`, opt-in `--tr-*` variables plus
  repo themes via `data-theme` / `data-mode="dark"`. Hub (`site/index.html`)
  maps its matching hues to them with identical literal fallbacks; other
  pages keep their own palettes.
- Moved from `trvny/tvpi` (`site/`, `functions/`) on 2026-10-12. The TV stream Worker stays in tvpi.

- Papagenerator: https://travny.pages.dev/papagenerator/ is assembled by `build.sh` from a pinned commit of `travnie/twojstar/papagenerator` (the only maintained editor source). To update, bump `papagenerator_revision`. No new Cloudflare Pages project, Worker or cron is needed. Fetch failure fails the build deliberately: Cloudflare keeps the previous working deployment live rather than publishing an incomplete site.

- Badges: `functions/badge/[[path]].js`, catalogue + builder at `/badges/` (reads `/badge/index.json`). Routes: `/badge/<slug>.svg` (AI brands in `_shared/badge.js`, ecosystem in `_shared/eco.js`), `/badge/model/<model-id>.svg`, `/badge/o/<octicon>.svg`, live `/badge/feedseek/feeds.svg`, `/badge/tvpi/channels.svg`, `/badge/status/<slug>.svg`, bare logo `/badge/mark/<slug>.svg?size=`. Common `?label=`, `?value=`, `?color=` (palette name or hex). Same style as the static set in `travnie/.github/assets/badges`. Icons: own inline marks (twojstar, Kanarek, Autka, tvpi, papiesz), pinned `@primer/octicons` and `@lobehub/icons-static-svg` on jsDelivr; model id → icon follows lobe-icons ModelIcon rules in generated `functions/_shared/model-icons.js` (refresh: `scripts/sync_model_icons.py`). Live probes and icon failures render a short-cached fallback, never an error page.

- Astro: `astro/` builds `/lab/` and CoCzyDziennik issue pages under `/przeglad/` without replacing the existing site. Published issues automatically join `/teksty/` and its **one shared Atom feed** (`/teksty/feed.xml`) alongside legacy articles and Shitpost Reactor entries. The `/przeglad/` route remains an archive/permalink space, not a second feed or publication catalog. See [canonical Astro publishing instructions](astro/README.md).
