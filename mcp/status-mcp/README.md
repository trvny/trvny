# status-mcp

[![status-mcp](https://github.com/trvny/trvny/actions/workflows/status-mcp-deploy.yml/badge.svg)](https://github.com/trvny/trvny/actions/workflows/status-mcp-deploy.yml)

One [MCP](https://modelcontextprotocol.io) server, one tool — health-checks all
four travny projects in a single call. Cloudflare Worker, **free tier**: service
bindings, no token, plus outbound GitHub fetches.

## Why one server, one tool

`tvpi`, `feeds`, `weather`, and `autka` each have a health surface. Rather than four
connectors and four tool calls, this is **one connector** exposing **one
`status` tool** that fans out to all four in parallel and returns a compact
roll-up — a morning check in a single invocation.

## The tool

### `status`

| arg       | type                     | default | meaning                                               |
|-----------|--------------------------|---------|-------------------------------------------------------|
| `project` | `tvpi`\|`feeds`\|`weather`\|`autka` | —       | scope to one; omit for all four              |
| `deep`    | boolean                  | `false` | tvpi only: also probe each channel's `.m3u8` redirect |

- **tvpi** — reads `/playlist.m3u`'s `X-Source-*` headers: `live`/`cache` = ok,
  `kv`/`raw`/`r2` = degraded, absent = down.
- **feeds** — pipeline pass/fail from the `update-feeds.yml` badge SVG, plus a
  best-effort `feeds.yaml`-vs-`feeds/` cross-check for missing/tiny files.
- **weather** — `/healthz` freshness, live source coverage, IMGW warning freshness,
  forecast cycle state, and entry count.
- **autka** — backend `/health`, `/offers` count, `/sources`, and the
  `android-ci.yml` badge.

## Deploy

Auto-deploys from `trvny/trvny` via `.github/workflows/status-mcp-deploy.yml`
on push to `mcp/status-mcp/**` (reuses repo secrets `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`). Manual: `npm install && npx wrangler deploy` from this
folder.

Then add `https://status-mcp.<subdomain>.workers.dev` as a single custom
connector in Claude. No auth — read-only public data.

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs / workflow names are
constants at the top of each section in `src/index.ts`.
