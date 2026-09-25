# Claudiusz MCP

Remote MCP server that acts on GitHub as
[`claudiusz69[bot]`](https://github.com/apps/claudiusz69), so Claude's comments,
reactions and reviews carry the bot identity instead of `trvny`.

Worker: `claudiusz-mcp` (workers.dev). App JWT signing reuses
`kanarek-companion/github-app`.

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

## Connector

`https://claudiusz-mcp.travny.workers.dev/<CLAUDIUSZ_MCP_TOKEN>`

## Deploy

Workers Builds deploys on pushes to `main` that touch this directory
(`npm run check`, then `npm run deploy`).

Manual: `npm run deploy`, or upload a bundle through the Cloudflare API
(multipart `PUT /workers/scripts/claudiusz-mcp`) with
`keep_bindings: ["secret_text"]` in the metadata so the secrets survive.
