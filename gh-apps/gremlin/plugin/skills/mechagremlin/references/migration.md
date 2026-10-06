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

## Capability parity ledger

This section is the maintained migration source of truth. A capability is not
considered preserved merely because a similar tool exists; either the same
behavior must remain reachable or an explicit replacement must pass parity
tests.

### Operator surface

The old web configuration contains 30 GitHub-OAuth Gremlin operations. The
Builder-facing repository surface deliberately selected 29 of them because the
separately authenticated Anchor action occupied the remaining Custom GPT action
slot. The missing web operation is `getDocsIndex`.

The plugin MCP is not constrained by the Custom GPT action-count limit.
`PLUGIN_MCP_OPERATION_IDS` therefore restores all 30 web operation names. Their
schemas come from the maintained OpenAPI, and calls dispatch through the
existing guarded Action routes rather than copying mutation policy.

### Specialist intelligence

The pre-migration Gremlin runtime also exposes seven direct specialist tools:

- `engram_status`
- `engram_search`
- `engram_store`
- `context7_search`
- `feedseek_search`
- `feedseek_fetch`
- `feedseek_recent`

The standalone Gremlin MCP preserves these alongside the 30 operator tools.
They continue to use the same bounded Engram, Context7 and Feedseek
implementations. The expected standalone MCP tool count is therefore **37**,
with no duplicate tool names.

### Anchor storage

`useGremlinStorage` is separately authenticated with Anchor OAuth. It is not
silently replaced by a similarly named Gremlin tool and is not counted in the
37-tool MCP surface. The migrated plugin must retain equivalent Anchor access,
either as a connected app or another explicitly verified representation, before
parity can be declared complete.

### Skill, knowledge and persona

The migration produced a private plugin containing the Builder instructions as
a skill and copied the Knowledge references. Preserve the behavioral contract,
the edgy/dark meme knowledge and format reference, and the `gremlin.exe`
persona. Rename the migrated skill from `MechaGrepmlin` to `Gremlin`.

`USER_CONTEXT.md` is not a product capability. It is a stale point-in-time
personal snapshot and must be replaced by appropriate durable memory before it
is removed from the plugin; do not treat deleting it without that handoff as a
successful migration.

### Runtime guarantees

These are capabilities too, not implementation trivia:

- GitHub bot-authored writes retain GPTomek attribution.
- repository and organization scope checks remain enforced;
- stale-state, replay and duplicate-mutation guards remain enforced;
- Cloudflare reads and guarded mutations retain their existing policy boundary;
- bootstrap, capability discovery and smoke-test workflows remain available;
- operator MCP batches remain serialized so consequential writes do not overlap;
- Kanarek-only webhook/review ingress remains outside the Gremlin Worker.

The portable plugin points at
`https://gremlin.travny.workers.dev/mcp`.


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

1. The standalone Gremlin MCP advertises exactly the expected 37 names: all
   30 operator operations including `getDocsIndex`, plus all seven specialist
   tools.
2. MCP authentication fails closed before tool execution.
3. Representative read and write tools reach the existing guarded Action
   handlers with OAuth identity preserved.
4. Repository reads, context/investigation, guarded writes, Cloudflare reads and
   mutations, every specialist tool, release/workflow operations, and failure
   paths pass smoke tests.
5. GPTomek-authored writes still use the existing bridge and final-side-effect
   verification.
6. No plugin file contains secrets, duplicated backend policy or stale personal
   context.
7. The migrated skill follows the intended Gremlin behavior and uses the
   installed meme references when appropriate.
8. Anchor storage parity is explicitly verified; it must not disappear merely
   because the main MCP passes.
9. Keep the original GPT as a read-only behavioral fallback until these checks
   pass.
10. Only then treat the migrated plugin as the maintained successor.
