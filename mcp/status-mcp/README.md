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

The endpoint needs a shared secret before it will answer anything. Until the
secret exists, every `POST` is rejected with `401` — deliberately, since the
endpoint is reachable from the open internet and drives the other Workers
through service bindings, so it fails closed rather than open.

Generate a **URL-safe** token. It has to survive being a path segment, so no
`/` or `+`:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Store it as a Worker secret named `STATUS_MCP_TOKEN`, either with
`npx wrangler secret put STATUS_MCP_TOKEN` or, without a local wrangler, in the
dashboard under **Workers & Pages → status-mcp → Settings → Variables and
Secrets**.

## Calling it

The token goes in the URL path:

```text
https://status-mcp.<subdomain>.workers.dev/<token>
```

That is the form to add as a custom connector in Claude, because the connector
form offers a URL and OAuth and no place for a header.

A bearer header works too and is the nicer way to call it by hand:

```bash
curl -X POST https://status-mcp.<subdomain>.workers.dev/ \
  -H "Authorization: Bearer $STATUS_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A token in a URL is usually a bad idea because URLs land in logs. The only log
that would see this one is this Worker's own, which is why `invocation_logs` is
off in `wrangler.jsonc`. Nothing links here and the request is made server-side,
so there is no referrer to leak either.

`GET` stays unauthenticated and returns a one-line banner. It touches no service
binding, and leaving it open keeps the CORS preflight working — a client cannot
present a token on a preflight.

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs / workflow names are
constants at the top of each section in `src/index.ts`.
