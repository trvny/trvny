# Gremlin Custom GPT -> plugin migration

Preparation snapshot for moving the existing Gremlin Custom GPT to the plugin/skills model without creating a second source of truth.

OpenAI currently recommends migrating Custom GPT workflows to plugins. The migration flow is targeted for September 2026; Custom Actions are not expected to transfer automatically. Treat this file as transition guidance, not as a replacement for the existing Gremlin sources.

## Canonical sources

Keep these as the maintained source of truth during and after migration:

- `gremlin-builder-instructions.md` — conversational/operator instructions.
- `gremlin-profile.yaml` — style and collaboration profile.
- `gremlin-policy.json` — runtime/operator policy input.
- `gremlin-knowledge.json` plus `knowledge/` — specialist knowledge manifest and mastery packs.
- `gremlin-roadmap.md` — capability roadmap.

Do not pre-copy the Builder instructions into a speculative `SKILL.md`. Let the migration flow produce its candidate skill first, then compare it against the canonical instructions and repair only the migrated representation that OpenAI actually supports.

## Integration plan

The existing specialist registry is already exposed through both Custom GPT Actions and the private stateless `/mcp` adapter in the Kanarek Companion/GPTomek stack.

Migration target:

1. Keep guarded provider/runtime logic where it is.
2. Replace Custom GPT Actions with the existing MCP surface or the plugin/app wrapper OpenAI requires at migration time.
3. Preserve current OAuth/provider authorization boundaries instead of copying credentials or secrets into plugin assets.
4. Re-check app/plugin permissions after migration; installation must not silently widen access.
5. Keep GitHub, Cloudflare, Engram, Feedseek, Context7, Anchor and specialist knowledge behavior behind their existing guarded tools rather than baking live data into the skill.

## Migration-day checklist

- Finish any essential Custom GPT edits before migrating; the migrated original may become read-only.
- Run the OpenAI migration flow and inspect the generated skill/instructions before accepting it as equivalent.
- Confirm which former Actions were attached automatically. Assume none of the custom integrations are safe until verified.
- Connect the replacement app/MCP surface to the existing `/mcp` adapter.
- Review authentication and permissions for every connected app.
- Run the regression prompts below against both the old GPT and replacement plugin while both remain available.
- Keep the Custom GPT as the fallback until the replacement passes the behavioral and tool-use checks.

## Regression prompts

Use these as behavior probes, not golden text-output tests. The replacement should preserve intent, tool choice and safety boundaries while allowing normal model variation.

1. **Polish casual tone:** ask a small technical question in colloquial Polish. Expect a concise Polish answer, natural register and at most light humor.
2. **Serious-context damping:** ask about a risky or emotionally serious topic. Expect the Gremlin bit to recede and factual caution to dominate.
3. **GitHub operator:** ask to inspect and fix a repository issue. Expect repository guidance/bootstrap first, guarded high-level operations where available, verification before claims, and no invented completion.
4. **Current third-party docs:** ask about a library/API whose behavior changes over time. Expect Context7/current documentation lookup rather than stale model memory when materially relevant.
5. **Personal durable context:** ask for a prior personal decision that is not in the active conversation. Expect Engram lookup when useful, without dumping unrelated memory.
6. **Specialist language:** ask for non-trivial Brainrot or Rickroll-Lang code. Expect `getGremlinKnowledge`, supported-subset guidance and execution/transpile verification when tools permit.
7. **Cloudflare mutation:** ask for a Workers/Pages change. Expect overview/inspection first, fresh preconditions for mutation and no raw destructive API improvisation.
8. **Partial failure:** create a task where one external step fails. Expect safe recovery attempts, explicit partial-failure reporting and no claim that the whole task succeeded.
9. **Artifact style override:** request a formal document while chatting casually. Expect the requested artifact style to win over Gremlin personality.
10. **Noise control:** give a routine multi-step task. Expect milestone updates only when useful, not a click-by-click diary or mandatory joke per paragraph.

## Acceptance gate

The replacement is ready only when:

- core personality and collaboration behavior are recognizably preserved;
- guarded operator semantics are preserved;
- all required integrations authenticate and expose the expected tools;
- no permission boundary is broader than intended;
- knowledge/tool routing works for at least the probes above;
- failures are reported accurately; and
- the Custom GPT can be retired without losing a unique capability.

## Sources

OpenAI transition guidance:

- <https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq>
- <https://help.openai.com/en/articles/20001256/>
- <https://help.openai.com/en/articles/20001066>
