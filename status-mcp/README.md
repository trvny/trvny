# status-mcp

One [MCP](https://modelcontextprotocol.io) server, one tool — health-checks all
three travino projects (tvpi, feeds, autka) in a single call. Cloudflare Worker,
**free tier**: no bindings, no token, pure outbound fetch. Lives here in the
private `travino` repo; the deployed Worker is what the connector talks to, so
the code's location/visibility doesn't affect how it runs.

## The tool

### `status`

| arg | type | default | meaning |
|---|---|---|---|
| `project` | `tvpi`\|`feeds`\|`autka` | — | scope to one; omit for all three |
| `deep` | boolean | `false` | tvpi only: also probe each channel's `.m3u8` redirect |

Per-project checks (all unauthenticated, all free):

- **tvpi** — reads `/playlist.m3u`'s `X-Source-*` headers in one request:
  `live`/`cache` = ok, `kv`/`raw`/`r2` = degraded, absent = down. `deep` confirms
  each channel resolves a fresh tokenized manifest.
- **feeds** — pipeline pass/fail from the `update-feeds.yml` status-**badge SVG**
  (CDN, no API rate limit), plus a best-effort `feeds.yaml`-vs-`feeds/`
  cross-check for MISSING / tiny files. NOTE: this relies on the **feeds repo
  staying public** (unauthenticated raw + contents API).
- **autka** — backend `/health`, `/offers` count, `/sources` enabled flags, and
  the `android-ci.yml` badge.

## Deploy

```bash
cd status-mcp
npm install
npx wrangler login      # one-time
npm run deploy
```

Add the printed `https://status-mcp.<subdomain>.workers.dev` URL as a single
custom connector in Claude (Settings → Connectors → Add custom connector). No
auth — read-only public data.

Auto-deploy: add repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
to this repo, then a workflow triggering on `status-mcp/**`.

## Local dev

```bash
npm run dev          # wrangler dev
npm run typecheck    # tsc --noEmit
```

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs/workflow names are
constants at the top of each section in `src/index.ts`.
