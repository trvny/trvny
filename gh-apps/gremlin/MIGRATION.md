# MechaGremlin migration parity

> Repository-only migration and acceptance documentation. Not bundled into the runtime skill.

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

The built-in migration initially produced a private plugin with one generated
skill, no Custom Action replacement, the copied knowledge references, and a
migration-generated version line.

On 2026-10-06 the existing private successor was updated **in place** rather
than replaced:

- backend plugin ID: `plugin_2efcd1a24fa08191b71d92f1972ac32c`;
- release: `0.31.2`;
- display name: `MechaGremlin`;
- effective skill name: `Gremlin` / `gremlin` frontmatter;
- root Agent Plugins 1.0 manifest added;
- portable Gremlin MCP configured at
  `https://gremlin.travny.workers.dev/mcp`;
- the host generated the matching legacy `.mcp.json` compatibility config.

The account plugin editor now supports explicit file deletion during release
updates. The legacy `USER_CONTEXT.md`, redundant `AGENTS.md` alias and duplicate
`GREMLIN_STYLE.md` have all been physically removed from the live plugin.
The account bundle keeps the migration-era `skills/instructions/` directory,
while the repository uses `skills/gremlin/` as its single portable skill layout.
The only retained style file is `references/gremlin-style.md`, and
`agents/openai.yaml` contains UI metadata, not behavior duplication.

The repository package is synchronized with the existing private plugin
release `0.31.10` (Gremlin's reduced 32-tool MCP; Anchor is an independent
ChatGPT app and not a bundled dependency).
The working MCP App binding, skill metadata, knowledge index and original PNG
logo are synchronized in the portable source.

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

The standalone Gremlin MCP exposes four direct specialists:

- `context7_search`
- `feedseek_search`
- `feedseek_fetch`
- `feedseek_recent`

Together with 28 guarded operators, the expected surface is **32 tools**.
Two legacy operator actions (`searchEngramMemory`, `storeEngramMemory`) and
three direct Engram specialist tools were removed only from Gremlin's surface.
They targeted `api.engrammemory.ai`, not the user's `getengram.app` account.
The shared Kanarek/legacy implementation remains unchanged to avoid breaking
other consumers, and this removal does not alter the separate ChatGPT Engram
OAuth connection. Context7 and Feedseek were verified live.

