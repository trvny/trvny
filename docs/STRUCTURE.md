# Codebase Structure

## 1) Top-Level Map

| Path | Purpose | Evidence |
| --- | --- | --- |
| `.ai/` | Public AI configuration submodule plus private overlays/backups | `.ai/README.md`, `.gitmodules` |
| `.github/` | CI, dependency updates, linting, agents and automation templates | `.github/workflows/`, `.github/dependabot.yml` |
| `benches/` | Shared npm workspace for Codebench, Docbench and Streambench | `benches/package.json`, `benches/README.md` |
| `weather-feed/` | Scheduled weather/IMGW aggregator and Atom feed | `weather-feed/README.md`, `weather-feed/src/index.ts` |
| `mcp/status-mcp/` | One-tool MCP health aggregator | `mcp/status-mcp/README.md` |
| `gh-apps/` | Kanarek Companion Worker and GPTomek operator documentation/runtime | `gh-apps/README.md` |
| `xiaomi-adb-tools/` | Kotlin/JavaFX ADB/Fastboot desktop application | `xiaomi-adb-tools/README.md` |
| `stuff/` | Personal data/config/feed/playlist drawers, excluded from normal linting | `AGENTS.md`, `.github/linters/.mega-linter.yml` |

The repository is a mixed monorepo: the three Benches share an npm workspace and lockfile, while unrelated packages keep independent manifests and builds.

## 2) Entry Points

| Component | Main entry | Selection |
| --- | --- | --- |
| Codebench | `benches/codebench/src/index.ts` | `benches/codebench/wrangler.jsonc` |
| Docbench | `benches/docbench/src/index.ts` | `benches/docbench/wrangler.jsonc` |
| Streambench | `benches/streambench/src/entry.ts` | `benches/streambench/wrangler.jsonc` |
| Weather | `weather-feed/src/index.ts` | `weather-feed/wrangler.jsonc`; HTTP + scheduled handler |
| Status MCP | `mcp/status-mcp/src/entry.ts` | `mcp/status-mcp/wrangler.jsonc`; wraps `src/index.ts` |
| Kanarek/GPTomek | `gh-apps/kanarek-companion/src/runtime-entry.ts` | `gh-apps/kanarek-companion/wrangler.jsonc` |
| Xiaomi | `xiaomi-adb-tools/src/main/kotlin/Main.kt` | Gradle `application.mainClass = 'Main'` |

## 3) Module Boundaries

| Boundary | What belongs here | What must not be here | Evidence |
| --- | --- | --- | --- |
| Bench Worker `src/` | HTTP routing, security headers, provider/relay edge logic | Docbench document mutation and Codebench QR payload processing | `benches/codebench/src/index.ts`, `benches/docbench/src/index.ts`, `benches/streambench/src/entry.ts` |
| Bench browser `client/` or `public/` | UI, local files, media/PDF/QR processing | Cloudflare secret access | browser modules and Wrangler bindings |
| Weather `src/` | source adapters, normalization, state/feed rendering | unrelated project health or GitHub operations | `weather-feed/src/*` |
| Status MCP `src/` | aggregate health reads and MCP transport/auth | mutations of monitored projects | `mcp/status-mcp/src/entry.ts`, `src/index.ts` |
| Kanarek `src/` | webhook companion, guarded GitHub/Cloudflare/operator actions | unguarded raw privileged mutations | `gh-apps/kanarek-companion/src/router.ts` |
| `.ai/private/` | active private AI/operator context | reusable public-core material | `.ai/private/README.md` |
| `.ai/backups/` | historical reference only | active configuration | `.ai/backups/README.md` |

## 4) Naming and Organization Rules

- TypeScript/JavaScript modules are predominantly kebab-case (`source-signing.ts`, `code-change-orchestration.ts`); Kotlin class files use PascalCase (`MainController.kt`).
- Web projects are organized by component first, then mostly by feature. Kanarek is especially feature-oriented with one action/investigation module per capability.
- Imports are relative; inspected `tsconfig*.json` files define no path aliases.
- Generated or vendored assets live under each package's `public/` after build, but Docbench also intentionally keeps hand-maintained browser source in `public/*.js` and `public/*.mjs`; do not assume everything under `public/` is generated.
- `.github/workflows/*.lock.yml` is marked generated in `.gitattributes`.

## 5) Evidence

- `AGENTS.md`, `.gitmodules`, `.gitattributes`
- `benches/codebench/wrangler.jsonc`, `benches/docbench/wrangler.jsonc`, `benches/streambench/wrangler.jsonc`
- `weather-feed/wrangler.jsonc`, `mcp/status-mcp/wrangler.jsonc`
- `gh-apps/kanarek-companion/wrangler.jsonc`, `xiaomi-adb-tools/build.gradle`
