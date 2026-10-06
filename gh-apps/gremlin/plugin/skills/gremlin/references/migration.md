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
- `GREMLIN.md`: Builder instructions;
- `AGENTS.md`;
- `GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`;
- `edgy_dark_meme_formats.json`;
- `USER_CONTEXT.md`.

The maintained package intentionally does **not** copy this archive wholesale.
`GREMLIN.md` is the canonical `Gremlin` skill, the useful style-only portion of
`AGENTS.md` is distilled into `gremlin-style.md`, and the two meme references
are retained. `USER_CONTEXT.md` is excluded because it is a stale personal
snapshot rather than product knowledge.

## Observed migrated plugin

The built-in migration completed successfully and produced a private plugin with:

- one migrated skill displayed as `MechaGrepmlin`;
- no apps, as expected because Custom Actions do not migrate;
- migrated references for `AGENTS.md`,
  `GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`, `edgy-dark-meme-formats.json` and
  `USER_CONTEXT.md`;
- a generated `lookup/knowledge-index.json`.

Target naming is `MechaGremlin` for the plugin, `Gremlin` for the skill and
`gremlin.exe` for the persona.

The repository package now contains the intended replacement skill and reference
set, but that does not by itself modify the already migrated private plugin.
Apply this source to that existing plugin once its editable backend identity is
resolved. Do not create a second production plugin as a workaround.

## Capability parity ledger

A capability is not preserved merely because a similarly named tool exists.
Either the same behavior remains reachable or an explicit replacement must pass
parity tests.

### Operator surface

The old web configuration contains 30 GitHub-OAuth Gremlin operations. The
Builder-facing repository surface deliberately selected 29 of them because the
separately authenticated Anchor action occupied the remaining Custom GPT action
slot. The missing web operation was `getDocsIndex`.

The plugin MCP is not constrained by the Custom GPT action-count limit.
`PLUGIN_MCP_OPERATION_IDS` restores all 30 web operation names. Their schemas
come from the maintained OpenAPI and calls dispatch through the existing
guarded Action routes instead of copying mutation policy.

### Specialist intelligence

The Gremlin runtime also exposes seven direct specialist tools:

- `engram_status`
- `engram_search`
- `engram_store`
- `context7_search`
- `feedseek_search`
- `feedseek_fetch`
- `feedseek_recent`

The standalone Gremlin MCP preserves these alongside the 30 operator tools.
The expected standalone MCP tool count is therefore **37**, with no duplicate
tool names.

### Anchor storage

`useGremlinStorage` is separately authenticated with Anchor OAuth and is not
counted in the 37-tool Gremlin MCP surface. The live Anchor workspace already
contains the canonical `Gremlin Storage` area for durable Gremlin artifacts.

Preserve this authorization boundary. Prefer a connected Anchor app in the
private plugin once the underlying OpenAI App ID is verified. Do not proxy
Anchor through the Gremlin Worker, copy OAuth credentials, or invent an
`asdk_app_*` identifier just to make the manifest look complete.

### Skill, knowledge and persona

The maintained package uses:

- `skills/gremlin/SKILL.md` for the canonical Gremlin behavior;
- `references/gremlin-style.md` for the unique style/intensity guidance;
- `references/GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md`;
- `references/edgy-dark-meme-formats.json`.

`USER_CONTEXT.md` is intentionally absent. Personal context belongs in current
conversation context or an appropriate durable memory system, not frozen plugin
knowledge.

### Runtime guarantees

These are capabilities too, not implementation trivia:

- GitHub bot-authored writes retain GPTomek attribution.
- repository and organization scope checks remain enforced.
- stale-state, replay and duplicate-mutation guards remain enforced.
- Cloudflare reads and guarded mutations retain their existing policy boundary.
- bootstrap, capability discovery and smoke-test workflows remain available.
- operator MCP batches remain serialized so consequential writes do not overlap.
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
- Anchor remains a separately authenticated storage capability.
- Shared Durable Objects and the GPTomek signing RPC remain deliberate
  cross-service dependencies while Gremlin-only modules are moved out of
  `kanarek-companion`.

## Still required

- Apply this maintained package to the existing migrated private plugin and
  rename its skill from `MechaGrepmlin` to `Gremlin`.
- Register/connect the standalone Gremlin MCP with that plugin and verify OAuth.
- Attach Anchor as a separate connected app only after its actual App ID is
  verified, then remove the migrated `USER_CONTEXT.md` reference from the live
  plugin.
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
   packaged meme references when appropriate.
8. Anchor storage parity is explicitly verified; it must not disappear merely
   because the main MCP passes.
9. Keep the original GPT as a read-only behavioral fallback until these checks
   pass.
10. Only then treat the migrated plugin as the maintained successor.
