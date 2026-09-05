# Testing Patterns

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Test Stack and Commands

- Primary test stack is deliberately mixed: Node's native `node:test`/`node:assert` for Kanarek and weather; direct Node assertion scripts for the Benches; Gradle build validation for Xiaomi.
- `tsx` runs TypeScript weather tests without a separate test framework (`twojstar/twojstar/weather-feed/package.json`).
- Kanarek's `npm run check` combines TypeScript, native Node tests, syntax checks and Wrangler dry-run; its CI also performs a live production smoke after main pushes.

```bash
cd gh-apps/kanarek-companion && npm run check
cd weather-feed && npm run check
cd benches && npm ci && npm run check
cd mcp/status-mcp && npm run typecheck
# Xiaomi: CI runs ./gradlew jar; agent instructions prohibit local Gradle execution.
```

There is no root `test`/`check` command and no repo-wide test runner.

## 2) Test Layout

- Kanarek: `gh-apps/kanarek-companion/test/*.test.ts`, using native Node tests and explicit network/runtime fakes.
- Weather: `twojstar/twojstar/weather-feed/test/*.test.ts`, using native Node tests via `tsx`.
- Docbench: `twojstar/twojstar/benches/docbench/tests/*.test.mjs` plus focused check scripts; many tests execute assertions directly rather than registering runner cases.
- Codebench and Streambench: focused invariant scripts under `scripts/`, commonly named `*-check.mjs`.
- No shared repo-level setup/fixture package was found.

## 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | yes | normalization, parsing, state, policy helpers, PDF operations | Strongest in Kanarek/weather/Docbench |
| Integration | yes | Worker routing, external API adapters, storage/checkpoint behavior | Mostly isolated with fetch/KV/DO fakes |
| E2E | partial | Kanarek live gateway smoke; Wrangler deployment dry-runs | No browser automation suite found |

status-mcp has no behavior test script; its CI currently runs TypeScript only. Xiaomi ADB Tools has build CI but no test source was found.

## 4) Mocking and Isolation Strategy

- External HTTP is commonly isolated by replacing/stubbing `fetch`; Streambench and Kanarek tests restore global state after use.
- Kanarek tests model KV and Durable Objects with in-memory fakes to exercise serialization, replay and idempotency without live writes.
- Docbench PDF tests construct real in-memory PDF documents and use targeted fakes only at boundaries such as PDF.js destinations.
- Weather tests prefer pure inputs/outputs for warning reconciliation, timezone handling and Atom generation.
- Common risk: custom check scripts are project-specific, so new behavior is easy to omit from CI unless the package `check` script is updated.

## 5) Coverage and Quality Signals

- Coverage tool + threshold: none configured; repository policy uses targeted/project checks plus final CI rather than a numeric coverage gate.
- Current reported coverage: none; no repository-level percentage is treated as a release criterion.
- Quality gates include strict TypeScript, package-specific checks, Wrangler dry-runs, MegaLinter and Kanarek's live smoke.
- Known gaps: status-mcp behavior/auth paths, Xiaomi device-command behavior, and browser-level E2E interactions are not covered by discovered automated suites.

## 6) Evidence

- `gh-apps/kanarek-companion/package.json`, `gh-apps/kanarek-companion/test/webhook.test.ts`, `gh-apps/kanarek-companion/test/cloudflare-actions.test.ts`
- `twojstar/twojstar/weather-feed/package.json`, `twojstar/twojstar/weather-feed/test/weather.test.ts`
- `twojstar/twojstar/benches/docbench/package.json`, `twojstar/twojstar/benches/docbench/tests/pdf-core.test.mjs`
- `twojstar/twojstar/benches/codebench/scripts/privacy-check.mjs`, `twojstar/twojstar/benches/streambench/scripts/relay-core-check.mjs`
- `.github/workflows/kanarek-companion-ci.yml`, `.github/workflows/weather-ci.yml`, `.github/workflows/status-mcp-ci.yml`
- `.github/workflows/benches-release.yml`, `.github/workflows/xiaomi-adb-tools-ci.yml`
