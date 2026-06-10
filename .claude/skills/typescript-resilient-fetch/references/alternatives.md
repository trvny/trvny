# Wider toolbox & tradeoffs

Options beyond any single project's stack. The menu, not a mandate — native
`fetch` plus a few small helpers covers most needs dependency-free.

## Runtime validation (untrusted JSON)

The highest-leverage addition over a cast-everywhere codebase.

- **Zod** — the default; rich schemas, `safeParse`, `z.infer` for types. Larger
  bundle.
- **valibot** — same idea, tree-shakeable and tiny; good for edge/browser bundles.
- **arktype** — TS-syntax schemas, very fast.
- **io-ts** — fp-ts ecosystem, `Either`-based.
- Pattern: schema at the trust boundary → typed, verified data inward. Cast
  (`as T`) only for data you produced/control.

## Result / error modeling

- **Discriminated unions** — built-in, zero-dep; tag variants and `switch`.
- **neverthrow** — `Result<T, E>` / `ResultAsync`; failure as a value, chainable.
- **ts-pattern** — exhaustive pattern matching with `.exhaustive()`.
- **Effect** — full effect system (Result, retry, concurrency, DI) — powerful but
  a big commitment; for substantial apps, not a single worker.
- `never`-default `switch` for compile-time exhaustiveness, free.

## Retry / backoff / resilience

- **p-retry** — promise retries with exponential backoff + `onFailedAttempt`.
- **Hand-rolled** loop — fine for 2–3 attempts; add jitter.
- **cockatiel** / **opossum** — policies incl. circuit breaker, bulkhead, timeout.
- Always: bounded attempts, exponential backoff **with jitter**, distinguish
  retryable (transport/5xx/timeout) from non-retryable (4xx/empty).

## Concurrency control

- **Promise.all** — independent work, reject-fast.
- **Promise.allSettled** — collect successes even if some fail.
- **p-limit** / **p-map** (`{ concurrency }`) — cap simultaneous in-flight work.
- **AbortSignal** propagation — one signal cancels a whole group; `AbortSignal.any`
  to combine timeout + caller cancel.

## HTTP clients

- **Native `fetch`** — universal across Node 18+, Deno, Bun, Workers, browser.
- **ofetch** — auto-parse, retries, typed; pleasant default wrapper.
- **ky** — tiny `fetch` wrapper, retry/hooks, browser+edge.
- **undici** — Node's HTTP client under the hood; low-level control, pooling.
- **axios** — mature, interceptors; heavier, not edge-native.

## Type-safety techniques

- `strict: true`, and especially **`noUncheckedIndexedAccess`** — makes array/record
  access `T | undefined`, forcing the guards.
- **`satisfies`** to validate-without-widening; **`as const`** for literal tuples
  and readonly data.
- **Type predicates** (`x is T`) to filter+narrow together.
- **Branded/opaque types** to stop mixing same-underlying-type values (IDs, tokens).
- **`Readonly<T>` / `ReadonlyArray<T>`** on inputs you shouldn't mutate.
- Derive types from data (`typeof`, `z.infer`, `keyof`) instead of re-declaring —
  one source of truth.

## Observability

- Structured JSON log lines; a `Level` union.
- Per-run summary counts; tag which source/path served each result.
- For services: OpenTelemetry spans around each upstream call.

## When to stay dependency-free

On constrained runtimes (Workers free tier, tight cold-start budgets), native
`fetch` + `AbortSignal.timeout` + a 10-line `withRetry` + a discriminated union
gets you most of the resilience here with zero install. Add Zod/p-retry/neverthrow
when the validation/retry/error-flow burden actually justifies the bundle.
