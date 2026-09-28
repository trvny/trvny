# MechaGremlin migration parity

This is a category-level migration checklist, not a copied list of API
operations. The live Gremlin capability manifest and Custom GPT OpenAPI remain
the source of truth for exact operation names and schemas.

## Already reusable

- Custom GPT instructions and knowledge: handled by ChatGPT's GPT-to-plugin
  migration flow, not copied into this repository.
- Specialist MCP transport: the shared runtime already exposes an authenticated
  stateless MCP at `/mcp`.
- Specialist backend logic: Engram, Feedseek, and Context7 stay in the existing
  Specialist Intelligence subsystem.
- Gremlin Operator remains the owner package while its maintained core is
  imported from `kanarek-companion`.

## Still required before retiring the GPT

- Expose guarded GitHub read/context/investigation capabilities through MCP.
- Expose the existing high-level guarded mutation workflows through MCP without
  adding a second write allowlist.
- Preserve GPTomek attribution for bot-authored GitHub writes.
- Expose the required Cloudflare inspection and guarded mutation capabilities.
- Decide how Anchor OAuth storage is represented in the plugin without copying
  credentials or weakening its current authorization boundary.
- Cover release, workflow, maintenance, package/docs, and other live Operator
  capability categories that the migrated GPT still depends on.

## Acceptance gates

1. Compare the migrated plugin against the live Custom GPT OpenAPI/capability
   manifest and account for every required capability.
2. Verify OAuth and identity checks with positive and negative tests.
3. Smoke-test repository reads, repository context, investigation, guarded
   writes, Cloudflare reads, specialist MCP tools, and cancellation/error paths.
4. Confirm no plugin file contains a secret or duplicated backend policy.
5. Confirm GPTomek-authored writes still use the existing bridge.
6. Keep the original GPT untouched until the plugin passes parity checks.
7. Only then use the ChatGPT migration flow and treat the migrated plugin as the
   editable successor.
