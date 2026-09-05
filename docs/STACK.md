# Technology Stack

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Runtime Summary

This repository remains an organizational monorepo, while the Bench family, Weather, Feedboard and Xiaomi ADB Tools now live in `twojstar/twojstar`. The root has no `package.json` or Node version pin; remaining local applications keep independent toolchains.

| Area | Value | Evidence |
| --- | --- | --- |
| Primary languages | TypeScript/JavaScript for Workers and browser tools; Kotlin/JVM for Xiaomi ADB Tools | tracked `*.ts`/`*.js`/`*.mjs`/`*.kt` inventory, `twojstar/twojstar/xiaomi-adb-tools/build.gradle` |
| Runtime + version | Cloudflare Workers/browser code targets ES2022; JS/TS CI uses Node 24; Xiaomi targets Java 21 | `*/tsconfig.json`, Bench/Weather/Status/Kanarek CI workflows, `twojstar/twojstar/xiaomi-adb-tools/build.gradle` |
| Package manager | npm workspace for Benches; per-project npm for other JS/TS services; Gradle Wrapper for Xiaomi | `twojstar/twojstar/benches/package.json`, other package manifests, `twojstar/twojstar/xiaomi-adb-tools/gradle/wrapper/gradle-wrapper.properties` |
| Module/build system | TypeScript 7 + Wrangler 4; Gradle 9.7.1 + Kotlin 2.4.10 | package manifests, `twojstar/twojstar/xiaomi-adb-tools/build.gradle` |

Gap: Local Node support is not durably declared. PR #265 records a historical successful run on Node 22.22.2 while CI used Node 24, but current manifests and repository guidance do not define a supported local version.

## 2) Production Frameworks and Dependencies

| Component | High-impact runtime dependencies | Role | Evidence |
| --- | --- | --- | --- |
| Codebench | `qr-code-styling` 1.9.2, `bwip-js` 4.11.4, `zxing-wasm` 3.1.3 | QR/barcode generation and scanning in-browser | `twojstar/twojstar/benches/codebench/package.json` |
| Docbench | `@cantoo/pdf-lib` 2.9.1, `pdfjs-dist` 6.3.289, `qpdf-run` 0.2.1, `marked` 18.0.11, `js-yaml` 5.4.1, `js-tiktoken` 1.0.21 | PDF/document parsing, mutation, rendering and token counting in-browser | `twojstar/twojstar/benches/docbench/package.json` |
| Streambench | `hls.js` 1.7.2 | Browser HLS playback | `twojstar/twojstar/benches/streambench/package.json` |
| Weather, Status MCP, Kanarek | No production npm packages; platform Web APIs and Cloudflare bindings | Edge services | respective `package.json` files |
| Xiaomi ADB Tools | JavaFX 21.0.12, `kotlinx-coroutines-javafx` 1.11.0 | Desktop UI and asynchronous device commands | `twojstar/twojstar/xiaomi-adb-tools/build.gradle` |

Fontsource packages are runtime build inputs for Codebench/Docbench, copied into static assets rather than fetched from Google Fonts in production.

## 3) Development Toolchain

| Tool | Purpose | Evidence |
| --- | --- | --- |
| TypeScript 7.0.2 | Static checking/client compilation | package scripts and `tsconfig*.json` |
| Wrangler 4 | Cloudflare types, dev server, dry-run and deploy | JS/TS package manifests |
| Node built-in test/assert + `tsx` | Worker and module tests | Kanarek/Weather manifests and tests |
| MegaLinter + zizmor | Repository linting and Actions security checks | `.github/workflows/mega-linter.yml`, `.github/linters/.mega-linter.yml` |
| Gradle Wrapper | Xiaomi build | `twojstar/twojstar/xiaomi-adb-tools/gradlew`, wrapper properties |

## 4) Key Commands

```bash
(cd gh-apps/kanarek-companion && npm ci && npm run check)
(cd mcp/status-mcp && npm ci && npm run typecheck)
```

## 5) Environment and Config

- Cloudflare config: each deployed package owns `wrangler.jsonc`; there is no root deployment manifest.
- Runtime bindings include `ASSETS`, `WEATHER_KV`, `KANAREK_QUIP_KV`, Durable Objects, and Status MCP service bindings; see the relevant Wrangler files.
- Secrets are read from Worker env bindings. Important names include `STATUS_MCP_TOKEN`, `STREAMBENCH_RELAY_SECRET`, weather API keys, GitHub App keys/webhook secret, Cloudflare credentials, and AI-provider API keys.
- `.ai/core` is a Git submodule; `.ai/profile.yaml` and `.ai/private/` form the private overlay (`.gitmodules`, `.ai/README.md`).

## 6) Evidence

- `twojstar/twojstar/benches/codebench/package.json`, `twojstar/twojstar/benches/docbench/package.json`, `twojstar/twojstar/benches/streambench/package.json`
- `twojstar/twojstar/weather-feed/package.json`, `mcp/status-mcp/package.json`, `gh-apps/kanarek-companion/package.json`
- `twojstar/twojstar/xiaomi-adb-tools/build.gradle`, `twojstar/twojstar/xiaomi-adb-tools/gradle/wrapper/gradle-wrapper.properties`
- `twojstar/twojstar/.github/workflows/benches-release.yml`, `.gitmodules`
