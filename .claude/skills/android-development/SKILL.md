---
name: android-development
description: Work on Android apps (Kotlin, Jetpack Compose, Hilt, Room, Flow) from a chat or GitHub-tool context — primarily the travino/autka repo. Use whenever the user asks to add or change a screen, ViewModel, repository, data source, DI binding, or Gradle/version-catalog entry; review or debug Kotlin/Compose code; open a PR against an Android repo; or asks about autka's architecture. Trigger this even when the request just names a file, class, or feature in an Android repo without saying "Android" — and ALWAYS read the repo before writing code, because the right structure depends on what's already there, not on a generic template.
license: Complete terms in LICENSE.txt
---

# Android Development

This skill is for working on Android apps **from chat or via GitHub tools**, not inside Android Studio. The headline constraint: you cannot build, run, lint, or emulate here. So the value you add is correct, idiomatic, drop-in code that matches the repo as it already exists — and clean Git hygiene when you commit it.

The primary target is **travino/autka** (a used-car aggregator: Kotlin/Compose Android app + Cloudflare Workers backend). Treat autka as the default repo unless the user names another. The skill still generalizes to other Android repos.

## The two rules that matter most

**1. Read before you write.** Never generate code from a generic template. Pull the actual files first (`github:get_file_contents`) and match what's there: package names, module layout, naming, the DI style, the Compose conventions, the version catalog. A correct-looking ViewModel that doesn't match the repo's patterns is a defect, not a contribution.

**2. Don't claim it works.** You can't compile or run anything in chat. Say "this should compile" / "wire it up and run `./gradlew assembleDebug` to confirm" — never "I tested this" or "this builds." Flag anything you're unsure resolves (imports, Hilt graph completeness, KSP-generated symbols).

## Know the target repo before generating

autka's real shape (verify against the repo; don't trust this blindly — it changes):

- **Single module**, package-by-layer under `com.autka`:
  ```
  app/src/main/java/com/autka/
    core/
      model/   value objects + enums: CarOffer, Money, Region, FuelType, ExchangeRates, ImportCostEstimate, ImportService, SearchFilter
      util/    pure helpers (e.g. Result) — no Android deps
    data/
      local/      Room database, DAO, entity + mappers (local cache = source of truth)
      remote/     CarOfferSource interface + BackendCarOfferSource (the API client) + MockCarOfferSource
      repository/ OfflineFirstCarOfferRepository: reads cache via Flow, refreshes from the backend
    di/        Hilt modules (database, repository, sources multibinding)
    feature/
      listings/   search + results screen (ViewModel + Compose)
      detail/     offer detail + US import cost breakdown
    ui/        theme, navigation host, shared components
  ```
- This is **package-by-layer in one module**, NOT the NowInAndroid multi-module / `build-logic` convention-plugin structure. Do not introduce `feature:*:api`/`impl` modules or convention plugins here — that would fight the project. (Community skills like dpconde/claude-android-skill assume the NiA multi-module shape; their architecture/gradle/modularization guidance does **not** apply to autka — only their language-level Compose/testing patterns transfer.)
- **Stack (verify against `gradle/libs.versions.toml` — it drifts):** as of the last check, AGP 9.2.0, Kotlin 2.4.0, KSP 2.3.9, Compose BOM 2024.12.01, Hilt 2.59.2, Room 2.8.4, coroutines 1.11.0, DataStore 1.2.1, Navigation 2.9.8, Retrofit 2.11.0 + kotlinx-serialization, Coil 2.7.0, **osmdroid 6.1.20** (maps), compileSdk/targetSdk 35, minSdk 26, JVM 17. **AGP 9 removed `android.kotlinOptions`** — Kotlin compiler options now live in a top-level `kotlin { compilerOptions { jvmTarget = … } }` block in `app/build.gradle.kts`. Bump versions only via the catalog; KSP/Hilt/AGP are matched to Kotlin, so if you move one, check the others.
- **Backend split (server-side aggregation):** the app reads from a single `BackendCarOfferSource` hitting the Cloudflare Worker (`/backend`, TypeScript/D1/R2, deployed as `cargate-backend`). The Worker fans out to marketplaces via ingest adapters (`backend/src/ingest/sources/`, registered in `runner.ts`) — that's where feeds and credentials live. `BACKEND_BASE_URL` is a per-buildType `buildConfigField` in `app/build.gradle.kts` (debug points at `10.0.2.2:8787` for `wrangler dev`). Backend `src/lib/types.ts` mirrors the app's `core/model/CarOffer` — change the shared shape on one side, change the other. **Adding a marketplace is a backend task; see the `cmd-autka-add-source` skill.**
- **Maps:** uses **osmdroid (OpenStreetMap)** — no API key required. There is no Google Maps dependency, so don't add a `MAPS_API_KEY`. Any genuine secrets belong in `local.properties` (gitignored) or Worker `env` secrets, never in committed code.

If the user points at a different repo, do the same recon there and adapt — detect single- vs multi-module from the tree before deciding structure.

## GitHub workflow

