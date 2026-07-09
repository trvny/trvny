# status-mcp

One [MCP](https://modelcontextprotocol.io) server, one tool — health-checks all
three travino projects in a single call. Cloudflare Worker, **free tier**: no
bindings, no token, pure outbound fetch.

## Why one server, one tool

`tvpi`, `feeds`, and `autka` each have a health surface. Rather than three
connectors and three tool calls, this is **one connector** exposing **one
`status` tool** that fans out to all three in parallel and returns a compact
roll-up — a morning check in a single invocation.

## The tool

### `status`

| arg       | type                     | default | meaning                                               |
|-----------|--------------------------|---------|-------------------------------------------------------|
| `project` | `tvpi`\|`feeds`\|`autka` | —       | scope to one; omit for all three                      |
| `deep`    | boolean                  | `false` | tvpi only: also probe each channel's `.m3u8` redirect |

- **tvpi** — reads `/playlist.m3u`'s `X-Source-*` headers: `live`/`cache` = ok,
  `kv`/`raw`/`r2` = degraded, absent = down.
- **feeds** — pipeline pass/fail from the `update-feeds.yml` badge SVG, plus a
  best-effort `feeds.yaml`-vs-`feeds/` cross-check for missing/tiny files.
- **autka** — backend `/health`, `/offers` count, `/sources`, and the
  `android-ci.yml` badge.

## Deploy

Auto-deploys from `travino/travino` via `.github/workflows/status-mcp-deploy.yml`
on push to `mcp/status-mcp/**` (reuses repo secrets `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`). Manual: `npm install && npx wrangler deploy` from this
folder.

Then add `https://status-mcp.<subdomain>.workers.dev` as a single custom
connector in Claude. No auth — read-only public data.

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs / workflow names are
constants at the top of each section in `src/index.ts`.
