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

- `CLAUDIUSZ_MCP_TOKEN` — the OAuth access code typed once on the authorize
  page, and the HMAC key for client IDs, codes and tokens (both runtimes, so
  their tokens are interchangeable). Also accepted directly as Bearer, and as
  the legacy URL path. Rotating it revokes every issued token.
- `GH_APP_PRIVATE_KEY` — app private key, PEM as downloaded (PKCS#1 or PKCS#8).

## App permissions

Issues, Pull requests and Discussions: read and write.

## Icon

The GitHub App avatar is advertised directly and through the same-origin
`GET /icon.png` fallback. `GET /favicon.ico` is an alias. Server metadata,
modern MCP `_meta["io.modelcontextprotocol/serverInfo"]`, and each tool all
reference the same icon set so clients can use whichever surface they support.

## Cloudflare fallback

Worker: `claudiusz-mcp` (workers.dev).

Connector: `https://claudiusz-mcp.travny.workers.dev/mcp` — MCP OAuth
(`src/oauth.ts`): discovery, dynamic client registration, Authorization Code +
PKCE, 1 h access / 30 d refresh tokens. The authorize page asks once for
`CLAUDIUSZ_MCP_TOKEN`; it never reaches the client and the URL stays token-free,
so it can ship in plugin `.mcp.json` files.

Stateless on purpose (isolates aren't sticky): the form nonce and the
authorization code are signed, expiring values. A code is therefore replayable
until it expires (5 min), but only together with its PKCE verifier.

Legacy: `https://claudiusz-mcp.travny.workers.dev/<CLAUDIUSZ_MCP_TOKEN>` still
works. Remove that path once no connector uses it.

Workers Builds deploys on pushes to `main` that touch this directory or
`gh-apps/core/**`
(`npm run check`, then `npm run deploy`).

Manual: `npm run deploy`, or upload a bundle through the Cloudflare API
(multipart `PUT /workers/scripts/claudiusz-mcp`) with
`keep_bindings: ["secret_text"]` in the metadata so the secrets survive.

## Manufact runtime

Manufact hosts the same Wrangler-built Worker bundle behind a thin Node HTTP
adapter. No GitHub/MCP tool logic is duplicated. The build context includes
`kanarek-companion` because Claudiusz reuses its canonical GitHub App JWT helper.

The hosted adapter adds standard MCP OAuth discovery, dynamic client
registration, Authorization Code + PKCE, short-lived access tokens and refresh
tokens. The authorization page asks the owner for the existing
`CLAUDIUSZ_MCP_TOKEN`; the token is never sent to the MCP client. A direct
`Authorization: Bearer <CLAUDIUSZ_MCP_TOKEN>` remains accepted for CLI and
break-glass access.

- Root directory: `gh-apps`
- Dockerfile: `claudiusz/Dockerfile.manufact`
- Port: `3000`
- Region: `AUTO` on the free plan
- Variables: `CLAUDIUSZ_APP_ID=4454097`, `ALLOWED_OWNERS=trvny,travnie`
- Secrets: `CLAUDIUSZ_MCP_TOKEN`, `GH_APP_PRIVATE_KEY`

Keep the Worker available as a fallback until the Manufact deployment passes
`whoami` and a safe GitHub write/read-back smoke test.
