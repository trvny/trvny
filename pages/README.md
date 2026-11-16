# TRAVNY Pages

[![Pages CI](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml) [![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=flat-square&logo=cloudflarepages&logoColor=white)](https://developers.cloudflare.com/pages/) [![Astro](https://img.shields.io/badge/Astro-BC52EE?style=flat-square&logo=astro&logoColor=white)](https://astro.build/)

**Canonical hub:** [travny.pages.dev](https://travny.pages.dev). Cloudflare Pages project `travny`, repository root `pages/`, build `build.sh`, output `site/`, Functions `functions/`.

## Source map

| Concern | Maintained source / output |
| --- | --- |
| Hub | `site/index.html`, `site/assets/tokens.css`; existing HTML preserved |
| Pages Functions / redirects | `functions/`; brand-only `trfny.com` homepage, robots and sitemap; other deep paths redirect to the canonical hub |
| Astro lab + digests | [`astro/`](astro/README.md); additive `/lab/`, `/przeglad/`; published digests join one `/teksty/` stream/feed |
| Token Worldcup | [`token-worldcup/*.qmd`](token-worldcup/README.md); Quarto HTML copied into `site/teksty/token-worldcup/` |
| Papagenerator | [`papagenerator/`](papagenerator/README.md); local runtime copied by `build.sh` to `site/papagenerator/` |
| Hub backend | `worker/`; private Worker `travny-hub-backend`, Pages service binding `HUB_BACKEND`; radio API logic in `functions/api/radio-*.js` |
| Badges | `functions/badge/[[path]].js`; public [/badges/](https://travny.pages.dev/badges/) catalog, `/badge/<slug>.svg`, `/badge/o/<octicon>.svg`, `/badge/model/<model-id>.svg`, live status badges |

## Edit / validate

```sh
cd pages
bash build.sh
node --test tests/*.test.mjs
```

[Pages CI](../.github/workflows/travny-pages.yml) runs lint. PR checks do not change Cloudflare settings; main pushes and manual `assert` runs can PATCH project settings, including setting `preview_deployment_setting` to `none`. Do not change project, move Astro's output into `site/` directly, duplicate the publication feed, or alter legacy Atom IDs/URLs. Design tokens are opt-in `--tr-*`; existing pages keep their palette.

## Static routing

`site/_routes.json`: bypass Functions for known static runtime assets and data.
Keep HTML, discovery, feeds, redirects and APIs in middleware. Avoid broad
extension globs: dynamic SVG badges and JSON routes share those extensions.
Custom-domain deep links redirect at the zone edge; Pages previews default to
`X-Robots-Tag: noindex`.

## Hub backend

Pages owns public URLs, static assets, HTML middleware, SEO and redirects.
Private Worker owns radio metadata routes; Pages delegates only these GET
endpoints via `HUB_BACKEND`. No public Worker hostname. Missing binding or
binding fetch exception falls back to the same shared implementation.
Worker HTTP responses (including upstream errors) pass through unchanged.
Radio audio remains direct to station providers.

Cloudflare Builds settings for `travny-hub-backend`:

- Git: `trvny/trvny`, branch `main`, root `pages/worker`; previews disabled.
- Build: `sh check.sh`; Node 24.
- Deploy: `npx --yes wrangler@4.160.0 deploy`.
- Watch: `pages/worker/**`, `pages/functions/api/**`, `pages/functions/_shared/hub-backend.js`,
  `pages/tests/radio*.test.mjs`, `pages/tests/hub-worker.test.mjs`,
  `pages/eslint.config.mjs`.

Pages keeps its existing Git build. After first successful Worker build, add
production service binding `HUB_BACKEND` → `travny-hub-backend` and redeploy
Pages via Cloudflare. Verify `/api/radio-station?station=invalid`: HTTP 400 and
`x-travny-backend: worker` (no upstream request).
Rollback: remove binding and rebuild Pages. Local handlers remain available.
