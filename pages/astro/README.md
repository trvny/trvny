# TRAVNY Astro

[![travny pages CI](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml) [![Astro](https://img.shields.io/badge/Astro-BC52EE?logo=astro&logoColor=white&style=flat-square)](https://astro.build/) [![MDX](https://img.shields.io/badge/MDX-F9AC00?logo=mdx&logoColor=white&style=flat-square)](https://mdxjs.com/)

> **Agent entry:** `src/content/digests/YYYY-MM-DD.md` is the only maintained source for each digest; `src/pages/` renders Astro routes.
> **Validate:** `cd pages/astro && npm ci && npm run build` (or `npm run check` for Astro types).
> **Boundary:** additive output to the existing Pages hub, **one** shared `/teksty/feed.xml`; [publication gate](../../.github/workflows/coczydziennik-publish.yml) starts on digest PR events and waits before checking CI/review state. It does not wait for review approval; branch protection is separate.

Incremental Astro 7 + MDX lab pages under **/lab/** and Markdown CoCzyDziennik issues under **/przeglad/**, both on the existing Cloudflare Pages project. The old hub and Quarto renders remain unchanged. Existing Pages Functions inject shared navigation and preserve English `lang` and `Content-Language` for Lab routes.

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

## CoCzyDziennik publishing

This is the maintained publishing contract. Each issue has **one source file** in Astro's `digests` content collection. Astro renders the issue permalink `/przeglad/YYYY-MM-DD/` and the historical `/przeglad/` archive. Pages Functions also pull the published issue metadata into the **same** `/teksty/` directory and `/teksty/feed.xml` Atom feed as existing articles from `site/teksty/posts.json` and live Shitpost Reactor entries. The home page initially displays three latest publication cards and offers a native expandable list up to ten recent entries, mixing articles, digests and shitposts by update time. Featured articles remain pinned separately.

The primary reader and subscription surfaces are `/teksty/` and `/teksty/feed.xml`. `/przeglad/` is an archive, not a parallel feed. Never duplicate issues in `posts.json`, build a second digest syndication feed, or add a separate publishing pipeline.

Add one UTF-8 Markdown file per public issue under `src/content/digests/`, named `YYYY-MM-DD.md`:

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

Use real, stable HTTP(S) source links, not ChatGPT citation tokens, chat UI components or raw HTML. Only publish material intended for a public audience: omit private preferences, personal search criteria and account-specific details. Verify dates and time-limited offers; never present stale offers as current. Do not publish unverified claims.

Required frontmatter: `title`, `description`, `date`. `draft` is optional, defaults to `false`, and should be set explicitly for editorial clarity. Set `draft: true` to exclude an issue from the archive, generated routes, unified directory and Atom feed. On a substantive revision, set or advance optional `updated: 2026-01-01T12:00:00Z` (real ISO timestamp) so Atom subscribers detect the change; otherwise the original `date` supplies the update timestamp. Update the file for an existing date rather than creating a duplicate.

After a reviewed PR is merged to `main` and Cloudflare Pages deploys, verify the issue permalink and listing in `/teksty/`; verify the `/teksty/feed.xml` entry only when the issue falls within the feed's 100 newest items by update time. Verify its home-page card only if it remains among the ten newest entries, expanding the list if needed. The Pages build copies `dist/przeglad/` additively; old article URLs and Atom IDs remain unchanged.

Featured articles are selected with `featured: true` in `site/teksty/posts.json`. That JSON is the legacy-article catalog, **not** the complete list of publications. Do not maintain duplicate indexes of digest issues by hand.

### Automated PR release gate

For each new public digest, write only `src/content/digests/YYYY-MM-DD.md`
on a matching `content/coczydziennik-YYYY-MM-DD` branch with GPTomek bot
commits, then open a normal PR **as `trvny`** to retain external reviews.
The existing `CoCzyDziennik publish` GitHub Action waits six minutes
(`sleep 360`) after a new issue PR or updated commit, then checks the final
head's TRAVNY Pages and MegaLinter results (briefly waiting if CI is late).
When both are green and current review threads and change requests do not
block release, it rebase-merges and verifies the existing Cloudflare Pages
deployment, permalink, `/teksty/` and shared Atom feed.

The script does **not** interpret or fix review comments. The editor handles
actionable feedback, then applies `digest-publish-retry` to rerun the gate
without the six-minute wait. No separate reviewer or release scheduler.

Do not run PR source code with write credentials. Semantic review fixes are
editorial work: update the source with GPTomek and resolve the feedback, then
the gate resumes on the new CI/review events. No extra content index,
syndication feed, deployment project or site publishing pipeline is created.
