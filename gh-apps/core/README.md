# gh-apps/core

[![Consumer CI](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Dependency-free modules shared by **two or more** Workers under `gh-apps/`. Import relatively; no package, independent build or app-to-app `src/` imports. Each consumer runs its own `npm run check`.

| Module | Consumers / contract |
| --- | --- |
| `github-app.ts` | Automation, Claudiusz; Gremlin through companion runtime |
| `auth.ts` | Companion ↔ Review auth |
| `review-service-protocol.ts` | Companion ↔ Review routing payload |
| `review-cooldown-store.ts` | Companion Durable Object; Review tests |
| `worker-deploy.mjs` | Companion and Reactor Workers Builds: newest-main fence, activation, verification, rollback |
| `deploy-lock.mjs` | Shared D1 `deploy-locks` lease (15 min TTL), used by deploy and credential sync |

## Change rules

- Shared-code changes trigger [consumer CI](../../.github/workflows/gh-apps-ci.yml) and Worker watch paths. Validate affected app(s), not this folder alone.
- Keep single-consumer logic in that app. Cloudflare ambient types come from consumer TypeScript configuration.
- Lock CLI (with dependencies installed): from `gh-apps/kanarek-companion/`, run `node ../core/deploy-lock.mjs acquire <worker> <owner>` or replace `acquire` with `release`. Deploy/sync tokens need D1 Edit.
- Deployment tests: [`kanarek-companion/test/worker-deploy.test.ts`](../kanarek-companion/test/worker-deploy.test.ts).
