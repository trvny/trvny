# AGENTS.md

This directory is one **shared Cloudflare Worker runtime**. `kanarek-companion`
is its deployment/package slug, not the name of every subsystem inside it.

- **Kanarek Companion** owns webhook-driven PR status, quips/reactions and free PR review.
- **GPTomek Bridge** owns bot identity, installation auth, control transport and bot-authored writes.
- **Gremlin Operator** owns guarded GPT Actions, coding, maintenance, workflow, release and policy orchestration.
- **Specialist Intelligence** owns bounded domain lookups such as packages, docs and Engram; new artifact/feed/web inspection starts here.
- **Shared runtime core** owns reusable auth, transport, safety, OpenAPI and Durable Object plumbing only.
- Keep `entry.ts` and `router.ts` as composition roots; put domain logic in the owning subsystem.
- Sharing this Worker does not make a feature a Kanarek feature. Use the subsystem names above in code, docs, PRs and logs.
- Split a subsystem into another Worker only for materially different permissions/secrets, exposure, resource limits, deploy cadence or independent consumers.
- Never log or persist private keys, OAuth bearer tokens or other credentials.
- Keep mutation paths guarded against stale state, replay and duplicate side effects.
- Prefer existing high-level guarded actions over new raw mutation endpoints.
- Run `npm run check` before considering code changes complete.
