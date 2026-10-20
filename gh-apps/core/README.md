# gh-apps/core

Dependency-free modules shared by more than one Worker in `gh-apps/`.
Imported by relative path; no package, no build. Each consumer typechecks,
tests and bundles them as part of its own `npm run check`.

| Module | Used by |
|---|---|
| `github-app.ts` | kanarek-companion, claudiusz (gremlin via companion runtime) |
| `auth.ts` | kanarek-companion, kanarek-review |
| `review-service-protocol.ts` | kanarek-companion, kanarek-review |
| `review-cooldown-store.ts` | kanarek-companion (Durable Object), kanarek-review tests |
| `worker-deploy.mjs` | Workers Builds deploy scripts: kanarek-companion, shitpost-reactor (deploys only the newest `main` commit for its watch paths; upload → fence → activate → verify → triggers; rollback by version id; tests in `kanarek-companion/test/worker-deploy.test.ts`) |
| `deploy-lock.mjs` | Lease lock in D1 `deploy-locks` (table `locks`, 15 min TTL) held by `worker-deploy.mjs` and the kanarek-companion credential sync; CLI `acquire|release <worker> <owner>`. Build and Actions Cloudflare tokens need D1 Edit. |

Rules:

- Only code needed by two or more Workers lands here; single-app code stays in
  that app.
- No imports from any app directory and no npm dependencies. Ambient
  `cloudflare:workers` types come from the consumer's tsconfig.
- Changes here rebuild every consumer: CI path filters and Workers Builds watch
  paths include `gh-apps/core/**`.
