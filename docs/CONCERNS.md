# Codebase Concerns

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | Privileged Kanarek/GPTomek behavior is spread across very large, frequently changed modules | `gh-apps/kanarek-companion/src/code-change-orchestration.ts`, `cloudflare-actions.ts`, `router.ts`; 90-day Git history | Guard or routing regressions can affect GitHub/Cloudflare mutations | Keep changes narrow, preserve expected-state/idempotency tests, split only on stable seams |
| medium | status-mcp has auth, token-path handling, caching and multi-service fan-out but no behavior tests | `mcp/status-mcp/src/entry.ts`, `package.json`, `.github/workflows/status-mcp-ci.yml` | Regressions can break the shared health surface or auth boundary | Add focused Node tests for auth, limits, caching and partial upstream failure |
| medium | Non-Bench JS/TS subprojects keep independent validation roots and local Node has no declared support boundary | package manifests, Node 24 CI workflows, PR #265 historical validation | Tool/runtime drift remains possible outside the Bench family | Keep unrelated products independent; declare local Node support if a stable compatibility contract is wanted |
| medium | Dependency-update coverage still omits Xiaomi Gradle | `.github/dependabot.yml`, `twojstar/twojstar/xiaomi-adb-tools/build.gradle` | Gradle dependency/security updates rely on manual discovery | Add a Gradle ecosystem entry as a separate maintenance change |
| low | Documentation has two confirmed stale descriptions | root README status-mcp rows; `twojstar/twojstar/weather-feed/README.md` badge | Project map/status links mislead readers | Correct Weather in status-mcp row and point weather badge at the current workflow |

No meaningful production `TODO`, `FIXME` or `HACK` markers were found by the acquisition scan.

## 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Large orchestration/action modules | Capability growth around one privileged gateway | `gh-apps/kanarek-companion/src/` | Harder reasoning/review | Extract cohesive adapters/policies while keeping action contracts stable |
| Large Docbench PDF/document modules | Browser PDF feature density | `twojstar/twojstar/benches/docbench/public/pdf-core.mjs`, `twojstar/twojstar/benches/docbench/public/pdf-app.mjs`, `document-enhancements.mjs` | Regression coupling | Split pure transformations from UI/orchestration when tests justify it |
| Monolithic legacy controller | Historical JavaFX architecture | `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/MainController.kt` | Device/UI changes stay coupled | Move command/device operations behind smaller services gradually |
| Remaining toolchain duplication outside Benches | Benches now share one npm workspace, while unrelated Workers remain independent | `twojstar/twojstar/benches/package.json`, other project manifests/workflows | Version/check drift can still occur outside the family | Keep the Bench workspace centralized without forcing unrelated products into it |

## 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| status token accepted in URL path for connector compatibility | N/A | `mcp/status-mcp/src/entry.ts`, `wrangler.jsonc` | Bearer form supported; invocation logs disabled; fixed-time comparison | URL tokens can still appear in systems outside Worker invocation logs |
| Stream relay becoming an SSRF/open-proxy surface | A10 SSRF | `twojstar/twojstar/benches/streambench/src/relay-core.ts`, `source-signing.ts` | Scheme/private-host checks, signed provider sources, redirect/time/body limits | Upstream/DNS behavior remains external to the app |
| Kanarek privileged GitHub/Cloudflare mutations | A01 broken access control | `gh-apps/kanarek-companion/src/policy-actions.ts`, `cloudflare-actions.ts`, `router.ts` | Identity/policy checks, expected state, account scoping, checkpoints and tests | Blast radius remains high if multiple guards regress together |
| Third-party weather/AI credentials | N/A | `twojstar/twojstar/weather-feed/src/sources.ts`, `gh-apps/kanarek-companion/src/quip.ts` | Runtime secrets; no secret values found in inspected source | `[TODO]` Rotation/lifecycle policy was not found |

