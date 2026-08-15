# status-mcp

[![status-mcp](https://github.com/trvny/trvny/actions/workflows/status-mcp-deploy.yml/badge.svg)](https://github.com/trvny/trvny/actions/workflows/status-mcp-deploy.yml)

One [MCP](https://modelcontextprotocol.io) server, one tool — health-checks all
four travny projects in a single call. Cloudflare Worker, **free tier**: service
bindings, no token, plus outbound GitHub fetches.

## Why one server, one tool

`tvpi`, **Feedseek**, `weather`, and `autka` each have a health surface. Rather
than four connectors and four tool calls, this is **one connector** exposing
**one `status` tool** that fans out to all four in parallel and returns a compact
roll-up — a morning check in a single invocation.

## The tool

### `status`

| arg | type | default | meaning |
| --- | --- | --- | --- |
| `project` | string | — | scope to one; omit for all four |
| `deep` | boolean | `false` | probe TVPI channel redirects |

`project` accepts `tvpi`, `feeds`, `weather`, or `autka`. The `feeds` selector is
kept as the compatibility key for **Feedseek** after the repository rename.

- **tvpi** — reads `/playlist.m3u`'s `X-Source-*` headers: `live`/`cache` = ok,
  `kv`/`raw`/`r2` = degraded, absent = down.
- **Feedseek** (`feeds`) — pipeline pass/fail from the `update-feeds.yml` badge
  SVG in `trvny/feedseek`, plus a best-effort root `feeds.yaml`-vs-`feeds/`
  cross-check for missing/tiny files.
- **weather** — `/healthz` freshness, live source coverage, IMGW warning
  freshness, forecast cycle state, and entry count.
- **autka** — backend `/health`, `/offers` count, `/sources`, and the
  `android-ci.yml` badge.

## Deploy

Auto-deploys from `trvny/trvny` via `.github/workflows/status-mcp-deploy.yml`
on push to `mcp/status-mcp/**` (reuses repo secrets `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`). Manual: `npm install && npx wrangler deploy` from this
folder.

## Authentication

The endpoint needs a shared secret before it will answer anything. Generate one
and store it as a Worker secret:

```bash
# any long random string; this prints one without putting it in shell history
openssl rand -base64 32
npx wrangler secret put STATUS_MCP_TOKEN
```

Until that secret exists, every `POST` is rejected with `401`. That is
deliberate: the endpoint is reachable from the open internet and drives the
other Workers through service bindings, so it fails closed rather than open.

Then add `https://status-mcp.<subdomain>.workers.dev` as a single custom
connector in Claude, with the header:

```text
Authorization: Bearer <the same token>
```

`GET` stays unauthenticated and returns a one-line banner. It touches no service
binding, and leaving it open keeps the CORS preflight working — a client cannot
present a token on a preflight.

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs / workflow names are
constants at the top of each section in `src/index.ts`.
