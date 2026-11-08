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
| Papagenerator | Pinned `travnie/twojstar/papagenerator` commit fetched by `build.sh`; **not** a second editor source |
| Badges | `functions/badge/[[path]].js`; public [/badges/](https://travny.pages.dev/badges/) catalog, `/badge/<slug>.svg`, `/badge/o/<octicon>.svg`, `/badge/model/<model-id>.svg`, live status badges |

## Edit / validate

```sh
cd pages
bash build.sh
node --test tests/*.test.mjs
```

[Pages CI](../.github/workflows/travny-pages.yml) also runs lint and asserts the Cloudflare Git source/settings. Do not change project, move Astro's output into `site/` directly, duplicate the publication feed, or alter legacy Atom IDs/URLs. Design tokens are opt-in `--tr-*`; existing pages keep their palette.
