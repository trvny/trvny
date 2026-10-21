# Gremlin plugin

This directory is the **single maintained portable source** for the Gremlin skill, its references, lookup index, metadata and branding. Keep it authoritative; ChatGPT App-backed files are staged from this directory, not maintained as a second copy.

## ChatGPT account migration (October 2026)

The previous private **MechaGremlin** wrapper was version `0.31.11` (`plugin_2efcd1a24fa08191b71d92f1972ac32c`) and has been uninstalled. The existing registered **Gremlin** MCP App-backed private plugin is now `1.0.2`; it was updated **in place**, rather than adding a new production plugin. That app's built-in actions and its `skills/gremlin/` skill live under the same ChatGPT entry.

During the first migration, the App contained only `SKILL.md` and `agents/openai.yaml`. This was corrected in `1.0.2`: **all three source references** are now bundled at `skills/gremlin/references/` together with `skills/gremlin/lookup/knowledge-index.json`. All four restored support files match their source/original plugin byte counts. The skill routes relevant creative work to those local references; they are not replaced by a placeholder or just a link to GitHub.

The App-backed registration uses the existing Gremlin MCP App binding. **Do not create a new Gremlin connection or a parallel MechaGremlin wrapper.** For later skill releases, stage the complete canonical `skills/gremlin/` tree into the existing App-backed plugin, keep its original generated `.app.json` and identity/presentation, and verify the Skills and MCP Actions sections after updating. Removing obsolete private-plugin records is a separate account operation: an installed-app uninstall API can report `not_installed` even when a private owned plugin appears in the user's library.

The portable `plugin.json`, `mcp.json` and compatibility files remain useful for other Agent Plugins clients. They are **not** an alternative source of truth or evidence that ChatGPT automatically registers `mcpServers`. The historical portable `0.31.11` package and private App `1.0.2` intentionally have different versions.

## Content and runtime boundaries

The source uses `skills/gremlin/` as its canonical skill directory, including:
- `SKILL.md` and `agents/openai.yaml`;
- `references/gremlin-style.md`, `references/GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md` and `references/edgy-dark-meme-formats.json`;
- `lookup/knowledge-index.json` pointing to those existing references.

The removed legacy standalone `AGENTS.md`, `GREMLIN_STYLE.md` and `USER_CONTEXT.md` are not bundled. The skill metadata is UI configuration, not duplicate operating instructions. No tokens, OAuth credentials, personal context snapshots or copied runtime policies belong in this source.

The canonical Streamable HTTP MCP endpoint is `https://gremlin.travny.workers.dev/mcp`. It exposes guarded operator and specialist routes, backed by the shared `kanarek-companion` runtime that owns authentication, GPTomek attribution, scope controls, replay protection and Cloudflare policy. Do not clone this runtime into plugin packaging. Preserve the existing Gremlin OAuth authorization and its source alias; changing an App's configuration or binding is not a skill-only plugin update.

**Anchor remains separate** with its own OAuth. The `Gremlin_storage` folder is reached through the independently connected Anchor app; Gremlin does not proxy Anchor credentials or embed Anchor actions.

For historical migration and acceptance gates see repository-only [MIGRATION.md](../MIGRATION.md) and [issue #958](https://github.com/trvny/trvny/issues/958). Keep migration logs out of the runtime skill.
