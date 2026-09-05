# Testing Patterns

There is no root test runner. Validation follows component boundaries.

## Commands

```bash
(cd gh-apps/kanarek-companion && npm ci && npm run check)
(cd mcp/status-mcp && npm ci && npm run typecheck)
(cd mcp/pet-dispatcher && npm ci && npm run check)
```

## Coverage by component

- **Kanarek Companion:** strict TypeScript, Node tests, script syntax checks, Wrangler dry-run, then a live production smoke on pushes to `main`.
- **Pet Dispatcher:** strict TypeScript plus `tsx --test` suites for path confinement, networking, sandbox integration, MCP, Git, providers, hardening, remote transport and direct sessions; `control:check` also validates the Worker bundle.
- **status-mcp:** strict TypeScript only in CI today; no behavior test suite is configured.
- **Remotely Save patch:** workflow downloads the latest upstream `main.js`, applies the patch, builds a standalone test class and runs fake-Drive checks. It publishes nothing.
- **Quarto report:** CI renders `stuff/other/token-worldcup.qmd` and fails if committed HTML differs.
- **Repository docs/config:** MegaLinter checks changed files; a full sweep is manual via `workflow_dispatch`.

## Test style

- Prefer Node's built-in test/assert APIs and small hand-written fakes over a heavy mocking layer.
- Keep external network and Cloudflare state behind explicit test doubles where practical.
- Add new checks to the owning package/workflow rather than creating a root orchestration layer.
- There is no repository-wide coverage percentage requirement.
