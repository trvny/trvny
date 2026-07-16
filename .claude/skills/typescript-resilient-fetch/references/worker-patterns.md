# Worker patterns — annotated extracts

Reference extracts from `trvny/tvpi` `worker/src/index.ts`. These illustrate
the language-level patterns; for the Cloudflare runtime rules they sit inside
(KV write policy, cache TTLs, fallback order), see the `cmd-tvpi-review` and
`tvpi-channel-fix` skills.

## Fixed data: readonly + as const + Map

```ts
interface Channel { id: string; slug: string; name: string; logo: string; group: string; }

const CHANNELS: readonly Channel[] = [
  { id: "399697", slug: "tvp1", name: "TVP 1 HD", logo: TVP_LOGO, group: "Polska" },
  // ...
] as const;

const CHANNEL_BY_SLUG = new Map(CHANNELS.map((c) => [c.slug, c]));
```

## Named constants carry their rationale

```ts
/** Keep BELOW the upstream token lifetime (~15-30 min). 600s = 10 min margin. */
const CACHE_TTL = 600;
/** Bound every upstream fetch so a hung request fails over fast. */
const LIVE_TIMEOUT_MS = 7_000;
const RETRY_ATTEMPTS = 2;
```

The *why* in the comment is the point — a bare `600` invites someone to "tidy"
it into a breaking value.

## Result union

```ts
type Source = "cache" | "live" | "kv" | "raw" | "none";
interface Resolved { url: string | null; source: Source; }
```

## Throw-on-transport / null-on-empty

```ts
async function fetchTvpStreamUrl(channelId: string): Promise<string | null> {
  const res = await fetch(TVP_API_URL.replace("{id}", channelId), {
    headers: TVP_FETCH_HEADERS,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),  // throws AbortError on timeout
  });
  if (!res.ok) return null;
  const data = (await res.json()) as TvpPlaylist;
  return data.sources?.HLS?.[0]?.src ?? null;
}
```

## Retry wrapper

```ts
async function withRetry(
  label: string,
  fn: () => Promise<string | null>,
  attempts = RETRY_ATTEMPTS,
): Promise<string | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await fn();
      if (result) return result;
      log("warn", { msg: "attempt failed", label, error: "empty result", attempt });
    } catch (e) {
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      log("warn", { msg: "attempt failed", label, error, attempt });
    }
  }
  return null;
}
```

## Resolution chain (concurrent across items)

```ts
const results = await Promise.all(
  targets.map(async (ch) => {
    const { url, source } = await getStreamUrl(ch, env, ctx);
    return { ch, url, source };
  }),
);

const valid: Entry[] = results.filter(
  (r): r is { ch: Channel; url: string; source: Source } => r.url !== null,
);
```

## Diagnostic headers per source

```ts
const bySource = (s: Source): string =>
  results.filter((r) => r.source === s).map((r) => r.ch.slug).join(",") || "none";

return new Response(buildM3U(valid), {
  headers: {
    "Content-Type": "application/x-mpegurl",
    "Cache-Control": "no-store",
    "X-Source-Cache": bySource("cache"),
    "X-Source-Live": bySource("live"),
    "X-Source-KV": bySource("kv"),
    "X-Source-Raw": bySource("raw"),
  },
});
```

These headers are how you tell, in production, which tier served each channel.

## Entry point: satisfies + error boundary

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // route, resolve, build, respond
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log("error", { msg: "unhandled error", error: message });
      return new Response("Internal server error.\n", { status: 500 });
    }
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAllStreams(env));
  },
} satisfies ExportedHandler<Env>;
