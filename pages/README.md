# pages

TRAVNY hub at [trfny.com](https://trfny.com) (fallback `travny.pages.dev`, noindex).
Cloudflare Pages project `travny`, built from this directory: static `site/`, Pages
Functions in `functions/`, build step `build.sh`.

- Deploy: Cloudflare Git build on push to `main` touching `pages/**`; `build.sh` copies `token-worldcup/` renders into `site/teksty/token-worldcup/`; `travny-pages-control.yml` keeps the
  project's Git source and build settings asserted.
- Checks: `travny-pages-ci.yml` (eslint 10 + `node --test tests/teksty-feed.test.mjs`).
- Moved from `trvny/tvpi` (`site/`, `functions/`) on 2026-10-12. The TV stream Worker stays in tvpi.

- Papagenerator: https://trfny.com/papagenerator/ is assembled by `build.sh` from a pinned commit of `travnie/twojstar/papagenerator` (the only maintained editor source). To update, bump `papagenerator_revision`. No new Cloudflare Pages project, Worker or cron is needed.
