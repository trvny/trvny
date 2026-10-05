# MechaGremlin migration parity

This is a category-level migration checklist, not a copied list of API
operations. The live Gremlin capability manifest and Custom GPT OpenAPI remain
the source of truth for exact operation names and schemas.

## OpenAI migration mechanics

OpenAI's current migration flow gives different treatment to each GPT surface:

- the GPT Builder instructions become a skill in the new plugin;
- GPT knowledge files are copied to plugin reference files;
- connected apps are added as plugin apps;
- Custom Actions do **not** transfer and must be rebuilt with an app or MCP;
- the selected GPT model does not transfer;
- existing conversations do not transfer;
- sharing settings do not transfer and the migrated plugin starts private;
- migration uses the latest published GPT version rather than unpublished draft
  edits;
- after migration the original GPT remains usable until retirement but becomes
  read-only.

Source:
<https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq>

## 2026-09-28 web-configuration snapshot

The supplied Gremlin web-configuration archive contains:

- `gremlin.json5`: the main GitHub-OAuth Custom Action OpenAPI document;
- `AGENTS.md`;
- `GREMLIN.md`;
- `GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`;
- `edgy_dark_meme_formats.json`;
- `USER_CONTEXT.md`.

The archive does not encode which Markdown text came from the GPT Builder
Instructions field versus which files were uploaded as Knowledge. Do not infer
that distinction from filenames alone. On migration day, inspect the generated
skill and copied reference files and compare them with the source GPT.

Do not copy this archive wholesale into the public repository. In particular,
`USER_CONTEXT.md` is user-specific context rather than a maintained product
contract. If migration copies it as a reference file, review it separately for
freshness and whether it should remain plugin-local, move to durable memory, or
be removed.

## Custom Action parity snapshot

The supplied `gremlin.json5` exposes 30 main Custom Action operations through
the GitHub-OAuth Gremlin gateway. Those operations are migration input only:
OpenAI does not convert this OpenAPI action surface into MCP automatically.

The current repository deliberately curates 29 operations in
`CUSTOM_GPT_OPERATION_IDS` plus the separately authenticated Anchor operation
`useGremlinStorage`. The supplied web schema includes `getDocsIndex`, which
is not in that 29-operation curated list. Resolve that difference explicitly
before retiring the GPT instead of assuming the web schema and repository
surface are identical.

The live capability manifest, generated OpenAPI and MCP schema remain canonical.
The uploaded `gremlin.json5` is a point-in-time comparison snapshot, not a new
source of truth.

## Already reusable

- Custom GPT instructions and knowledge: handled by ChatGPT's GPT-to-plugin
  migration flow, then compared against the maintained Gremlin sources.
- Specialist MCP transport: the shared runtime already exposes an authenticated
  stateless MCP at `/mcp`.
- Specialist backend logic: Engram, Feedseek, and Context7 stay in the existing
  Specialist Intelligence subsystem.
- Gremlin remains the owner package while its maintained core is
  imported from `kanarek-companion`.

## Still required before retiring the GPT

- Expose guarded GitHub read/context/investigation capabilities through MCP.
- Expose the existing high-level guarded mutation workflows through MCP without
  adding a second write allowlist.
- Reconcile the `getDocsIndex` web-action difference.
- Preserve GPTomek attribution for bot-authored GitHub writes.
- Expose the required Cloudflare inspection and guarded mutation capabilities.
- Decide how Anchor OAuth storage is represented in the plugin without copying
  credentials or weakening its current authorization boundary.
- Cover release, workflow, maintenance, package/docs, and other live Operator
  capability categories that the migrated GPT still depends on.

## Acceptance gates

1. Publish any final Custom GPT edits before migration and archive the exact web
   configuration used for the migration.
2. Run the migration and inspect the generated skill and copied reference files
   before treating them as equivalent.
3. Compare the migrated plugin against the live Custom GPT OpenAPI/capability
   manifest and account for every required capability.
4. Verify OAuth and identity checks with positive and negative tests.
5. Smoke-test repository reads, repository context, investigation, guarded
   writes, Cloudflare reads, specialist MCP tools, and cancellation/error paths.
6. Confirm no plugin file contains a secret or duplicated backend policy.
7. Confirm GPTomek-authored writes still use the existing bridge.
8. Keep the original GPT as the behavioral fallback until the plugin passes
   parity checks, even though the original becomes read-only after migration.
9. Only then treat the migrated plugin as the maintained successor.
