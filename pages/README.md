# TRAVNY Pages

[![Pages CI](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml) [![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=flat-square&logo=cloudflarepages&logoColor=white)](https://developers.cloudflare.com/pages/) [![Astro](https://img.shields.io/badge/Astro-BC52EE?style=flat-square&logo=astro&logoColor=white)](https://astro.build/)

**Canonical hub:** [travny.pages.dev](https://bartek.lol). Cloudflare Pages project `travny`, repository root `pages/`, build `build.sh`, output `site/`, Functions `functions/`.

## Source map

| Concern | Maintained source / output |
| --- | --- |
| Hub | `site/index.html`, `site/assets/tokens.css`; existing HTML preserved |
| Pages Functions / redirects | `functions/`; custom-domain aliases redirect to the canonical hub or Feedseek |
| Astro lab + digests | [`astro/`](astro/README.md); additive `/lab/`, `/przeglad/`; published digests join one `/teksty/` stream/feed |
| Token Worldcup | [`token-worldcup/*.qmd`](token-worldcup/README.md); Quarto HTML copied into `site/teksty/token-worldcup/` |
| Papagenerator | [`papagenerator/`](papagenerator/README.md); local runtime copied by `build.sh` to `site/papagenerator/` |
| Hub backend | `worker/`; private Worker `travny-hub-backend`, Pages service binding `HUB_BACKEND`; radio API logic in `functions/api/radio-*.js` |
| Badges | `functions/badge/[[path]].js`; public [/badges/](https://bartek.lol/badges/) catalog, `/badge/<slug>.svg`, `/badge/o/<octicon>.svg`, `/badge/model/<model-id>.svg`, live status badges |

## Edit / validate

```sh
cd pages
bash build.sh
node --test tests/*.test.mjs
```

[Pages CI](../.github/workflows/travny-pages.yml) runs lint. PR checks do not change Cloudflare settings; main pushes and manual `assert` runs can PATCH project settings, including setting `preview_deployment_setting` to `none`. Do not change project, move Astro's output into `site/` directly, duplicate the publication feed, or alter legacy Atom IDs/URLs. Design tokens are opt-in `--tr-*`; existing pages keep their palette.

## Static routing

`site/_routes.json`: bypass Functions for known static runtime assets and data.
Build-time shell: Kraina, Universe, Token Worldcup, effort matrix,
Papagenerator and badges catalogue. `scripts/build-static-shell.mjs`
uses shared `functions/_shared/page-shell.js`, writes navigation, SEO and
static `_headers`; exact document aliases bypass Functions.
Run `sh build.sh` before serving `site/` locally; generated shell and route
headers are build output. CI rejects committed shell markers in tracked HTML.
Keep dynamic HTML,
discovery, feeds, redirects and APIs in middleware. Avoid broad
extension globs: dynamic SVG badges and JSON routes share those extensions.
Cloudflare redirects `travny.pages.dev`, `www.bartek.lol`, `trfny.com` and
`www.trfny.com` to `bartek.lol`, path/query kept. Feedseek aliases and
legacy cross-site sitemap exceptions keep their own routing.
Keep this rule while static paths bypass middleware. `tvpi.pages.dev` uses
its own Pages project. Cloudflare Pages defaults to `X-Robots-Tag: noindex`
for preview deployments, independent of middleware.

## Hub backend

Pages owns public URLs, static assets, HTML middleware, SEO and redirects.
Private Worker owns radio metadata and badge rendering; Pages delegates GET/HEAD
endpoints via `HUB_BACKEND`. No public Worker hostname. Missing binding or
binding fetch exception falls back to the same shared implementation.
Worker HTTP responses (including upstream errors) pass through unchanged.
Badge routes also fall back on an unmarked 404 from an older Worker bundle.
Radio audio remains direct to station providers.

Cloudflare Builds settings for `travny-hub-backend`:

- Git: `trvny/trvny`, branch `main`, root `pages/worker`; previews disabled.
- Build: `sh check.sh`; Node 24.
- Deploy: `npx --yes wrangler@4.160.0 deploy`.
- Watch: `pages/worker/**`, `pages/functions/api/**`, `pages/functions/_shared/hub-backend.js`,
  `pages/tests/radio*.test.mjs`, `pages/tests/hub-worker.test.mjs`,
  `pages/eslint.config.mjs`, `pages/functions/badge/**`,
  `pages/functions/_shared/badge.js`, `pages/functions/_shared/eco.js`,
  `pages/functions/_shared/model-icons.js`,
  `pages/tests/badge.test.mjs`.

Pages keeps its existing Git build. After first successful Worker build, add
production service binding `HUB_BACKEND` → `travny-hub-backend` and redeploy
Pages via Cloudflare. Verify `/api/radio-station?station=invalid`: HTTP 400 and
`x-travny-backend: worker` (no upstream request).
Rollback: remove binding and rebuild Pages. Local handlers remain available.

### Upstream service bindings

Production Pages bindings: `WEATHER_SERVICE` → `weather`,
`REACTOR_SERVICE` → `shitpost-reactor` (production environment).
GET only to fixed public JSON endpoints; 5m named edge cache for successful
bound responses. Missing/throwing bindings retain public HTTP reads and
original cache options. No retry for upstream HTTP errors or aborted reads.
Configure in Cloudflare Pages settings; activate with a native Pages build.
