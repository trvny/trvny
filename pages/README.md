# pages

TRAVNY hub at [travny.pages.dev](https://travny.pages.dev) (canonical). The retiring `trfny.com` domain redirects here.
Cloudflare Pages project `travny`, built from this directory: static `site/`, Pages
Functions in `functions/`, build step `build.sh`.

- Deploy: Cloudflare Git build on push to `main` touching `pages/**`; `build.sh` copies `token-worldcup/` renders into `site/teksty/token-worldcup/`; `travny-pages.yml` keeps the
  project's Git source and build settings asserted.
- Checks: `travny-pages.yml` (eslint 10 + `node --test tests/*.test.mjs`).
- Moved from `trvny/tvpi` (`site/`, `functions/`) on 2026-10-12. The TV stream Worker stays in tvpi.

- Papagenerator: https://travny.pages.dev/papagenerator/ is assembled by `build.sh` from a pinned commit of `travnie/twojstar/papagenerator` (the only maintained editor source). To update, bump `papagenerator_revision`. No new Cloudflare Pages project, Worker or cron is needed. Fetch failure fails the build deliberately: Cloudflare keeps the previous working deployment live rather than publishing an incomplete site.

- Badges: `functions/badge/[[path]].js` serves `/badge/<brand>.svg` and `/badge/model/<model-id>.svg` (`?label=` overrides text), same style as the static set in `travnie/.github/assets/badges`. Model id → icon follows lobe-icons ModelIcon rules in generated `functions/_shared/model-icons.js` (refresh: `scripts/sync_model_icons.py`); icons load from a pinned `@lobehub/icons-static-svg` on jsDelivr.

- Astro foothold: `astro/` builds the `/lab/` section to `site/lab/` without changing the existing homepage, Pages Functions, Quarto reports or Atom feed. See [Astro plan](astro/README.md).
