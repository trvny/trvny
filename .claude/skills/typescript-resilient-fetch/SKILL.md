---
name: typescript-resilient-fetch
description: Write or review robust, type-safe TypeScript for network/IO — typed fetch with timeouts, retry/backoff, fallback chains, runtime validation of untrusted JSON (Zod/valibot), Result types, discriminated unions, exhaustive handling, readonly/as const/satisfies. Use for fetching APIs, layering caches/fallbacks, parsing external JSON, multi-source resolution, or strict typing of handlers/responses, in any runtime (Node, Deno, Bun, Workers, browser) including trvny/tvpi. Also "type-safe fetch", "add a timeout/retry", "validate this response", "tighten the types". Pair with cloudflare for Workers specifics.
license: MIT
---

# TypeScript: Resilient, Type-Safe Fetch & I/O

The recurring problem: TypeScript that talks to a **flaky upstream** and must
stay **correct under failure** — bounded, validated, narrowly typed. This is
language-level and runtime-agnostic (Node, Deno, Bun, Workers, browser all have
`fetch` + `AbortSignal`). For a specific runtime's primitives (KV, Cache API,
bindings, `wrangler`), defer to the `cloudflare` skill.

The repo (`trvny/tvpi`) appears as one worked example, not the only shape.

---

## 1. Typed fetch with a hard timeout

Every upstream call gets a timeout, a status check, and a typed body.

```ts
const res = await fetch(url, { signal: AbortSignal.timeout(7_000) });
if (!res.ok) return null;                 // reached upstream, bad status
const data = (await res.json()) as Shape; // see §2 — prefer validation over a cast
```

- `AbortSignal.timeout(ms)` is the modern one-liner; `AbortController` when you
  need to cancel manually or thread one signal through several calls.
- Split outcomes: **throw on transport failure** (so a retry layer sees it),
  **return `null`/empty on reached-but-empty** (a retry won't help).

## 2. Don't trust JSON — validate at the boundary

`as Shape` is a *lie to the compiler*: it performs **no runtime check**. For
data you control, fine. For an external API, a cast means a shape change becomes
a confusing crash deep in your code instead of a clear error at the edge.

**Parse with a schema instead** and infer the type from it:

```ts
import { z } from "zod";

const Playlist = z.object({
  sources: z.object({ HLS: z.array(z.object({ src: z.string() })).optional() }).optional(),
});
type Playlist = z.infer<typeof Playlist>;

const parsed = Playlist.safeParse(await res.json());
if (!parsed.success) { log("warn", { msg: "bad shape", issues: parsed.error.issues }); return null; }
// parsed.data is fully typed AND verified at runtime
```

Alternatives with the same idea: **valibot** (tiny, tree-shakeable),
**arktype**, **io-ts**. Use a cast only for trusted/internal data; validate
anything crossing a trust boundary. This is the single biggest robustness upgrade
over a codebase that casts everywhere.

## 3. Model outcomes as data

Booleans-and-comments lose information. Two complementary tools:

**Discriminated unions** — tag the variants, `switch` on the tag:

```ts
type Source = "cache" | "live" | "kv" | "raw" | "none";
type Fetched =
  | { ok: true; url: string; source: Source }
  | { ok: false; reason: "timeout" | "empty" | "http" };
```

**Result / Either types** — make failure a value, not a thrown exception
(`neverthrow`'s `Result<T, E>`, or a hand-rolled `{ ok, value } | { ok, error }`).
Forces callers to handle the error path; pairs well with fallback chains.

**Exhaustiveness** — `switch` with a `never` default catches a missed case at
compile time; **ts-pattern** gives ergonomic exhaustive matching.

```ts
function assertNever(x: never): never { throw new Error(`unhandled: ${x}`); }
```

## 4. Retry, backoff, fallback

- **Bounded retries** with **exponential backoff + jitter** — never a tight loop,
  never infinite. `p-retry` does this well, or a small wrapper.
- **Fallback chain** is the real resilience: try fastest/cheapest source first,
  return the moment one yields, degrade through tiers (live → cache → mirror).
  Read top-to-bottom.
- **Circuit breaker** at scale: stop calling a dead upstream until it recovers.
- Narrow the `unknown` from `catch` with `e instanceof Error` before using it.

```ts
async function withRetry<T>(label: string, fn: () => Promise<T | null>, attempts = 2) {
  for (let i = 1; i <= attempts; i++) {
    try { const r = await fn(); if (r) return r; }
    catch (e) { log("warn", { label, attempt: i, error: e instanceof Error ? e.message : String(e) }); }
  }
  return null;
}
```

## 5. Concurrency

- Independent work: `Promise.all(items.map(fn))`. Use `Promise.allSettled` when
  one failure shouldn't reject the batch.
- **Bound** fan-out with `p-limit` (or a semaphore) so you don't open 500 sockets
  at once.
- Propagate one `AbortSignal` to cancel a whole group together.
- Offload side-effects from the response path where the runtime supports it
  (e.g. Workers' `ctx.waitUntil`).

## 6. Compile-time safety

- `as const` + `readonly` freeze fixed data and keep literal types; build a `Map`
  for lookups.
- **`satisfies T`** checks an object against a type *without widening it* — keep
  precise inferred types while still catching mistakes. Prefer over `: T` when
  you want the narrow type; use `: T` when you want the broad interface.
- **Type predicates** narrow while filtering — `.filter(Boolean)` does **not**:
  ```ts
  const valid = results.filter((r): r is Ok => r.url !== null);
  ```
- **Branded types** for IDs/units (`type ChannelId = string & { __brand: "ChannelId" }`)
  prevent mixing up same-typed values.
- Turn on `strict` (incl. `noUncheckedIndexedAccess`) — it forces the null
  handling this skill is about.

## 7. HTTP clients across runtimes

`fetch` is universal now. Reach past it for ergonomics:

- **ofetch** — auto-JSON, retries, errors as exceptions.
- **ky** — tiny `fetch` wrapper with retry/hooks (browser + edge).
- **undici** — Node's underlying HTTP/1.1 client; fine-grained control.
Native `fetch` + a small `withRetry` covers most cases without a dependency.

## 8. Observability

One structured `log(level, fields)` emitting JSON lines; a `Level` union
(`"info" | "warn" | "error"`); a run summary with per-source counts. Surface
*which path served each result* (the tvpi Worker uses `X-Source-*` headers) so
production failures are diagnosable.

---

## Project example (one instantiation)

`trvny/tvpi` `worker/src/index.ts` implements §1, §3–§6, §8 with native `fetch`
+ hand-rolled helpers and no dependencies. Annotated extracts:
`references/worker-patterns.md`. Runtime rules (KV write policy, TTL vs token
lifetime, fallback order) live in the `tvpi` skill.

**Ideas it could adopt** (the outside perspective): replace the `as TvpPlaylist`
cast with a **Zod `safeParse`** so a TVP API shape change fails cleanly at the
edge; add **jittered backoff** to `withRetry`; consider a **Result type** to make
the `null` fall-through explicit. The wider catalogue: `references/alternatives.md`.

## Quick checklist

1. Timeout (`AbortSignal.timeout`) + `res.ok` on every fetch.
2. **Validate** external JSON with a schema; cast only trusted data.
3. Model outcomes as discriminated unions / Result types; exhaustive handling.
4. Bounded retries with jittered backoff; fallback chain for real resilience.
5. `Promise.allSettled` + `p-limit` for safe, bounded concurrency.
6. `as const`/`readonly`/`satisfies`/type-predicates; `strict` on.
7. Narrow `unknown` from `catch`; top-level error boundary.
8. Structured logs + which-source-served diagnostics.
