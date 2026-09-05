# Coding Conventions

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Naming Rules

| Item | Rule | Example | Evidence |
| --- | --- | --- | --- |
| Files | Web code is mostly kebab-case; Kotlin class files are PascalCase | `source-signing.ts`, `MainController.kt` | `twojstar/twojstar/benches/streambench/src/`, `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/` |
| Functions/methods | camelCase | `fetchOpenMeteo`, `safeRemoteUrl`, `gatewayManifest` | representative source files |
| Types/interfaces | PascalCase | `CycleStatus`, `RpcRequest`, `CompanionTarget` | Weather, Status, Kanarek source |
| Constants/env vars | Constants often `UPPER_SNAKE_CASE`; Worker bindings/secrets are uppercase | `MAX_BODY_BYTES`, `STATUS_MCP_TOKEN` | `mcp/status-mcp/src/entry.ts` |

## 2) Formatting and Linting

- There is no repository-wide Prettier/ESLint configuration. Formatting is maintained by local style plus MegaLinter/document checks.
- `.github/.editorconfig` enforces UTF-8, two spaces and trailing-whitespace cleanup only inside the `.github` tree; it is not a root EditorConfig.
- `.gitattributes` normalizes text to LF by default, with CRLF overrides for Windows script/project formats.
- Kotlin explicitly uses `kotlin.code.style=official` (`twojstar/twojstar/xiaomi-adb-tools/gradle.properties`).
- Worker TypeScript configs use `strict`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, and `forceConsistentCasingInFileNames`. Codebench's client compiler and four Streambench orchestrator modules use `noCheck`, so those client paths do not get equivalent semantic checking.
- Main lint entry: GitHub Actions `MegaLinter`; package-specific validation uses each package's `npm run check` or Gradle build.

## 3) Import and Module Conventions

- Imports are relative; inspected TypeScript configs define no `paths` aliases or barrel requirement.
- Cloudflare Worker modules are ES modules. Kanarek commonly includes `.ts` extensions; other packages often omit extensions in source or use emitted `.js` paths where needed.
- Quote style is package-local rather than repository-global: Kanarek primarily uses single quotes, while Bench/Weather/Status code commonly uses double quotes.
- Feature modules export focused functions/types directly; no repo-wide barrel-export pattern was found.

## 4) Error and Logging Conventions

- HTTP Workers prefer structured responses with stable error codes such as `method_not_allowed`, `provider_unavailable`, or JSON-RPC error objects rather than raw stack traces (`twojstar/twojstar/benches/streambench/src/index.ts`, `mcp/status-mcp/src/entry.ts`).
- Weather treats upstream failure as expected partial degradation: source calls are caught independently, logged, and may fall back to last-good KV state (`twojstar/twojstar/weather-feed/src/index.ts`).
- Kanarek catches operator exceptions at routing boundaries, logs JSON including a request ID, and returns a structured `worker_exception` (`gh-apps/kanarek-companion/src/router.ts`).
- Logging is not unified behind a library. Weather and Kanarek use `console` with structured JSON in important paths; other packages are quieter.
- Sensitive-data handling is capability-specific: Status MCP disables invocation logs because tokens may be in URL paths; Codebench remote-logo fetches omit credentials/referrer; secrets are supplied through Worker env bindings rather than checked-in values.

## 5) Testing Conventions

- Kanarek and Weather use Node's built-in `node:test` plus `node:assert/strict`; Kanarek tests live in `test/*.test.ts`, Weather in `test/**/*.test.ts`.
- Docbench uses standalone assertion scripts in `tests/`; Streambench uses `scripts/*-check.mjs`, several run through `node --test`.
- Network/Cloudflare dependencies are usually isolated with hand-written fetch/env/Durable Object stubs rather than a mocking framework.
- No coverage tool or minimum threshold is configured; the current quality model relies on project-specific checks and CI gates.

## 6) Evidence

- `.gitattributes`, `.github/.editorconfig`, `.github/linters/.mega-linter.yml`
- `twojstar/twojstar/benches/codebench/tsconfig.client.json`, `twojstar/twojstar/benches/streambench/tsconfig.client-orchestrators.json`
- `twojstar/twojstar/weather-feed/src/index.ts`, `mcp/status-mcp/src/entry.ts`
- `gh-apps/kanarek-companion/src/router.ts`, `gh-apps/kanarek-companion/test/webhook.test.ts`
- `twojstar/twojstar/xiaomi-adb-tools/gradle.properties`
