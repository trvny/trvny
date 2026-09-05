# External Integrations

> Workshop sources under `twojstar/twojstar/...` were migrated out of this repository; these references point to their active home.

## 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| Cloudflare Workers platform | Edge runtime/storage/bindings | Hosting, assets, cron, KV, Durable Objects and service bindings | Deployment/account credentials outside source | high | project `wrangler.jsonc` files |
| GitHub API/OAuth/uploads | API | Kanarek/GPTomek repository, PR, release and identity operations | GitHub App JWT/install tokens; OAuth where needed | high | `gh-apps/kanarek-companion/src/github-app.ts`, `gpt-actions.ts`, `release-actions.ts` |
| Cloudflare API | API | Guarded Worker/Pages/DNS/route inspection and mutation | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | high | `gh-apps/kanarek-companion/src/cloudflare-actions.ts` |
| AI providers | API | Optional Kanarek quips/review/operator AI | Per-provider API keys | medium | `gh-apps/kanarek-companion/src/quip.ts` |
| IPTV/Radio catalogs | API/files | Streambench channel/radio discovery and metadata | Public/no auth | medium | `twojstar/twojstar/benches/streambench/src/index.ts`, `src/providers/` |
| Weather providers + IMGW | API | Current weather, forecast, AQ/pollen and warnings | Open-Meteo/IMGW public; OpenWeather/Visual Crossing keys | high | `twojstar/twojstar/weather-feed/src/sources.ts` |
| Project health sources | Service bindings + GitHub HTTP | status-mcp health roll-up | Internal Worker bindings; outbound public GitHub reads | medium | `mcp/status-mcp/src/index.ts`, `wrangler.jsonc` |
| ADB/Fastboot | Local process/toolchain | Xiaomi device inspection and actions | Local USB/device authorization | high | `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Command.kt`, `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Device.kt` |

Streambench's public upstreams include iptv-org, Free-TV, Radio Browser and Radio Paradise metadata. Kanarek's optional AI adapters target OpenAI, Anthropic, Gemini, OpenRouter, OrcaRouter and xAI (`twojstar/twojstar/benches/streambench/src/index.ts`, `gh-apps/kanarek-companion/src/quip.ts`).

## 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| `WEATHER_KV` | Last-good/current weather state | `weather-feed` Worker | Stale data during prolonged upstream outage | `twojstar/twojstar/weather-feed/wrangler.jsonc`, `src/index.ts` |
| `KANAREK_QUIP_KV` | Companion quip bank/persistence | Kanarek Companion | Stale/generated content state | `gh-apps/kanarek-companion/wrangler.jsonc`, `src/companion-bank.ts` |
| Durable Objects | Companion coalescing and operator mutation checkpoints | Kanarek runtime | Incorrect locking could duplicate/block privileged work | `gh-apps/kanarek-companion/wrangler.jsonc`, `src/runtime-entry.ts` |
| Browser `localStorage` | Streambench favorites, hidden items, edits, recents and preferences | `twojstar/twojstar/benches/streambench/client/local-state.ts` | Corruption/quota; intentionally non-server state | `twojstar/twojstar/benches/streambench/client/local-state.ts` |
| Cloudflare Cache API | Short-lived status-mcp aggregate cache | `mcp/status-mcp/src/entry.ts` | Briefly stale status | `mcp/status-mcp/src/entry.ts` |

Codebench and Docbench are intentionally local-first and do not persist user QR/document contents on a server (`twojstar/twojstar/benches/codebench/README.md`, `twojstar/twojstar/benches/docbench/README.md`).

## 3) Secrets and Credentials Handling

- Credential sources are Cloudflare secrets/runtime environment and GitHub Actions secrets, not committed secret values.
- Key runtime names include `STREAMBENCH_RELAY_SECRET`, `OPENWEATHER_KEY`, `VISUALCROSSING_KEY`, `STATUS_MCP_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_PRIVATE_KEY`, `GPTOMEK_PRIVATE_KEY`, AI-provider keys, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- Kanarek tests verify Cloudflare secret values are stripped from returned overview data (`gh-apps/kanarek-companion/test/cloudflare-actions.test.ts`).
- status-mcp supports bearer auth and a token-in-path connector form; invocation logs are explicitly disabled to reduce path-token exposure (`mcp/status-mcp/wrangler.jsonc`, `src/entry.ts`).
- `[TODO]` No repository-wide credential rotation/lifecycle policy or `.env.example` convention was found.

## 4) Reliability and Failure Behavior

- Weather source reads use timeouts plus retry/backoff with jitter, then reconcile with last-good state so one provider outage does not erase valid data (`twojstar/twojstar/weather-feed/src/sources.ts`, `src/index.ts`).
- Streambench bounds upstream playlist reads to 5 MB, applies fetch timeouts, rejects unsafe/private relay targets and signs provider relay sources (`twojstar/twojstar/benches/streambench/src/index.ts`, `src/relay-core.ts`, `src/source-signing.ts`).
- status-mcp uses per-source timeouts, parallel reads, in-flight deduplication and short normal/deep caches (`mcp/status-mcp/src/entry.ts`, `src/index.ts`).
- Kanarek privileged writes use expected snapshots/SHAs plus Durable Object checkpoints/leases so stale or competing writes fail instead of racing (`gh-apps/kanarek-companion/src/cloudflare-actions.ts`, `src/autopilot-checkpoint.ts`).
- No general circuit-breaker abstraction was found; fallback is implemented per integration.

## 5) Observability for Integrations

- Cloudflare observability/log sampling is configured per Worker; weather-feed and Kanarek persist selected logs while sensitive status-mcp invocation logging is disabled.
- Kanarek emits structured JSON for persistence/operator events; weather logs source/update failures and maintains health/freshness surfaces.
- status-mcp itself is an observability aggregation surface for four projects.
- `[TODO]` No cross-project metrics, distributed tracing or explicit SLO/SLA policy was found.

## 6) Evidence

- `twojstar/twojstar/weather-feed/src/sources.ts`, `twojstar/twojstar/weather-feed/wrangler.jsonc`
- `twojstar/twojstar/benches/streambench/src/index.ts`, `twojstar/twojstar/benches/streambench/src/relay-core.ts`, `twojstar/twojstar/benches/streambench/src/source-signing.ts`
- `mcp/status-mcp/src/entry.ts`, `mcp/status-mcp/src/index.ts`, `mcp/status-mcp/wrangler.jsonc`
- `gh-apps/kanarek-companion/src/cloudflare-actions.ts`, `gh-apps/kanarek-companion/src/quip.ts`, `gh-apps/kanarek-companion/wrangler.jsonc`
- `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Command.kt`, `twojstar/twojstar/xiaomi-adb-tools/src/main/kotlin/Device.kt`
