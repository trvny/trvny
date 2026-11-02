# TRAVNY Astro lab

Incremental Astro 7 + MDX source for **/lab/** on the existing Cloudflare Pages project. The old hub and Quarto renders remain unchanged. Existing Pages Functions still inject shared navigation and now preserve English `lang` and `Content-Language` for Lab routes.

Run from `pages/astro`:

```sh
npm ci
npm run dev
npm run build
```

The Pages build copies `astro/dist/lab/` and `astro/dist/przeglad/` into their corresponding directories under `site/`. Do not point Astro's `outDir` at `../site`: that could wipe the legacy site. The build is deliberately additive.

## Roadmap

- **Lab:** MDX articles, interactive token experiments, widgets and experiments.
- **News:** start with the official HN API; later consume a canonical Feedseek adapter with caching and source attribution.
- **Radio:** start with a plain audio preview and Streambench link; later reuse Streambench's station/metadata contract.
- **Content:** migrate future posts gradually; keep old slugs, Atom IDs, SEO and sitemap stable.
- **Search:** add Pagefind or comparable static index once there is meaningful content.
- **Navigation:** only add a hub link when the section is ready, without replacing current design.

No new Cloudflare Pages project, Worker, feed pipeline or duplicated source of truth.

## CoCzyDziennik archive

The `/przeglad/` archive uses Astro's built-in content collections and the existing Pages deployment. Add one UTF-8 Markdown file per public issue under `src/content/digests/`, named `YYYY-MM-DD.md`:

```md
---
title: "CoCzyDziennik — 2026-01-01"
description: "A short, accurate summary of this issue."
date: 2026-01-01
draft: false
---

## News

A verified summary with a [direct source](https://example.com/).
```

Use real, stable HTTP(S) source links, not ChatGPT citation tokens or components. Only publish material intended for a public audience: omit private preferences, personal search criteria and account-specific details. Verify dates and time-limited offers; never present stale offers as current. Do not publish unverified claims. Set `draft: true` to exclude an issue from the archive and its generated routes. A file for an existing date should be updated rather than duplicated. Markdown files are public once merged to `main`; the normal Pages build copies `dist/przeglad/` additively. Existing article and feed URLs remain unchanged.

Featured publications are selected with `featured: true` in `site/teksty/posts.json`; the home page and article directory read that same metadata.
