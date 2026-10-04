# Claudiusz MCP

Remote MCP server that acts on GitHub as
[`claudiusz69[bot]`](https://github.com/apps/claudiusz69), so Claude's comments,
reactions and reviews carry the bot identity instead of `trvny`.

The GitHub App identity is runtime-independent: App JWT signing uses
`CLAUDIUSZ_APP_ID` plus `GH_APP_PRIVATE_KEY`. The Cloudflare Worker and
Manufact runtime therefore act as the same `claudiusz69[bot]` installation.

## Tools

`whoami`, `comment`, `edit_comment`, `react` (issue, issue/review comment, any
GraphQL node), `reply_review_comment`, `review`, `resolve_thread`,
`discussion_comment`.

Installations are resolved per owner and limited to `ALLOWED_OWNERS`
(`trvny,travnie`). Install the app only on repositories it should touch.

## Secrets

- `CLAUDIUSZ_MCP_TOKEN` — connector URL path token; unset rejects every POST.
- `GH_APP_PRIVATE_KEY` — app private key, PEM as downloaded (PKCS#1 or PKCS#8).

## App permissions

Issues, Pull requests and Discussions: read and write.

## Icon

`GET /icon.png` (no token) proxies the app avatar and is advertised in
`serverInfo.icons`.

## Cloudflare fallback

Worker: `claudiusz-mcp` (workers.dev).

Connector:

`https://claudiusz-mcp.travny.workers.dev/<CLAUDIUSZ_MCP_TOKEN>`

Workers Builds deploys on pushes to `main` that touch this directory
(`npm run check`, then `npm run deploy`).

Manual: `npm run deploy`, or upload a bundle through the Cloudflare API
(multipart `PUT /workers/scripts/claudiusz-mcp`) with
`keep_bindings: ["secret_text"]` in the metadata so the secrets survive.

## Manufact runtime

Manufact hosts the same Wrangler-built Worker bundle behind a thin Node HTTP
adapter. No GitHub/MCP tool logic is duplicated.

- Root directory: `gh-apps/claudiusz`
- Build: `npm ci && npm run manufact:build`
- Start: `npm run manufact:start`
- Port: `3000`
- Region: `EU`
- Variables: `CLAUDIUSZ_APP_ID=4454097`, `ALLOWED_OWNERS=trvny,travnie`
- Secrets: `CLAUDIUSZ_MCP_TOKEN`, `GH_APP_PRIVATE_KEY`

Keep the Worker available as a fallback until the Manufact deployment passes
`whoami` and a safe GitHub write/read-back smoke test.
