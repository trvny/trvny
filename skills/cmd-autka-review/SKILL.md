---
name: cmd-autka-review
description: Review the travino/autka project (Kotlin/Compose app + Cloudflare Worker backend) for correctness and its load-bearing invariants — offline-first with Room/D1 as source of truth, server-side source isolation (one feed failing can't sink the rest), CarOffer parity between backend lib/types.ts and com.autka.core.model.CarOffer, currency converted through PLN before compare/sort, no-scraping/credentials-server-side posture, pure Android-free core/, DataStore (not SharedPreferences), and PL+default string parity. Use when asked to "review autka", "audit the app/backend", "check this PR", or after modifying ingest sources, the repository, CarOffer, the runner, or DI.
license: Complete terms in LICENSE.txt
---

# Review autka (travino/autka)

> **In claude.ai chat.** Read via the github connector (`github:get_file_contents`); for a PR use `github:get_file_contents` with `ref: "refs/pull/<n>/head"` or read the changed files directly. You can't build/run here, so this is a static review — say so, and point real build signal at CI. Report findings against specific files/lines.

autka is a used-car aggregator: a Kotlin/Compose Android app (`/app`, package `com.autka`) reading from a Cloudflare Workers backend (`/backend`, TypeScript + D1 + R2) that aggregates marketplaces server-side. Review **both sides together** — most real bugs live at the seam between them.

Walk the invariants below. For each, state pass / fail / not-touched and cite the file. Lead with anything that breaks the build or the app↔backend contract; style nits last. Don't claim it compiles.

## The load-bearing invariants

**1. Offline-first; the cache is the source of truth.**
App: Room is authoritative. The repository (`OfflineFirstCarOfferRepository`) exposes data as `Flow` off the DAO and refreshes the cache separately — the UI must never read the network directly. Backend: D1 is the served store; the API reads D1, ingestion writes it. Flag any path where a ViewModel/screen consumes a network result that didn't go through the cache.

**2. Source isolation (backend `ingest/runner.ts`).**
`runIngestion` must run each source under its own try/catch so one failing feed can't reject the whole `Promise.all` or stop the others, and each run records an `ingest_runs` row. Flag a bare `Promise.all(sources.map(s => s.fetch()))` with no per-source guard, or a source whose `fetch` can throw out of the runner.

**3. CarOffer parity (the #1 seam bug).**
`backend/src/lib/types.ts` `CarOffer` must mirror `app/.../core/model/CarOffer.kt` field-for-field, and the enums (`Region`, `FuelType`, `Transmission`, `Currency`) must match exactly on both sides. A field added on one side only = the app silently drops it or fails to parse. Check the DTO/parse in `data/remote/backend/BackendCarOfferSource` and the Room entity/mapper too.

**4. No scraping; credentials stay server-side.**
New/changed sources must not scrape ToS-protected sites (Otomoto/OLX/Facebook) — they stay disabled (`isEnabled: () => false`) until a compliant feed exists (see `sources/stubs.ts`). Feed keys live in Worker `env` secrets, never committed, never a `buildConfigField`, never sent to the device. Flag any hardcoded key or scraping fetch. Run `github:run_secret_scanning` on changed files.

**5. Currency: convert through PLN before comparing.**
Offers are PLN/EUR/USD. Any filter/sort/compare across offers must convert to a common currency (routed through PLN via the cached `ExchangeRates` snapshot) first. Flag raw `amount` comparisons across mixed currencies — they rank wrong. The rate snapshot is cached in DataStore; decode defensively.

**6. core/ stays pure Kotlin.**
`core/model` and `core/util` must have **no Android imports** (no `android.*`, no `androidx.*`, no Compose/Context). Value objects, enums, and cost/exchange math live here so they stay JVM-unit-testable. Flag any Android dependency leaking into `core/`.

**7. Persistent state = DataStore, not SharedPreferences.**
User settings and the rate snapshot use Preferences DataStore. Reuse the single app-wide `DataStore<Preferences>` from `di/SettingsModule.kt` (namespace your keys) rather than creating a second one. Keys in a `companion`; decode with `runCatching{}.getOrNull()`. Flag `SharedPreferences` or a second DataStore.

**8. UDF + lifecycle.**
Events down (`onAction`), state up (`StateFlow<UiState>`, a sealed interface). UI collects with `collectAsStateWithLifecycle()` (not `collectAsState()`), screen-scoped state uses `SharingStarted.WhileSubscribed(5_000)`. The stateless `Screen` stays free of ViewModel/Hilt refs. Flag deviations.

**9. Strings: PL + default parity.**
User-facing strings live in `res/values/strings.xml` with a `res/values-pl/` translation (the app targets PL). Flag hardcoded user-facing strings and any key present in one locale but missing in the other.

**10. Bounded backend writes.**
The debug `ingest_runs` table is pruned to a cap (`INGEST_RUNS_KEEP`). Image caching (`images.ts`) is best-effort and never throws. Flag unbounded writes on the request/cron path or image failures that can abort an ingest.

**11. Gradle hygiene.**
Versions only via `gradle/libs.versions.toml` (referenced as `libs.*`) — no hardcoded versions in module files. The repo is on **AGP 9**, so Kotlin compiler options live in the top-level `kotlin { compilerOptions { … } }` block, not the removed `android.kotlinOptions`. Flag a regression to `kotlinOptions` or hardcoded versions.

## Output

A short structured review: blocking issues first (build breakers, parity drift, scraping/secret leaks, cross-currency compares), then correctness, then style. Each item: file/symbol, what's wrong, the minimal fix. End by pointing build/lint/test signal at CI (`lintDebug assembleDebug testDebugUnitTest`) since you can't run it here. If a source or the shared shape changed, hand off to `cmd-autka-add-source`; if a feed broke, to `autka-source-fix`.