The getengram.app dashboard/API-key problems (get-engram/engram#471 and #401)
remain external; no token rotation or fake compatibility bridge is warranted.

### Anchor storage

`useGremlinStorage` is separately authenticated with Anchor OAuth and is not
counted in the 32-tool Gremlin MCP surface. The live Anchor workspace already
contains the canonical `Gremlin Storage` area for durable Gremlin artifacts.

Preserve this authorization boundary. Release `0.31.8` briefly referenced
the user's existing Anchor app as an optional dependency, but that reference
was removed in `0.31.9` to avoid an unnecessary app-within-app dependency.
Anchor remains independently connected in ChatGPT using its own OAuth and
existing `Gremlin_storage` folder; no Anchor data or account connection was
deleted. The host-generated Gremlin alias `connector` and the portable
source alias `gremlin` still point to the same unchanged Gremlin MCP App ID.
No Anchor OAuth credentials may be proxied or copied into Gremlin.

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

## Connected-app routing and overlap audit (2026-10-22)

The canonical selection rule lives in `plugin/skills/gremlin/SKILL.md`. This audit records the existing capability overlap; it **does not** retire MCP tools, alter OAuth or migrate backend state.

| Surface | Prefer in current ChatGPT | Why the Gremlin surface stays for now |
| --- | --- | --- |
| `githubRead`, `getDoc`, `getDocsIndex`, `searchDocs` | Connected GitHub for ordinary file/repo reads | Legacy GPT and MCP consumers still use these; `searchDocs` also supports curated `llms.txt` sites. |
| `context7_search` / `searchContext7Docs` | Connected Context7 for library docs | Two entrypoints share specialist implementation; legacy clients still use the bridge. |
| `getCloudflareOverview` | Connected Cloudflare for routine account/resource operations | Gremlin provides safe operator inventory. The advertised 32-tool MCP contains the overview, **not** every guarded Cloudflare mutation in the runtime; check live tool availability before acting. |
| `implementCodeChange`, `finalizePullRequest`, `orchestrateRelease`, maintenance/CI helpers | Gremlin for governed multi-step operations | GPTomek attribution, exact-state checks, resumability and final-head gates are not equivalent to raw provider calls. |
| Feedseek and Gremlin knowledge/package intelligence | Gremlin | Specialist behavior has no verified direct replacement in this setup. |
| Engram and Anchor | Separately connected Engram and Anchor apps | Their bridges are absent from the current Gremlin MCP; do not reintroduce proxy credentials or copy personal data. |

Verified repository consumers/guards include `gh-apps/kanarek-companion/src/custom-gpt-surface.ts`, `src/runtime-openapi.ts`, `src/tools/registry.ts` (under that same app), `gh-apps/gremlin/test/index.test.ts` and `gh-apps/kanarek-companion/test/operator-mcp-adapter.test.ts`. The 32-tool compatibility tests, legacy Builder instructions and independently authenticated connections remain in place. Remove a candidate adapter only after inspecting callers, proving feature/auth parity and migrating its legacy consumers.

The operator bootstrap's `preferredActions` previously named `searchEngramMemory` and `useGremlinStorage` despite their absence from the plugin MCP. Those stale preferences are removed without deleting legacy routes or independent app access.

## Preserved runtime boundaries

- Gremlin owns the user-facing operator surface and standalone public Worker.
- Existing high-level GitHub, Cloudflare, release, workflow, maintenance and
  specialist handlers remain authoritative behind the MCP adapter.
- GPTomek attribution, stale-state checks, replay guards and mutation policy are
  preserved because MCP calls enter those same handlers.
- Context7 and Feedseek retain their existing specialist implementations;
  the unrelated Engram adapter is not in the Gremlin MCP or Actions surface.
- Anchor remains a separately authenticated storage capability.
- Shared Durable Objects and the GPTomek signing RPC remain deliberate
  cross-service dependencies while Gremlin-only modules are moved out of
  `kanarek-companion`.

## Still required

- ChatGPT OAuth connection, the original 37-tool inventory and a reversible GPTomek-authored
  GitHub issue-comment mutation were verified live on 2026-10-17.
- Context7 and Feedseek returned live results through the Gremlin MCP after
  merged PR #1054. The unrelated Engram adapter has since been excluded from
  the Gremlin MCP; live OAuth refresh/revocation and legacy GPT behavior parity
  remain open.
- [x] Anchor briefly bundled as optional in `0.31.8`, then intentionally
  unbundled in `0.31.9` after confirming that it is already an independently
  connected ChatGPT app. No duplicated Anchor tool surface is required.
- [x] The existing Anchor `Gremlin_storage` folder remains accessible through
  the separate Anchor connection; no plugin-level Anchor parity gate remains.
- Run behavioral and tool parity checks against the read-only legacy GPT.
- Finish moving Gremlin-only modules out of `kanarek-companion` when doing so
  reduces coupling without duplicating shared state or policy.

## Acceptance gates

1. The standalone Gremlin MCP advertises exactly **32 names**: 28 operator
   operations including `getDocsIndex`, plus four Context7/Feedseek specialists;
   no removed Engram tool remains callable.
2. MCP authentication fails closed before tool execution.
3. Representative read and write tools reach the existing guarded Action
   handlers with OAuth identity preserved.
4. Repository reads, context/investigation, guarded writes, Cloudflare reads and
   mutations, representative Context7 and Feedseek reads, release/workflow
   operations and failure paths pass smoke tests. No wrong-provider Engram
   endpoint is exposed by the Gremlin Worker.
5. GPTomek-authored writes still use the existing bridge and final-side-effect
   verification.
6. No plugin file contains secrets, duplicated backend policy or stale personal
   context.
7. The migrated skill follows the intended Gremlin behavior and uses the
   packaged meme references when appropriate.
8. Gremlin workflows do not require or direct calls to the independent Anchor
   plugin. Anchor's own OAuth and files remain unchanged.
9. Keep the original GPT as a read-only behavioral fallback until these checks
   pass.
10. Only then treat the migrated plugin as the maintained successor.

## Latest account state (2026-10-18)

Release `0.31.10` retains one Gremlin skill, one original PNG logo, one
OAuth-connected Gremlin App (`.app.json`) and an unchanged Gremlin MCP
endpoint. The Anchor app is intentionally not bundled.
The migrated account package uses a technical generated package ID, while the
portable repository keeps the stable `mechagremlin` package name. The package
identity and installed app binding are not credentials. Never create a second
plugin or copy a live user-context snapshot to reconcile the layouts.
