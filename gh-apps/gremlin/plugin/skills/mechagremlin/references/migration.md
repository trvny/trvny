# MechaGremlin migration parity

This is the migration checklist for the private plugin created from the legacy
MechaGremlin Custom GPT. Live Gremlin schemas and runtime policy remain the
source of truth for tool behavior.

## OpenAI migration mechanics

OpenAI's migration flow treats each GPT surface differently:

- GPT Builder instructions become a skill;
- GPT knowledge files become skill reference files;
- connected apps remain plugin apps;
- Custom Actions do **not** transfer and must be rebuilt as an app or MCP;
- the selected model, previous chats and sharing settings do not transfer;
- the migrated plugin starts private;
- the original GPT becomes read-only but remains usable until GPT retirement.

Source:
<https://learn.chatgpt.com/docs/migrate-custom-gpts>

## Source snapshot

The archived web configuration used for comparison contains:

- `gremlin.json5`: the GitHub-OAuth Custom Action OpenAPI document;
- `GREMLIN.md`: copied Builder instructions;
- `AGENTS.md`;
- `GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`;
- `edgy_dark_meme_formats.json`;
- `USER_CONTEXT.md`.

The last four files were GPT Knowledge. Do not copy the archive wholesale into
this public repository.

## Observed migrated plugin

The built-in migration completed successfully and produced a private plugin with:

- one migrated skill currently displayed as `MechaGrepmlin`;
- no apps, as expected because Custom Actions do not migrate;
- migrated references for `AGENTS.md`,
  `GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`, `edgy-dark-meme-formats.json` and
  `USER_CONTEXT.md`;
- a generated `lookup/knowledge-index.json` mapping the original Knowledge
  filenames to their packaged references.

Target naming is `MechaGremlin` for the plugin, `Gremlin` for the skill and
`gremlin.exe` for the persona.

`USER_CONTEXT.md` is a point-in-time user snapshot, not product knowledge.
Before the replacement is considered finished, remove it from plugin references
after retaining any still-useful durable facts in the appropriate memory store.
Do not publish its contents in this repository.

## MCP parity

The old web Action schema exposed 30 main GitHub-OAuth operations. The legacy
Builder surface in the repository deliberately used 29 of those operations plus
the separately authenticated Anchor `useGremlinStorage` action because the GPT
Action limit was 30.

The plugin MCP is not constrained by that Builder split. Its canonical
`PLUGIN_MCP_OPERATION_IDS` restores the 30-operation web surface by combining
the 29 curated GitHub-OAuth operations with `getDocsIndex`. The MCP tool
descriptors are generated from the maintained OpenAPI schemas, and tool calls
dispatch back through the existing guarded Action routes instead of copying
operator policy into a second implementation.

The portable plugin points at:

`https://gremlin.travny.workers.dev/mcp`

The separately authenticated Anchor `useGremlinStorage` operation is not part
of that MCP surface and remains a distinct migration decision.

## Preserved runtime boundaries

- Gremlin owns the user-facing operator surface and standalone public Worker.
- Existing high-level GitHub, Cloudflare, release, workflow, maintenance and
  specialist handlers remain authoritative behind the MCP adapter.
- GPTomek attribution, stale-state checks, replay guards and mutation policy are
  preserved because MCP calls enter those same handlers.
- Engram, Feedseek and Context7 continue through their existing specialist
  implementations.
- Shared Durable Objects and the GPTomek signing RPC remain deliberate
  cross-service dependencies while Gremlin-only modules are moved out of
  `kanarek-companion`.

## Still required

- Register/connect the standalone Gremlin MCP with the migrated private plugin.
- Rename the migrated skill from `MechaGrepmlin` to `Gremlin` while keeping
  the plugin display name `MechaGremlin`.
- Remove `USER_CONTEXT.md` from migrated references after memory cleanup.
- Decide how Anchor OAuth storage is represented without copying credentials or
  weakening its current authorization boundary.
- Run behavioral and tool parity checks against the read-only legacy GPT.
- Finish moving Gremlin-only modules out of `kanarek-companion` when doing so
  reduces coupling without duplicating shared state or policy.

## Acceptance gates

1. The standalone Gremlin MCP advertises the expected 30 operation names,
   including `getDocsIndex`.
2. MCP authentication fails closed before tool execution.
3. Representative read and write tools reach the existing guarded Action
   handlers with OAuth identity preserved.
4. Repository reads, context/investigation, guarded writes, Cloudflare reads and
   mutations, specialists, release/workflow operations, and failure paths pass
   smoke tests.
5. GPTomek-authored writes still use the existing bridge and final-side-effect
   verification.
6. No plugin file contains secrets, duplicated backend policy or stale personal
   context.
7. The migrated skill follows the intended Gremlin behavior and uses the
   installed meme references when appropriate.
8. Keep the original GPT as a read-only behavioral fallback until these checks
   pass.
9. Only then treat the migrated plugin as the maintained successor.
