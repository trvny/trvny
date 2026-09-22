# AGENTS.md

One **shared Cloudflare Worker runtime**. `kanarek-companion` is its
deployment/package slug, not every subsystem's name.

- **Kanarek Companion** owns webhook-driven PR status, quips/reactions, review
  queueing/context and publication. Shared free-provider routing runs in private
  `kanarek-review` Worker behind a Service Binding.
- **GPTomek Bridge** owns `gptomek[bot]` identity, installation auth, control transport and GPTomek-attributed writes.
- Before changing GPTomek transport, read `../gptomek/README.md`. Default: Issue
  `trvny/trvny#203`. Keep closed PR `#176` plus `gptomek/control` as independent
  transport fallback exposing the same GPTomek operations. Issue relay may invoke
  it automatically after failed primary Worker wake. Keep command IDs across
  retries/failover. Never bypass checkpoint/result-envelope contract or casually
  clean up fallback PR/ref.
- **Gremlin Operator** owns guarded GPT Actions, coding, maintenance, workflow, release and policy orchestration.
- **Specialist Intelligence** owns bounded domain lookups, e.g. packages, docs and Engram; start new artifact/feed/web inspection here.
- **Shared runtime core** owns only reusable auth, transport, safety, OpenAPI and Durable Object plumbing.
- Keep `entry.ts` and `router.ts` as composition roots; domain logic belongs in its subsystem.
- Shared Worker does not make every feature a Kanarek feature. Use subsystem names above in code, docs, PRs and logs.
- Split subsystem into another Worker only for materially different permissions/secrets, exposure, resource limits, deploy cadence or independent consumers.
- Never log or persist private keys, OAuth bearer tokens or other credentials.
- Keep mutation paths guarded against stale state, replay and duplicate side effects.
- Prefer existing high-level guarded actions over new raw mutation endpoints.
  GPTomek `operator_action` must reuse GPT Actions bot-write policy; no parallel allowlist.
- Run `npm run check` before code changes are complete.
