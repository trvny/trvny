# travny-pages

TRAVNY hub at [trfny.com](https://trfny.com) (fallback `travny.pages.dev`, noindex).
Cloudflare Pages project `travny`, built from this directory: static `site/`, Pages
Functions in `functions/`, no build step.

- Deploy: push to `main` touching `travny-pages/**`; `travny-pages-control.yml` keeps the
  project's Git source and build settings asserted.
- Checks: `travny-pages-ci.yml` (eslint 10 + `node --test tests/teksty-feed.test.mjs`).
- Moved from `trvny/tvpi` (`site/`, `functions/`) on 2026-10-12. The TV stream Worker stays in tvpi.