## 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Kanarek Cloudflare inspection can paginate/scan many resources | `gh-apps/kanarek-companion/src/cloudflare-actions.ts` and pagination tests | Correct but request-heavy by design | Larger accounts increase latency/API use | Keep pagination bounded/cached where freshness permits |
| Multi-source remote fan-out | Weather, Status MCP, Kanarek | Intentional parallel I/O | Slow providers dominate tail latency | Preserve per-source timeouts and partial-failure behavior |
| Heavy browser document/PDF modules | `twojstar/twojstar/benches/docbench/public/` | Several modules exceed 1,100 lines | Startup/memory cost on weaker devices may grow | Measure before lazy-loading/splitting; no perf suite exists |
| Stream provider/relay traffic | `twojstar/twojstar/benches/streambench/src/index.ts`, `relay-core.ts` | Bounded per request | Usage amplifies third-party traffic/failure rate | Preserve caches, caps and constrained relay semantics |

## 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `gh-apps/kanarek-companion/src/` | Privileged, stateful orchestration with many integrations | `router.ts`: 28 touches in `git log --since="90 days ago"`; multiple 900–1,620 line modules | Make narrow changes and run full Kanarek `check` |
| Repository docs/policy | They are shared navigation/automation contracts | `README.md`: 102 touches; `AGENTS.md`: 38; MegaLinter config: 30 in the same Git query | Keep language variants/policy references synchronized |
| `twojstar/twojstar/benches/docbench/public/` PDF logic | Complex preservation rules live in browser source | `pdf-core.mjs` 1,497; `document-enhancements.mjs` 1,178; `pdf-app.mjs` 1,167 lines | Add regression assertions before transformations |
| Xiaomi `MainController.kt` | UI and device logic are concentrated | 1,222 lines | Prefer extraction over broad rewrite; validate through CI build |

## 6) `[ASK USER]` Questions

1. `[ASK USER]` Should the supported local Node runtime be declared, and if so should it match CI's Node 24?
2. `[ASK USER]` What automated behavior-testing expectation, if any, should Xiaomi ADB Tools have beyond the current `./gradlew jar` CI build?

The other previous intent questions are resolved by current repository evidence:

- The npm workspace is scoped to the Bench family; PR #352 consolidated Codebench, Docbench and Streambench while current repo guidance keeps unrelated products independent.
- Missing Xiaomi Gradle Dependabot coverage is a concrete maintenance gap; the default remediation is a separate Gradle update entry rather than another architecture decision.
- Repository quality gates are project-specific checks plus final CI, with no numeric coverage gate. status-mcp's missing behavior suite is a concrete testing gap rather than an unknown policy.
- No broad Kanarek, Docbench or Xiaomi rewrite is planned in current repository evidence. Existing guidance favors narrow extraction along stable seams when a concrete change or regression test justifies it.

## 7) Evidence

- Reproducible churn: `git log --since="90 days ago" --name-only --pretty=format:` grouped by path
- Reproducible size check: line counts over tracked `*.ts`, `*.js`, `*.mjs`, `*.kt` production files
- Historical decisions: PR #265 (historical Node 22 validation, no durable support boundary), PR #288 (broad Xiaomi architecture cleanup left out of restoration), PR #296 (targeted test discovery + final CI), PR #352 (Bench-family workspace)
- `mcp/status-mcp/src/entry.ts`, `mcp/status-mcp/src/index.ts`, `.github/workflows/status-mcp-ci.yml`
- `gh-apps/kanarek-companion/src/cloudflare-actions.ts`, `gh-apps/kanarek-companion/src/policy-actions.ts`, `gh-apps/kanarek-companion/src/router.ts`
- `twojstar/twojstar/benches/docbench/public/pdf-core.mjs`, `twojstar/twojstar/benches/streambench/src/relay-core.ts`, `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/MainController.kt`
- `.github/dependabot.yml`, `twojstar/twojstar/weather-feed/README.md`, root `README.md`, `README_pl.md`, `README_zh.md`
