# MechaGremlin plugin

This directory is the maintained **portable source** of the existing private
MechaGremlin plugin. The live private plugin is release `0.31.6`
(`plugin_2efcd1a24fa08191b71d92f1972ac32c`).
**Do not create another production plugin.**

The source uses `skills/gremlin/` as its sole canonical skill directory.
The migrated account plugin still presents that same skill at
`skills/instructions/`; this is a packaging-layout difference, not a second
Gremlin skill. The style reference exists only at
`skills/gremlin/references/gremlin-style.md`. The removed legacy files
`AGENTS.md`, `GREMLIN_STYLE.md` and `USER_CONTEXT.md` are not included.
`agents/openai.yaml` is skill UI metadata, not another instruction source.
The compact `lookup/knowledge-index.json` points only to existing references.

The registered ChatGPT app is declared in `.app.json` with alias `gremlin`,
matching the MCP key to prevent double routes in Codex. The migrated account
release may expose the host-generated alias `connector` until re-published;
this portable source is deliberately normalized. The canonical Streamable
HTTP MCP configuration stays in `mcp.json`, targeting
`https://gremlin.travny.workers.dev/mcp`. The host-generated
`.codex-plugin/plugin.json` and `.mcp.json` are compatibility outputs, not
separately maintained definitions. The same original logo is used by
`plugin.json` for the plugin and composer icon.

The Gremlin MCP exposes 30 guarded operator tools (including `getDocsIndex`)
and seven specialist tools for Context7, Feedseek and Engram. Actions route
through the shared `kanarek-companion` runtime, which owns authentication
checks, GPTomek attribution, scope guards, replay protections and Cloudflare
policy. Do not duplicate that runtime inside this package.

Anchor storage (`useGremlinStorage`) uses **separate Anchor OAuth** and is
not part of the 37-tool MCP surface. Never proxy its credentials or silently
add it to the registered app.

For migration history, parity status, and pending verification, see
`skills/gremlin/references/migration.md` and
[issue #958](https://github.com/trvny/trvny/issues/958).

No secrets, OAuth tokens, copied personal context, or runtime policy duplicates
belong in this portable source.
