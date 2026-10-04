# Pet Dispatcher plugin

Portable ChatGPT/Codex packaging for the existing Pet Dispatcher MCP server.

The package does **not** host another dispatcher. It points at the production Streamable HTTP control plane and adds reusable workflow guidance plus plugin metadata.

## Authentication

For local/Codex plugin use, set `PET_DISPATCHER_CONTROL_TOKEN` to the existing control-plane bearer token. Keep the value outside the plugin and repository.

ChatGPT Developer Mode may instead use a separately registered authenticated MCP connection. The legacy connector-token URL remains a compatibility path in the server, not something stored in this package.

OAuth/Mixed Authentication is tracked in [../plugin-roadmap.md](../plugin-roadmap.md).

## Included workflow

`skills/confined-repo-work/SKILL.md` teaches the normal tool order:

1. focused inspection and reads;
2. deterministic direct operation when a focused tool exists;
3. delegation for reasoning-heavy or multi-step coding;
4. task polling only when needed;
5. explicit session finalization.

`golden-prompts.json` is the metadata-routing regression set.

## Portable package and local marketplace

The plugin uses the current portable Agent Plugins layout: root `plugin.json`,
root `mcp.json`, bundled Skills and plugin-contained assets. The repository
marketplace at `.agents/plugins/marketplace.json` exposes it for local authoring
and testing. No compatibility manifest is added unless an older client actually
requires one.
