# Architecture

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Architectural Style

- Primary style: a collection of independently deployed applications/services, mostly feature-oriented, sharing repository-level CI and policy rather than a shared runtime.
- The three Benches pair browser-heavy applications with thin Cloudflare Worker shells. Weather and Status MCP are edge services. Kanarek Companion is an event-driven GitHub App plus a guarded operator gateway. Xiaomi is a standalone JavaFX desktop application.
- Primary constraints are local-first browser processing for document/QR tools, Cloudflare Worker limits/bindings for edge services, and fail-closed/expected-state guards for privileged GPTomek operations.

## 2) System Flow

```text
Codebench: request -> Worker metadata/security wrapper -> static app -> local QR/barcode logic -> browser output
Docbench: request -> security-header Worker -> static app -> local file/PDF engines -> browser save/download
Streambench: request -> entry router -> signed/media/provider handlers -> validated external stream/provider -> browser playback
Weather: cron -> parallel source adapters -> normalization/ensemble -> KV baselines/state -> Atom/JSON/HTML responses
Status MCP: authenticated JSON-RPC -> project fan-out -> service bindings/GitHub reads -> compact verdict -> cached result
Kanarek: GitHub webhook/GPT action -> runtime/router -> policy/guarded capability -> GitHub/Cloudflare/AI integration -> response/comment
Xiaomi: Main -> JavaFX controller -> Command coroutine wrapper -> adb/fastboot process -> UI result
```

Representative flows are implemented in the corresponding `src/index.ts`/entry files; Kanarek webhook refreshes are coalesced by `CommentProbeLock` before `refreshCompanion`.

## 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
| --- | --- | --- | --- |
| Bench edge wrappers | headers, static assets, narrow APIs | local document/QR editing state | `twojstar/twojstar/benches/codebench/src/index.ts`, `twojstar/twojstar/benches/docbench/src/index.ts` |
| Streambench providers/relay | provider adapters, URL validation, signed relay | arbitrary open proxy behavior | `twojstar/twojstar/benches/streambench/src/providers/`, `twojstar/twojstar/benches/streambench/src/relay-core.ts` |
| Weather source adapters | external schema parsing/retries | feed state/history | `twojstar/twojstar/weather-feed/src/sources.ts` |
| Weather orchestrator | parallel cycles, KV state, feed endpoints | provider-specific parsing | `twojstar/twojstar/weather-feed/src/index.ts` |
| Status transport | authentication, body limits, short cache | project-specific probe logic | `mcp/status-mcp/src/entry.ts` |
| Status probes | read-only health fan-out | mutations | `mcp/status-mcp/src/index.ts` |
| Kanarek runtime/router | capability dispatch and guards | capability internals | `gh-apps/kanarek-companion/src/runtime-entry.ts`, `src/router.ts` |
| Kanarek feature modules | one operator/review/release/investigation concern | global HTTP routing | `gh-apps/kanarek-companion/src/*-actions.ts` |

## 4) Reused Patterns

| Pattern | Where found | Why it exists |
| --- | --- | --- |
| Thin edge adapter around static/browser logic | Codebench, Docbench, Streambench | Keep sensitive/heavy user processing in the browser while adding headers and narrow edge APIs |
| Provider/adapter normalization | Streambench providers, Weather sources, Kanarek AI providers | Isolate heterogeneous upstream APIs behind stable internal shapes |
| Bounded remote I/O | Streambench relay, Weather fetch helper, Status MCP | Timeouts/body caps/retries prevent an upstream from monopolizing a Worker request |
| Parallel fan-out | Weather and Status MCP | Independent sources/checks complete concurrently |
| Stateful edge coordination | Weather KV; Kanarek KV + Durable Objects | Persist feed baselines and serialize/coalesce webhook/operator work |
| Generated capability surface | Kanarek OpenAPI manifest | Keep Custom GPT capabilities tied to the deployed Worker implementation |

## 5) Known Architectural Risks

- Kanarek/GPTomek is the most complex and privileged subsystem. Several feature modules exceed 900–1600 lines and `src/router.ts` is among the highest-churn files, increasing regression risk when capability routing changes (90-day `git log --name-only` churn and tracked-source line counts).
- There is no root workspace/runtime pin or shared build orchestrator. Package independence limits coupling, but cross-project dependency/toolchain policy can drift (`package.json` absence at root; per-package manifests).
- Docbench keeps substantial hand-maintained application code under `public/`; tooling or maintainers that treat `public/` as generated output could accidentally skip important source (`twojstar/twojstar/benches/docbench/public/pdf-core.mjs`, `twojstar/twojstar/benches/docbench/public/pdf-app.mjs`).

## 6) Evidence

- `twojstar/twojstar/benches/codebench/src/index.ts`, `twojstar/twojstar/benches/docbench/src/index.ts`
- `twojstar/twojstar/benches/streambench/src/entry.ts`, `twojstar/twojstar/benches/streambench/src/index.ts`, `twojstar/twojstar/benches/streambench/src/relay-core.ts`
- `twojstar/twojstar/weather-feed/src/index.ts`, `twojstar/twojstar/weather-feed/src/sources.ts`
- `mcp/status-mcp/src/entry.ts`, `mcp/status-mcp/src/index.ts`
- `gh-apps/kanarek-companion/src/runtime-entry.ts`, `gh-apps/kanarek-companion/src/router.ts`, `gh-apps/kanarek-companion/src/index.ts`
- `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Main.kt`, `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Command.kt`
