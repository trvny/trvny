# MechaGremlin plugin

This directory is the maintained **portable source** of the existing private
MechaGremlin plugin. The existing private plugin is now release `0.31.11`
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
The optional Anchor app dependency from release `0.31.8` was removed in
`0.31.9`: Anchor is already available as an independent ChatGPT app, and
bundling it introduced no new Gremlin tools. The canonical Streamable
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

Anchor remains an **independent ChatGPT app** with its own OAuth, not
part of the 32-tool Gremlin MCP and not a bundled plugin dependency.
Anchor's existing `Gremlin_storage` folder remains available through its
own separately authorized ChatGPT app. The Gremlin skill does not depend on
or instruct model calls to external apps. Never proxy OAuth credentials.

For migration history and acceptance gates, consult the repository-only
[`../MIGRATION.md`](../MIGRATION.md) and [issue #958](https://github.com/trvny/trvny/issues/958). They are not packaged as skill knowledge.

No secrets, OAuth tokens, copied personal context, or runtime policy duplicates
belong in this portable source.
