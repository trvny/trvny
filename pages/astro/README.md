# TRAVNY Astro

[![travny pages CI](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/travny-pages.yml) [![Astro](https://img.shields.io/badge/Astro-BC52EE?logo=astro&logoColor=white&style=flat-square)](https://astro.build/) [![MDX](https://img.shields.io/badge/MDX-F9AC00?logo=mdx&logoColor=white&style=flat-square)](https://mdxjs.com/)

> **Agent entry:** `src/content/digests/YYYY-MM-DD.md` is the only maintained source for each digest; `src/pages/` renders Astro routes.
> **Validate:** `cd pages/astro && npm ci && npm run build` (or `npm run check` for Astro types).
> **Boundary:** additive output to the existing Pages hub, **one** shared `/teksty/feed.xml`; content-only digest commits can go directly to `main` when permitted.

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

After the digest reaches `main` and Cloudflare Pages deploys, verify the issue permalink and listing in `/teksty/`; verify the `/teksty/feed.xml` entry only when the issue falls within the feed's 100 newest items by update time. Verify its home-page card only if it remains among the ten newest entries, expanding the list if needed. The Pages build copies `dist/przeglad/` additively; old article URLs and Atom IDs remain unchanged.

Featured articles are selected with `featured: true` in `site/teksty/posts.json`. That JSON is the legacy-article catalog, **not** the complete list of publications. Do not maintain duplicate indexes of digest issues by hand.

### Publish a digest

Content-only additions or revisions: GPTomek `commit_files` directly to
`main`, one digest Markdown file, guarded by the live main SHA. Use the
existing Cloudflare Pages Git build. Verify the public permalink and shared
directory/feed after deployment; an accepted commit is not publication proof.

No PR, external code review or pre-merge CI for ordinary digest content when
branch protection permits. Existing CI on main stays enabled. Site code,
schema, workflow and infrastructure changes retain normal PR checks/reviews.
If branch protection requires a PR, use the existing digest PR gate; never
weaken protection to force content through.

### Visual magazine (optional frontmatter)

Keep one Markdown file. Add structured data; Astro owns rendering. Legacy issues
without `magazine` remain unchanged. Supported media: verified HTTPS images,
GIFs, direct video files, official source embeds, or original local assets in `pages/astro/public/przeglad/assets/`.
Use media only with permission or a known reuse basis. Credit creator and link
original source. Do not invent asset URLs, copy unlicensed images, or hotlink
restricted media. No raw embed HTML, third-party scripts in the parent page, or autoplay.

```yaml
magazine:
  cover:
    src: "/przeglad/assets/editorial-cover.svg"
    alt: "Accessible caption"
    credit: "Creator / license"
    source: "https://example.org/source"
  stats:
    - label: "Distance"
      value: "25.9 billion km"
  sections:
    - kind: freebies
      title: "Freebies"
      cards:
        - title: "Game title"
          body: "Claim requirements and region."
          price: "0 PLN"
          previousPrice: "49 PLN"
          deadline: "Until 20 November, 17:00 CET (at publication)"
          links:
            - label: "Official store"
              url: "https://example.org/store"
```

Section types: `news`, `memes`, `freebies`, `cars`, `timeline`, `data`,
`poland`, `world`, `science`, `ai`, `games`,
`football`, `music`, `film`, `local`, `weather`, `gallery`.
Cards: `title`, optional `body`, `media` (same as cover, optional
`kind: video`), `price`, `previousPrice`, `deadline`, `facts` (label/value
pairs), `links` (label/url). Sections accept optional `intro`, `note`,
`chart` (title, unit, items with label and nonnegative numeric value).
Optional magazine-wide `note`. Body text is plain, not executable Markdown.
Move content into cards rather than repeating it in the Markdown body. Cards
appear after body in listed order; cover and stats appear before body.
Treat prices and deadlines as snapshots, not live availability. Prefer real
meme media, licensed photos, original infographics and official store artwork;
if unavailable, use source links and text rather than invented images.

### Editorial kit

Start from [examples/digest-issue.md](examples/digest-issue.md). Copy useful
blocks, replace placeholders, remove unused ones. Never publish the template.

- Section layout: grid (default), list, feature (first card full width).
- Card extras: kicker, quote (text/attribution), score (home/away/result/detail),
  gallery (media list). Sections also support gallery and table (title,
  columns, rows). Chart source: label/url.
- Media aspect: wide, square, portrait. Video requires transcript describing
  meaningful audio and visuals. No autoplay. Local SVG icons for every kind.
- Generic cover: /przeglad/assets/editorial-cover.svg, editorial art, not a
  photograph. Use real, verified, credited media when available.
- Local assets in Astro public's przeglad/assets/; shared dev/build URLs.
- Timeline recaps may intentionally summarize article facts. No duplicated
  full sections. Do not pass off stock photos as actual listings.

### Source embeds

Use the existing media field with `kind: embed`, original public source URL,
alt and credit. Renderer constructs official players; no iframe HTML, APIs,
dependency or per-issue code. Supported source links:

- YouTube watch, shorts, live and youtu.be (privacy-enhanced player).
- Vimeo public numeric video URL.
- TikTok full post URL (video or photo; resolve short links first).
- Spotify track, album, playlist, episode, show, artist.

```yaml
media:
  kind: embed
  src: "https://www.youtube.com/watch?v=M7lc1UVf-VE"
  alt: "Describe the actual video"
  credit: "Original channel"
```

Omit `aspect` for embeds; each player has provider-specific dimensions.
External player loads only after reader clicks; original link always visible.
Use platform-provided embedding when enabled. Summarize important information
in text and link unsupported, restricted or removed posts instead. No arbitrary
iframes or remote script injection. Embed playback and availability depend on
the provider; no guarantee of playback of restricted content.

References: [YouTube](https://developers.google.com/youtube/player_parameters),
[Vimeo](https://help.vimeo.com/hc/en-us/articles/12426259908881-How-to-embed-my-video/),
[TikTok](https://developers.tiktok.com/docs/en/embed-player),
[Spotify](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed).

One Markdown commit per edition; no per-issue code, CSS, workflow or feed changes.
