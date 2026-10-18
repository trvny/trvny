# MechaGremlin plugin

This directory is the maintained **portable source** of the existing private
MechaGremlin plugin. The existing private plugin is now release `0.31.8`
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

The registered Gremlin ChatGPT app is declared in `.app.json` with the
canonical source alias `gremlin`, matching the MCP key to avoid duplicate
routes in Codex. The migrated account release retains its original
host-generated alias `connector` for the same Gremlin App ID.
`.app.json` also references the user's existing Anchor app under `anchor`
(`asdk_app_6a206df34f6c8191a125958d061edd74`) as an **optional** app.
This is a stable App ID, not an App version ID. The canonical Streamable
HTTP MCP configuration stays in `mcp.json`, targeting
`https://gremlin.travny.workers.dev/mcp`. The host-generated
`.codex-plugin/plugin.json` and `.mcp.json` are compatibility outputs, not
separately maintained definitions. The same original logo is used by
`plugin.json` for the plugin and composer icon.

The Gremlin MCP exposes 28 guarded operator tools (including `getDocsIndex`)
and four specialist tools for Context7 and Feedseek. The five unrelated Engram
routes were retired from Gremlin, without deleting shared legacy consumers. Actions route
through the shared `kanarek-companion` runtime, which owns authentication
checks, GPTomek attribution, scope guards, replay protections and Cloudflare
policy. Do not duplicate that runtime inside this package.

Anchor storage (`useGremlinStorage`) uses **separate Anchor OAuth** and is
not part of the 32-tool MCP surface. The optional Anchor app is now bundled
with the existing MechaGremlin plugin (live release `0.31.8`). When Anchor
is connected in the session, use the existing `Gremlin_storage` folder.
Never proxy Anchor OAuth credentials through Gremlin or treat the successful
manifest update as proof of a fresh-session, end-to-end OAuth test.

For migration history, parity status, and pending verification, see
`skills/gremlin/references/migration.md` and
[issue #958](https://github.com/trvny/trvny/issues/958).

No secrets, OAuth tokens, copied personal context, or runtime policy duplicates
belong in this portable source.
