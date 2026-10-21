# AGENTS.md

One **shared Cloudflare Worker runtime**. `kanarek-companion` is its
deployment/package slug, not every subsystem's name.

- **Kanarek Companion** owns webhook-driven PR status, quips/reactions, review
  queueing/context and publication. Shared free-provider routing runs in private
  `kanarek-review` Worker behind a Service Binding.
- **GPTomek Bridge** owns `gptomek[bot]` identity, installation auth, control transport and GPTomek-attributed writes.
- Before changing GPTomek transport, read `../gptomek/docs/REFERENCE.md`; it owns the current control/fallback identifiers. Preserve command IDs across retries/failover, checkpoint/result-envelope semantics and fallback anchors. Never invent a parallel transport or treat fallback state as cleanup debris.
- **Gremlin** owns guarded GPT Actions, coding, maintenance, workflow, release and policy orchestration.
- **Specialist Intelligence** owns bounded domain lookups, e.g. packages, docs and Engram; start new artifact/feed/web inspection here.
- **Shared runtime core** owns only reusable auth, transport, safety, OpenAPI and Durable Object plumbing.
- `runtime.ts` is the composition root (ordered route segments; see `docs/architecture.md`); domain logic belongs in its subsystem and is only wired into a route table.
- `src/` layout: root = composition + shared core; domain code in `companion/`, `gptomek/`, `operator/`, `investigation/`, `specialists/`. No runtime import cycles (`test/import-cycles.test.ts`).
- Shared Worker does not make every feature a Kanarek feature. Use subsystem names above in code, docs, PRs and logs.
- Split subsystem into another Worker only for materially different permissions/secrets, exposure, resource limits, deploy cadence or independent consumers.
- Never log or persist private keys, OAuth bearer tokens or other credentials.
- Keep mutation paths guarded against stale state, replay and duplicate side effects.
- Prefer existing high-level guarded actions over new raw mutation endpoints.
- GitHub access from modules: take a `GithubGateway` param (`github-gateway.ts`), never a synthetic `/gpt-actions/github/read|graphql` request through `below`.
  GPTomek `operator_action` must reuse GPT Actions bot-write policy; no parallel allowlist.
- Inside `try`/`catch`, `return await handler(...)`; a bare returned promise rejects past the `catch` (500 `worker_exception` instead of the error envelope). Exception: a call that itself persists state the `catch` would overwrite (code-change `pause`/`complete`).
- Run `npm run check` before code changes are complete.