When the task is to actually land a change (not just show code in chat):

1. **Read** the files you'll touch and their neighbors. Use `github:get_file_contents` on the specific files plus the relevant package dir so you match conventions and get current content.
2. **Branch.** Never commit to `main`. Create a topic branch (e.g. `feat/rate-cache`, `fix/filter-currency`). Use `github:create_branch`.
3. **Edit on the branch.**
   - Single file: `github:create_or_update_file`. Updating an existing file **requires its blob `sha`** (from the `get_file_contents` result) — omit it only when creating a new file.
   - Multiple files in one commit: `github:push_files`.
4. **Scan before you push.** Run `github:run_secret_scanning` on any content that could carry a key/token before committing it. If it flags something, stop and tell the user.
5. **Open a PR** (`github:create_pull_request`) against `main` with a short description of what changed and why. CI (`.github/workflows/android-ci.yml`) runs `lintDebug assembleDebug testDebugUnitTest` on the PR — tell the user to watch the check rather than asserting the build passes yourself.
6. Keep commits scoped and messages imperative (`Add exchange-rate cache`, not `added stuff`).

Don't push unprompted. If the user just wants to see code, show it in chat and offer to open a PR.

## Core principles (autka follows these — keep them)

1. **Offline-first:** Room is the source of truth; the network refreshes the cache. The repository exposes cached data via `Flow` and triggers refresh separately.
2. **Unidirectional data flow:** events down (`onAction`), state up (`StateFlow<UiState>`).
3. **Reactive streams:** expose data as `Flow`; collect with `collectAsStateWithLifecycle()`.
4. **Source isolation (server-side):** marketplace aggregation lives in the backend. The Worker's ingest runner runs each `IngestSource` under its own try/catch so one failing feed can't sink the others. The app binds a single `BackendCarOfferSource` (+ `MockCarOfferSource` for offline dev) via `@Binds @IntoSet` in `di/SourcesModule.kt` — it does **not** hold per-marketplace adapters anymore.
5. **Pure model layer:** `core/` is plain Kotlin (no Android deps) — calculators, value objects, exchange-rate math live here and stay unit-testable.

## Standard patterns

Match these to whatever the repo already does — names and signatures below are the shape, not gospel.

### UiState (sealed interface)
```kotlin
sealed interface ListingsUiState {
    data object Loading : ListingsUiState
    data class Success(val offers: List<CarOffer>) : ListingsUiState
    data class Error(val message: String) : ListingsUiState
}
```

### ViewModel (Hilt, StateFlow from a Flow)
```kotlin
@HiltViewModel
class ListingsViewModel @Inject constructor(
    private val repository: CarOfferRepository,
) : ViewModel() {

    val uiState: StateFlow<ListingsUiState> = repository.observeOffers()
        .map<List<CarOffer>, ListingsUiState>(ListingsUiState::Success)
        .catch { emit(ListingsUiState.Error(it.message ?: "Unknown error")) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = ListingsUiState.Loading,
        )

    fun onAction(action: ListingsAction) {
        when (action) {
            is ListingsAction.OfferClicked -> { /* navigate / handle */ }
        }
    }
}
```

### Screen (stateful Route + stateless Screen)
```kotlin
@Composable
internal fun ListingsRoute(
    onOfferClick: (String) -> Unit,
    viewModel: ListingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    ListingsScreen(uiState = uiState, onAction = viewModel::onAction, onOfferClick = onOfferClick)
}

@Composable
internal fun ListingsScreen(
    uiState: ListingsUiState,
    onAction: (ListingsAction) -> Unit,
    onOfferClick: (String) -> Unit,
) {
    when (uiState) {
        ListingsUiState.Loading -> LoadingIndicator()
        is ListingsUiState.Success -> OfferList(uiState.offers, onOfferClick)
        is ListingsUiState.Error -> ErrorMessage(uiState.message)
    }
}
```
Keep the stateless `Screen` free of ViewModel/Hilt references so it stays previewable and testable.

### Offline-first repository
```kotlin
interface CarOfferRepository {
    fun observeOffers(): Flow<List<CarOffer>>
    suspend fun refresh(filter: SearchFilter)
}

internal class OfflineFirstCarOfferRepository @Inject constructor(
    private val dao: CarOfferDao,
    private val sources: Set<@JvmSuppressWildcards CarOfferSource>,
) : CarOfferRepository {

    override fun observeOffers(): Flow<List<CarOffer>> =
        dao.observeAll().map { entities -> entities.map(CarOfferEntity::toModel) }

    override suspend fun refresh(filter: SearchFilter) {
        sources.map { source ->
            runCatching { source.fetch(filter) }.getOrElse { emptyList() } // isolate failures
        }.flatten().let { dao.upsertAll(it.map(CarOffer::toEntity)) }
    }
}
```

