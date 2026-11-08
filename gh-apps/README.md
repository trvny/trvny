# GitHub Apps

[![Shared CI](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://developers.cloudflare.com/workers/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

GitHub App integrations and Workers. **`gh-apps/core/` is the only shared-code layer**; never import another app's `src/`.

| Component | Responsibility | Runtime / entry |
| --- | --- | --- |
| [Automation](kanarek-companion/) | Shared runtime: Kanarek Companion, GPTomek, Gremlin, specialists | `kanarek-companion/src/runtime-entry.ts` (Worker/RPC entry), `src/runtime.ts` (HTTP routing); deployed as `automation` |
| [Kanarek Review](kanarek-review/) | Private provider routing, free/paid fallback, cooldowns | Separate Worker, called via Service Binding |
| [GPTomek](gptomek/) | GitHub App identity and guarded write bridge | Shared Automation Worker; [operator guide](gptomek/README.md) |
| [Claudiusz](claudiusz/) | Claude GitHub comments, reviews and reactions | `claudiusz-mcp` Worker / Manufact adapter |
| [Gremlin](gremlin/) | Guarded actions and MCP operator | `gremlin` Worker; reuses Automation runtime |
| [Shitpost Reactor](shitpost-reactor/) | Generate and publish posts | Scheduled Worker + publisher workflow |
| [Core](core/) | Shared auth, protocol and deploy helpers | Relative imports; no package/build |

## Work here

- **CI:** [GitHub Apps CI](../.github/workflows/gh-apps-ci.yml) checks affected app directories and shared core. A green shared badge is not a per-app release signal.
- **Commands:** run `npm ci && npm run check` in the affected app's directory. GPTomek has no npm package: validate its shared runtime from `gh-apps/kanarek-companion/`. See component READMEs for deploy requirements.
- **Invariants:** one shared Worker runtime, one shared core; secrets in Worker configuration, never in Git. [Architecture](kanarek-companion/docs/architecture.md) owns route/state boundaries; [GPTomek reference](gptomek/docs/REFERENCE.md) owns its transport contract.
