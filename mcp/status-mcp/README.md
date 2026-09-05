# status-mcp

[![status-mcp](https://github.com/trvny/trvny/actions/workflows/status-mcp-ci.yml/badge.svg)](https://github.com/trvny/trvny/actions/workflows/status-mcp-ci.yml)

One [MCP](https://modelcontextprotocol.io) server, one tool — health-checks all
four TRAVNY ecosystem projects in a single call. Cloudflare Worker, **free tier**: service
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

Production deploys from `trvny/trvny` through Cloudflare Workers Builds,
rooted at `mcp/status-mcp` and watching `main`. The
`.github/workflows/status-mcp-ci.yml` workflow only validates changes.
Manual: `npm install && npx wrangler deploy` from this folder.

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

## The connector icon

A client draws the connector from `serverInfo` in the reply to `initialize` —
nothing else. It never looks for a favicon on this host, so a server that sends
only a name and version gets a letter avatar.

`src/icon.ts` is **generated**, not written by hand: it is
`assets/status-mcp.svg` from the repo root, rasterized to a 512×512 indexed PNG
and base64-encoded. Edit the SVG, then `npm run build:icon` — never the module.

The script refuses to write an icon whose circle has lost the `#FFFDF8` fill,
because that is how the first attempt broke: capping the palette at eight
colours dropped the cream outright and the served icon quietly stopped matching
its source. Palette mode stays on, the colour count stays uncapped.

It needs `sharp`, which is **not** a declared dependency on purpose — a native
package wanted maybe once a year should not be installed by every `npm ci` and
every deploy. It comes in transitively with wrangler; if it ever stops doing so,
the script says which command to run.

The Worker answers `GET /icon.png` from that constant. A static-assets binding
would be the obvious way to serve a file, and it does not work here: adding
`"assets"` to `wrangler.jsonc` makes every authenticated request fail, in both
the bearer-header and token-in-path forms (measured 2026-08-28). Inlining keeps
the gate intact, and `GET` was already unauthenticated and reaches no service
binding, so `https://status-mcp.<subdomain>.workers.dev/icon.png` needs no
token — which it must not, because claude.ai fetches it anonymously.

## Keeping it correct

`TVPI_SLUGS` must track tvpi's `CHANNELS`. Project URLs / workflow names are
constants at the top of each section in `src/index.ts`.
