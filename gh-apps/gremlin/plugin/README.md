# MechaGremlin plugin

This directory is the maintained portable plugin source for the migrated
MechaGremlin workflow and is owned by the Gremlin package.

It does **not** duplicate operator logic. The deployed `gremlin` Worker still
reuses the maintained action runtime while the Gremlin-only modules are being
moved out of `kanarek-companion`.

The portable package connects to the authenticated Streamable HTTP MCP at
`https://gremlin.travny.workers.dev/mcp`. The MCP exposes a compatibility
superset: the migrated 30-operation Gremlin web surface, including
`getDocsIndex`, plus seven direct specialist tools for Engram, Context7 and
Feedseek. Operator calls dispatch through the existing guarded Action handlers,
so policy, stale-state checks, GPTomek attribution, replay protection and
Cloudflare guards stay authoritative.

`skills/gremlin/` is the canonical packaged behavior. It preserves the Gremlin
persona and maintained meme/style references without carrying the migrated
`USER_CONTEXT.md` snapshot.

Anchor storage remains a separately authenticated capability. Do not proxy its
OAuth through the Gremlin Worker or invent a registered App ID. Add it to the
private plugin only after the actual OpenAI App identity is verified.

The built-in ChatGPT migration created the private successor plugin, and that
same plugin was updated in place to release `0.31.2` on 2026-10-06. The live
account bundle keeps the migration-era `skills/instructions/` path only because
the account editor cannot delete existing files; its effective skill is
`Gremlin`, its stale user-context file is a data-free tombstone, and its
package now includes the standalone Gremlin MCP.

Do not create a second production plugin from this repository. This directory
remains the canonical portable source for future updates.

Migration status and acceptance gates live in
`skills/gremlin/references/migration.md`.

No credentials, OAuth tokens, private keys or copied user-context files belong
in this directory.