### Adding a marketplace = a backend change (not an app binding)
Per-marketplace adapters live in the backend Worker now, not the app. To add a source you write an `IngestSource` in `backend/src/ingest/sources/` and register it in `runner.ts`'s `ALL_SOURCES`; the app only changes if the shared `CarOffer` shape changes. The app's `SourcesModule` just binds `Backend` + `Mock`:
```kotlin
// di/SourcesModule.kt — these two only; don't add per-marketplace bindings here
@Binds @IntoSet abstract fun bindBackend(source: BackendCarOfferSource): CarOfferSource
@Binds @IntoSet abstract fun bindMock(source: MockCarOfferSource): CarOfferSource
```
Full workflow (compliant-feed gating, type parity, verification) is in the `cmd-autka-add-source` skill.

## Gradle / dependencies

- Versions are centralized in `gradle/libs.versions.toml`. Add or bump there and reference via `libs.*` in `build.gradle.kts` — don't hardcode versions in module build files.
- The version set is deliberately compatible (KSP matched to Kotlin+AGP; Hilt matched to Kotlin). If you bump one of Kotlin/AGP/KSP/Hilt, check the others — mismatches break the build in ways you can't see from chat. When unsure of a current compatible version, read the catalog in the repo or look it up rather than guessing.
- **AGP 9 specifics:** `android.kotlinOptions { jvmTarget = … }` was removed. Put compiler options in a top-level `kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }` block (import `org.jetbrains.kotlin.gradle.dsl.JvmTarget`). Don't reintroduce `kotlinOptions`.

## Things to get right

- Use `collectAsStateWithLifecycle()`, not `collectAsState()`, for lifecycle-aware collection.
- `SharingStarted.WhileSubscribed(5_000)` for screen-scoped state (survives config change, stops when backgrounded).
- Currency: offers are PLN/EUR/USD; convert to the user's display currency (routing through PLN) before filtering/sorting so mixed-currency results rank correctly. Don't compare raw amounts across currencies.
- Persistent non-Room state (user settings, the cached exchange-rate snapshot) uses **Preferences DataStore**, not SharedPreferences. Mirror `DataStoreSettingsRepository`: keys in a `companion`, decode defensively with `runCatching{}.getOrNull()`. A single app-wide `DataStore<Preferences>` ("settings") is already provided in `di/SettingsModule.kt` — reuse it (namespace your keys) unless you have a reason to isolate.
- Strings go in `res/values/strings.xml` with a Polish translation in `res/values-pl/` — the app targets PL. Don't hardcode user-facing strings.
- Keep `core/` Android-free so it stays pure-Kotlin testable.
- Maps use **osmdroid**, not Google Maps — needs the `INTERNET`/storage perms and a user-agent set, but no API key.

## Testing

The version catalog currently ships **no test dependencies** and the codebase is effectively untested, so adding tests means adding catalog entries first — don't assume JUnit/Turbine are already there. When you set up tests:

- **Add to `gradle/libs.versions.toml`** and wire into `app/build.gradle.kts`: `junit` (+ `testImplementation`), `kotlinx-coroutines-test`, `turbine` (Flow/StateFlow assertions), and an assertion lib (`truth` or `assertk`). For instrumented tests: `androidx.test.ext:junit`, `espresso`, and `androidx-compose-ui-test-junit4` (+ the `debugImplementation` manifest helper). The `testInstrumentationRunner` is already set.
- **Test `core/` as plain JVM unit tests** (`app/src/test/`). It has no Android deps, so the cost/exchange-rate math and value objects need no Robolectric — this is the highest-value, cheapest coverage. Mirror the import-cost and currency-conversion logic here.
- **Repositories/ViewModels:** prefer **fakes over mocks**. A `FakeCarOfferDao`/`FakeCarOfferSource` returning a `MutableStateFlow` is clearer than a mock and exercises the real `Flow` wiring. Assert `StateFlow<UiState>` emissions with Turbine; install a `MainDispatcherRule` (a `TestWatcher` swapping `Dispatchers.Main` for a `StandardTestDispatcher`) so `viewModelScope`/`stateIn` work under test.
- **Compose:** the stateless `Screen` (no ViewModel/Hilt) is the unit to test with `createComposeRule()` — another reason to keep state out of it.
- **Backend (`/backend`):** TypeScript — use Vitest with `@cloudflare/vitest-pool-workers` for the Worker, and unit-test ingest adapters' `toCarOffer` mappers against captured payloads. Keep `CarOffer` parity assertions close to `lib/types.ts`.

You can write these here, but you can't run them in chat — hand off the `./gradlew testDebugUnitTest` / `npm --prefix backend test` command and watch CI.

## Companion skills

- **`cmd-autka-add-source`** — add a marketplace (backend ingest adapter + registration, compliant-feed gating, type parity).
- **`cmd-autka-review`** — audit a change against autka's load-bearing invariants.
- **`autka-source-fix`** — diagnose a dead/empty/stale source from `ingest_runs` and fix the adapter.

## What you can't do here (be honest about it)

No Gradle, no emulator, no lint, no instrumentation tests in chat. You can write code, reason about the Hilt graph and types, write unit-testable logic, and open PRs — but the build/run/visual-verify loop happens on the user's machine or in CI. Hand off clearly: tell them the exact command to run and what a passing result looks like.
