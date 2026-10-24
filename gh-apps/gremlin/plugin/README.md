# Gremlin plugin

This directory is the **single maintained portable source** for the Gremlin skill, its references, lookup index, metadata and branding. Keep it authoritative; ChatGPT App-backed files are staged from this directory, not maintained as a second copy.

## ChatGPT account migration (October 2026)

The original GPT-migrated **MechaGremlin** personal plugin (`plugin_2efcd1a24fa08191b71d92f1972ac32c`) is the preferred single ChatGPT plugin. It was updated in place to `0.31.12`, preserving its identity, registered Gremlin App binding, MCP endpoint, icon and references. Updating the package does not install or connect it; activate it in ChatGPT.

The separate App-backed **Gremlin** (`plugin_asdk_app_6ad3cba96c048191b0006fed71f4e0ef`, `1.0.6`) references the same registered MCP App. Keep that alternate package uninstalled to avoid duplicate plugin entries; it is not required by MechaGremlin.

For future MechaGremlin releases, stage the canonical `skills/gremlin/SKILL.md` into the migrated `skills/instructions/SKILL.md` package location. Preserve existing `.app.json`, `mcp.json`, `.mcp.json`, branding and OAuth bindings. The repository remains the single maintained source; the account package is only a deployment target.

## Content and runtime boundaries

The source uses `skills/gremlin/` as its canonical skill directory, including:
- `SKILL.md` and `agents/openai.yaml`;
- `references/gremlin-style.md`, `references/GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md` and `references/edgy-dark-meme-formats.json`;
- `lookup/knowledge-index.json` pointing to those existing references.

The removed legacy standalone `AGENTS.md`, `GREMLIN_STYLE.md` and `USER_CONTEXT.md` are not bundled. The skill metadata is UI configuration, not duplicate operating instructions. No tokens, OAuth credentials, personal context snapshots or copied runtime policies belong in this source.

The canonical Streamable HTTP MCP endpoint is `https://gremlin.travny.workers.dev/mcp`. It exposes guarded operator and specialist routes, backed by the shared `kanarek-companion` runtime that owns authentication, GPTomek attribution, scope controls, replay protection and Cloudflare policy. Do not clone this runtime into plugin packaging. Preserve the existing Gremlin OAuth authorization and its source alias; changing an App's configuration or binding is not a skill-only plugin update.

**Anchor remains separate** with its own OAuth. The `Gremlin_storage` folder is reached through the independently connected Anchor app; Gremlin does not proxy Anchor credentials or embed Anchor actions.

The canonical skill describes only Gremlin's distinctive capabilities; MCP exposes 18 guarded operators and three Feedseek specialists. Ordinary providers are not proxied. Repository edits require an in-place skill release to reach ChatGPT.

For historical migration, overlap audit and acceptance gates see repository-only [MIGRATION.md](../MIGRATION.md) and [issue #958](https://github.com/trvny/trvny/issues/958). Keep migration logs out of the runtime skill.

Release `1.0.3` consolidates operational rules in `SKILL.md` and compresses the voice guide. The detailed meme-craft reference and structured format registry retain their full contents and are consulted only when relevant.
