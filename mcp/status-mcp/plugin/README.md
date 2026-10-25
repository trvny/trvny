# TRAVNY Status plugin

Portable read-only plugin packaging for the existing [Status MCP](../README.md). It adds metadata, the service-health skill, branding, and authentication configuration. It **does not** create a second health service or expose any public unauthenticated status checks.

## Connection

- MCP endpoint: `https://status-mcp.travny.workers.dev/` (the same existing Worker).
- Authentication: existing `STATUS_MCP_TOKEN` via `Authorization: Bearer`. The portable `mcp.json` retains `bearer_token_env_var` for clients that support it; the OpenAI extension declares API-key bearer authentication for the connection UI.
- The token is provisioned separately. **Never** put it in a plugin archive, query string or visible URL. The legacy token-in-path server compatibility remains unchanged, but is not configured by the plugin.
- Support for connecting a fixed API key depends on the client and account. This package alone does not install or connect the remote MCP inside ChatGPT.

## Brand and packaging

`assets/icon.svg` is a **generated copy** of the single maintained `assets/status-mcp.svg` in the repository root. `npm run build:icon` refreshes this copy alongside the Worker's rasterized icon; tests reject drift. No second hand-maintained logo.

Run `npm test` and `npm run check` from the parent `mcp/status-mcp` directory. The local plugin catalog at `.agents/plugins/marketplace.json` points to this folder.
