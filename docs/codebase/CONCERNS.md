# Codebase Concerns

## 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | Privileged Kanarek/GPTomek behavior is spread across very large, frequently changed modules | `gh-apps/kanarek-companion/src/code-change-orchestration.ts`, `cloudflare-actions.ts`, `router.ts`; 90-day Git history | Guard or routing regressions can affect GitHub/Cloudflare mutations | Keep changes narrow, preserve expected-state/idempotency tests, split only on stable seams |
| medium | status-mcp has auth, token-path handling, caching and multi-service fan-out but no behavior tests | `mcp/status-mcp/src/entry.ts`, `package.json`, `.github/workflows/status-mcp-ci.yml` | Regressions can break the shared health surface or auth boundary | Add focused Node tests for auth, limits, caching and partial upstream failure |
| medium | Independent subprojects have no root validation command or local Node runtime pin | root tree, package manifests, Node 24 CI workflows | Tool/runtime drift and repeated setup | Decide whether isolation is intentional; otherwise add a thin root validation/runtime policy |
| medium | Dependency-update coverage omits Docbench npm and Xiaomi Gradle | `.github/dependabot.yml`, `docbench/package.json`, `xiaomi-adb-tools/build.gradle` | Dependency/security updates rely on manual discovery | Add those ecosystems unless omission is intentional |
| low | Documentation has two confirmed stale descriptions | root README status-mcp rows; `weather-feed/README.md` badge | Project map/status links mislead readers | Correct Weather in status-mcp row and point weather badge at the current workflow |

No meaningful production `TODO`, `FIXME` or `HACK` markers were found by the acquisition scan.

## 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Large orchestration/action modules | Capability growth around one privileged gateway | `gh-apps/kanarek-companion/src/` | Harder reasoning/review | Extract cohesive adapters/policies while keeping action contracts stable |
| Large Docbench PDF/document modules | Browser PDF feature density | `docbench/public/pdf-core.mjs`, `docbench/public/pdf-app.mjs`, `document-enhancements.mjs` | Regression coupling | Split pure transformations from UI/orchestration when tests justify it |
| Monolithic legacy controller | Historical JavaFX architecture | `xiaomi-adb-tools/src/main/kotlin/MainController.kt` | Device/UI changes stay coupled | Move command/device operations behind smaller services gradually |
| Per-project toolchain duplication | Repository consolidates products without workspace tooling | project manifests/workflows | Version/check drift | Centralize only shared policy if desired; preserve product independence |

## 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| status token accepted in URL path for connector compatibility | N/A | `mcp/status-mcp/src/entry.ts`, `wrangler.jsonc` | Bearer form supported; invocation logs disabled; fixed-time comparison | URL tokens can still appear in systems outside Worker invocation logs |
| Stream relay becoming an SSRF/open-proxy surface | A10 SSRF | `streambench/src/relay-core.ts`, `source-signing.ts` | Scheme/private-host checks, signed provider sources, redirect/time/body limits | Upstream/DNS behavior remains external to the app |
| Kanarek privileged GitHub/Cloudflare mutations | A01 broken access control | `gh-apps/kanarek-companion/src/policy-actions.ts`, `cloudflare-actions.ts`, `router.ts` | Identity/policy checks, expected state, account scoping, checkpoints and tests | Blast radius remains high if multiple guards regress together |
| Third-party weather/AI credentials | N/A | `weather-feed/src/sources.ts`, `gh-apps/kanarek-companion/src/quip.ts` | Runtime secrets; no secret values found in inspected source | `[TODO]` Rotation/lifecycle policy was not found |

## 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Kanarek Cloudflare inspection can paginate/scan many resources | `gh-apps/kanarek-companion/src/cloudflare-actions.ts` and pagination tests | Correct but request-heavy by design | Larger accounts increase latency/API use | Keep pagination bounded/cached where freshness permits |
| Multi-source remote fan-out | Weather, Status MCP, Kanarek | Intentional parallel I/O | Slow providers dominate tail latency | Preserve per-source timeouts and partial-failure behavior |
| Heavy browser document/PDF modules | `docbench/public/` | Several modules exceed 1,100 lines | Startup/memory cost on weaker devices may grow | Measure before lazy-loading/splitting; no perf suite exists |
| Stream provider/relay traffic | `streambench/src/index.ts`, `relay-core.ts` | Bounded per request | Usage amplifies third-party traffic/failure rate | Preserve caches, caps and constrained relay semantics |

## 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `gh-apps/kanarek-companion/src/` | Privileged, stateful orchestration with many integrations | `router.ts`: 28 touches in `git log --since="90 days ago"`; multiple 900–1,620 line modules | Make narrow changes and run full Kanarek `check` |
| Repository docs/policy | They are shared navigation/automation contracts | `README.md`: 102 touches; `AGENTS.md`: 38; MegaLinter config: 30 in the same Git query | Keep language variants/policy references synchronized |
| `docbench/public/` PDF logic | Complex preservation rules live in browser source | `pdf-core.mjs` 1,497; `document-enhancements.mjs` 1,178; `pdf-app.mjs` 1,167 lines | Add regression assertions before transformations |
| Xiaomi `MainController.kt` | UI and device logic are concentrated | 1,222 lines | Prefer extraction over broad rewrite; validate through CI build |

## 6) `[ASK USER]` Questions

1. `[ASK USER]` Is the convention-only monorepo deliberate, or should there eventually be one supported root command that validates all maintained subprojects?
2. `[ASK USER]` Should Node 24 be the supported local development runtime too, or is it intentionally only a CI choice?
3. `[ASK USER]` Are the missing Dependabot entries for Docbench npm and Xiaomi Gradle intentional?
4. `[ASK USER]` What automated-test/coverage expectation should apply to status-mcp and Xiaomi ADB Tools?
5. `[ASK USER]` Are the large Kanarek, Docbench and Xiaomi modules accepted ownership boundaries, or planned technical-debt targets?

## 7) Evidence

- Reproducible churn: `git log --since="90 days ago" --name-only --pretty=format:` grouped by path
- Reproducible size check: line counts over tracked `*.ts`, `*.js`, `*.mjs`, `*.kt` production files
- `mcp/status-mcp/src/entry.ts`, `mcp/status-mcp/src/index.ts`, `.github/workflows/status-mcp-ci.yml`
- `gh-apps/kanarek-companion/src/cloudflare-actions.ts`, `gh-apps/kanarek-companion/src/policy-actions.ts`, `gh-apps/kanarek-companion/src/router.ts`
- `docbench/public/pdf-core.mjs`, `streambench/src/relay-core.ts`, `xiaomi-adb-tools/src/main/kotlin/MainController.kt`
- `.github/dependabot.yml`, `weather-feed/README.md`, root `README.md`, `README_pl.md`, `README_zh.md`
