/**
 * status-mcp — one MCP tool that health-checks four trvny projects in a
 * single call: tvpi (IPTV Worker), feeds (hourly RSS/Atom generators), weather
 * (forecast Worker), and autka (used-car aggregator backend).
 *
 * One tool, `status`. Omit `project` to check all four in parallel (the
 * morning-check), or pass one of "tvpi" | "feeds" | "weather" | "autka" to
 * scope it. The point is a single tool invocation, not four — the heavy fetching/parsing
 * happens here at the edge and the model gets a compact roll-up.
 *
 * tvpi, weather, and autka are same-account Workers reached via service bindings;
 * feeds reads GitHub (raw + badge SVG + best-effort contents API). No token — free.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "status-mcp", version: "1.0.0" };
const FETCH_TIMEOUT_MS = 9_000;

/**
 * Service bindings to the three same-account Workers. A public workers.dev fetch
 * from one Worker to another on the same account hairpins and fails, so tvpi,
 * weather, and autka are reached via internal bindings instead. feeds is GitHub
 * (external), so it stays on plain fetch.
 */
interface Env {
  TVPI: Fetcher;
  WEATHER: Fetcher;
  AUTKA: Fetcher;
}

const timeout = (ms: number) => AbortSignal.timeout(ms);
const UA = "status-mcp (+https://github.com/trvny/status-mcp)";

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** pass/fail from an Actions status-badge SVG (CDN — no API rate limit). */
async function badgeStatus(owner: string, repo: string, workflow: string): Promise<string> {
  try {
    const res = await fetch(`https://github.com/${owner}/${repo}/actions/workflows/${workflow}/badge.svg`, {
      headers: { "User-Agent": UA },
      signal: timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return `unknown (HTTP ${res.status})`;
    const m = (await res.text()).match(/<title>[^<]*-\s*([^<]+)<\/title>/);
    return m ? m[1].trim() : "unknown";
  } catch (e) {
    return `unknown (${e instanceof Error ? e.message : String(e)})`;
  }
}

type Verdict = "ok" | "degraded" | "down" | "error";

interface ProjectResult {
  project: string;
  verdict: Verdict;
  headline: string;
  lines: string[];
  data: unknown;
}

// ===========================================================================
// tvpi — read the Worker's X-Source-* headers in one request (service binding)
// ===========================================================================

const TVPI_SLUGS = ["tvp1", "tvp2", "tvpinfo", "tvpsport", "tvpdokument", "tvpnauka", "tvprozrywka", "tvphistoria", "tvpmuzyka"];
type TvpiSource = "cache" | "live" | "d1" | "kv" | "raw" | "r2" | "unknown";

function parseTvpiHeaders(headers: Headers): Map<string, TvpiSource> {
  const map = new Map<string, TvpiSource>();
  for (const layer of ["cache", "live", "d1", "kv", "raw", "r2"] as TvpiSource[]) {
    const raw = headers.get(`X-Source-${layer[0].toUpperCase()}${layer.slice(1)}`);
    if (!raw || raw === "none") continue;
    for (const slug of raw.split(",").map((s) => s.trim()).filter(Boolean)) map.set(slug, layer);
  }
  return map;
}

async function probeTvpi(env: Env, slug: string): Promise<boolean> {
  try {
    const r = await env.TVPI.fetch(`https://tvpi/${slug}.m3u8`, { method: "GET", redirect: "manual", signal: timeout(FETCH_TIMEOUT_MS) });
    return r.status === 302 && !!r.headers.get("Location");
  } catch {
    return false;
  }
}

async function checkTvpi(env: Env, deep: boolean): Promise<ProjectResult> {
  try {
    const res = await env.TVPI.fetch("https://tvpi/playlist.m3u", { signal: timeout(FETCH_TIMEOUT_MS) });
    const sources = res.ok ? parseTvpiHeaders(res.headers) : new Map<string, TvpiSource>();
    const slugs = Array.from(new Set([...TVPI_SLUGS, ...sources.keys()])).sort();

    const channels = await mapWithConcurrency(slugs, 4, async (slug) => {
      const src = sources.get(slug) ?? "unknown";
      const live = src === "live" || src === "cache";
      const fallback = src === "d1" || src === "kv" || src === "raw" || src === "r2";
      const v: Verdict = live ? "ok" : fallback ? "degraded" : "down";
      const probe = deep && v !== "down" ? await probeTvpi(env, slug) : undefined;
      return { slug, source: src, verdict: v, probe };
    });

    const ok = channels.filter((c) => c.verdict === "ok").length;
    const degraded = channels.filter((c) => c.verdict === "degraded").length;
    const down = channels.filter((c) => c.verdict === "down").length;
    const probeFail = channels.filter((c) => c.probe === false).length;
    const verdict: Verdict = down ? "down" : degraded || probeFail ? "degraded" : "ok";

    const lines = channels.map(
      (c) => `    ${c.slug.padEnd(12)} ${c.verdict}${c.source !== "unknown" ? ` (${c.source})` : ""}${c.probe === false ? " probe=FAIL" : ""}`,
    );
    return {
      project: "tvpi",
      verdict,
      headline: `${ok}/${channels.length} ok, ${degraded} degraded, ${down} down`,
      lines,
      data: { channels },
    };
  } catch (e) {
    return errorResult("tvpi", e);
  }
}

// ===========================================================================
// feeds — pipeline badge + best-effort directory cross-check
// ===========================================================================

const FEEDS_OWNER = "trvny";
const FEEDS_REPO = "feeds";
// Feed generators + registry + output XML all live under this subdir.
const FEEDS_SUBDIR = "feedseek";
const FEEDS_RAW = `https://raw.githubusercontent.com/${FEEDS_OWNER}/${FEEDS_REPO}/main`;
const FEEDS_API = `https://api.github.com/repos/${FEEDS_OWNER}/${FEEDS_REPO}`;
const FEEDS_WORKFLOW = "update-feeds.yml";
const TINY_BYTES = 200;

function parseRegistryNames(yaml: string): string[] {
  const names: string[] = [];
  let inFeeds = false;
  let skip = false;
  let indent = 0;
  for (const line of yaml.split("\n")) {
    if (/^feeds:\s*$/.test(line)) { inFeeds = true; continue; }
    if (!inFeeds) continue;
    const key = line.match(/^( {2})("?[\w]+"?|"[^"]+"):\s*$/);
    if (key) { skip = false; indent = key[1].length; names.push(key[2].replace(/"/g, "")); continue; }
    if (!skip && /^\s+enabled:\s*false\b/.test(line) && line.search(/\S/) > indent) { skip = true; names.pop(); }
  }
  return names;
}

async function listFeedFiles(): Promise<Array<{ name: string; size: number }> | null> {
  try {
    const res = await fetch(`${FEEDS_API}/contents/${FEEDS_SUBDIR}/feeds?ref=main`, {
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
      signal: timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ name: string; size: number; type: string }>;
    return json.filter((f) => f.type === "file" && f.name.endsWith(".xml")).map((f) => ({ name: f.name, size: f.size }));
  } catch {
    return null;
  }
}

async function checkFeeds(): Promise<ProjectResult> {
  try {
    const [yamlRes, files, pipeline] = await Promise.all([
      fetch(`${FEEDS_RAW}/${FEEDS_SUBDIR}/feeds.yaml`, { signal: timeout(FETCH_TIMEOUT_MS) }),
      listFeedFiles(),
      badgeStatus(FEEDS_OWNER, FEEDS_REPO, FEEDS_WORKFLOW),
    ]);
    const registered = yamlRes.ok ? parseRegistryNames(await yamlRes.text()) : [];
    const name = (f: string) => f.replace(/^feed_/, "").replace(/\.xml$/, "");

    let missing: string[] = [];
    let tiny: string[] = [];
    let present = 0;
    if (files) {
      const map = new Map(files.map((f) => [name(f.name), f.size]));
      present = map.size;
      missing = registered.filter((n) => !map.has(n)).sort();
      tiny = files.filter((f) => f.size < TINY_BYTES).map((f) => name(f.name)).sort();
    }

    const pipelineOk = pipeline === "passing";
    const verdict: Verdict = !pipelineOk ? "down" : missing.length || tiny.length ? "degraded" : "ok";

    const lines: string[] = [`    pipeline: ${pipeline}`];
    if (files) {
      lines.push(`    files: ${present}/${registered.length} present`);
      if (missing.length) lines.push(`    MISSING: ${missing.join(", ")}`);
      if (tiny.length) lines.push(`    TINY: ${tiny.join(", ")}`);
    } else {
      lines.push(`    registry: ${registered.length} feeds (dir cross-check unavailable — API rate limit)`);
    }
    return {
      project: "feeds",
      verdict,
      headline: `pipeline ${pipeline}` + (files ? `, ${present}/${registered.length} files, ${missing.length} missing` : `, ${registered.length} registered`),
      lines,
      data: { pipeline, registered: registered.length, present, missing, tiny, inventoryAvailable: files !== null },
    };
  } catch (e) {
    return errorResult("feeds", e);
  }
}

// ===========================================================================
// weather — current/forecast freshness and source coverage (service binding)
// ===========================================================================

interface WeatherCycle {
  ok?: boolean;
  completedAt?: string;
  sources?: string[];
  warningsFresh?: string[];
  message?: string;
}

interface WeatherHealth {
  ok?: boolean;
  entries?: number;
  current?: WeatherCycle;
  forecast?: WeatherCycle;
  currentAgeMs?: number | null;
}

async function checkWeather(env: Env): Promise<ProjectResult> {
  try {
    const res = await env.WEATHER.fetch("https://weather/healthz", { signal: timeout(FETCH_TIMEOUT_MS) });
    const health = (await res.json()) as WeatherHealth;
    const sources = health.current?.sources ?? [];
    const warningsFresh = health.current?.warningsFresh ?? [];
    const currentHealthy = res.ok && health.ok === true && health.current?.ok === true;
    const forecastHealthy = health.forecast?.ok === true;
    const partial = sources.length < 2 || warningsFresh.length < 2 || !forecastHealthy;
    const verdict: Verdict = !currentHealthy ? "down" : partial ? "degraded" : "ok";
    const ageMinutes = typeof health.currentAgeMs === "number"
      ? Math.round(health.currentAgeMs / 60_000)
      : null;

    const lines = [
      `    current: ${currentHealthy ? "healthy" : "DOWN"}${ageMinutes !== null ? ` (${ageMinutes} min old)` : ""}`,
      `    sources: ${sources.length ? sources.join(", ") : "none"}`,
      `    warnings fresh: ${warningsFresh.length ? warningsFresh.join(", ") : "none"}`,
      `    forecast: ${forecastHealthy ? "healthy" : "DEGRADED"}`,
      `    entries: ${health.entries ?? "?"}`,
    ];
    return {
      project: "weather",
      verdict,
      headline: `current ${currentHealthy ? "healthy" : "DOWN"}, ${sources.length} sources, forecast ${forecastHealthy ? "healthy" : "degraded"}`,
      lines,
      data: {
        healthy: currentHealthy,
        currentAgeMs: health.currentAgeMs ?? null,
        sources,
        warningsFresh,
        forecastHealthy,
        entries: health.entries ?? null,
      },
    };
  } catch (e) {
    return errorResult("weather", e);
  }
}

// ===========================================================================
// autka — backend /health + /offers count + /sources (service binding) + CI badge
// ===========================================================================

const AUTKA_OWNER = "trvny";
const AUTKA_REPO = "autka";
const AUTKA_WORKFLOW = "android-ci.yml";

async function checkAutka(env: Env): Promise<ProjectResult> {
  try {
    const [healthRes, offersRes, sourcesRes, ci] = await Promise.all([
      env.AUTKA.fetch("https://autka/health", { signal: timeout(FETCH_TIMEOUT_MS) }).catch(() => null),
      env.AUTKA.fetch("https://autka/offers?limit=1", { signal: timeout(FETCH_TIMEOUT_MS) }).catch(() => null),
      env.AUTKA.fetch("https://autka/sources", { signal: timeout(FETCH_TIMEOUT_MS) }).catch(() => null),
      badgeStatus(AUTKA_OWNER, AUTKA_REPO, AUTKA_WORKFLOW),
    ]);

    const healthy = !!healthRes && healthRes.ok;
    let offers: number | null = null;
    if (offersRes && offersRes.ok) {
      const j = (await offersRes.json()) as { count?: number };
      offers = typeof j.count === "number" ? j.count : null;
    }
    let enabled: string[] = [];
    if (sourcesRes && sourcesRes.ok) {
      const j = (await sourcesRes.json()) as { sources?: Array<{ id: string; enabled: boolean }> };
      enabled = (j.sources ?? []).filter((s) => s.enabled).map((s) => s.id);
    }

    const verdict: Verdict = !healthy ? "down" : offers === 0 ? "degraded" : "ok";
    const lines = [
      `    backend: ${healthy ? "healthy" : "DOWN"}`,
      `    offers: ${offers ?? "?"}`,
      `    enabled sources: ${enabled.length ? enabled.join(", ") : "none"}`,
      `    CI: ${ci}`,
    ];
    return {
      project: "autka",
      verdict,
      headline: `backend ${healthy ? "healthy" : "DOWN"}, ${offers ?? "?"} offers, CI ${ci}`,
      lines,
      data: { healthy, offers, enabledSources: enabled, ci },
    };
  } catch (e) {
    return errorResult("autka", e);
  }
}

// ===========================================================================

function errorResult(project: string, e: unknown): ProjectResult {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { project, verdict: "error", headline: `check failed: ${msg}`, lines: [`    ${msg}`], data: { error: msg } };
}

const ALL = ["tvpi", "feeds", "weather", "autka"] as const;
type Project = (typeof ALL)[number];

async function runStatus(env: Env, project: Project | undefined, deep: boolean): Promise<{ text: string; structured: object }> {
  const wanted: Project[] = project ? [project] : [...ALL];
  const runners: Record<Project, () => Promise<ProjectResult>> = {
    tvpi: () => checkTvpi(env, deep),
    feeds: () => checkFeeds(),
    weather: () => checkWeather(env),
    autka: () => checkAutka(env),
  };
  const results = await Promise.all(wanted.map((p) => runners[p]()));

  const icon = (v: Verdict) => (v === "ok" ? "OK" : v === "degraded" ? "DEGRADED" : v === "down" ? "DOWN" : "ERROR");
  const checkedAt = new Date().toISOString();
  const summary = results.map((r) => `${r.project}: ${icon(r.verdict)}`).join("  |  ");
  const blocks = results.map((r) => [`  [${icon(r.verdict)}] ${r.project} — ${r.headline}`, ...r.lines].join("\n"));
  const text = [`status — ${summary}  (${checkedAt})`, "", ...blocks].join("\n");

  const structured = {
    checkedAt,
    overall: results.every((r) => r.verdict === "ok") ? "ok" : "attention",
    projects: Object.fromEntries(results.map((r) => [r.project, { verdict: r.verdict, headline: r.headline, ...(r.data as object) }])),
  };
  return { text, structured };
}

// ===========================================================================
// Tool
// ===========================================================================

const TOOLS = [
  {
    name: "status",
    description:
      "Health-check the trvny projects in one call. Omit project to check " +
      "ALL FOUR in parallel (tvpi IPTV playlist, feeds RSS/Atom pipeline, " +
      "weather forecast Worker, autka car-aggregator backend) and get a compact roll-up — use this for " +
      "a morning check instead of invoking four separate tools. Pass project " +
      "to scope to one. deep=true adds per-channel HLS probes for tvpi. All " +
      "reads are public and free.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", enum: ["tvpi", "feeds", "weather", "autka"], description: "Scope to one project. Omit for all four." },
        deep: { type: "boolean", description: "tvpi only: also probe each channel's .m3u8 redirect. Default false." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
] as const;

// ===========================================================================
// JSON-RPC 2.0 over stateless Streamable HTTP
// ===========================================================================

interface RpcRequest { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> }
const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const err = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

async function handleRpc(req: RpcRequest, env: Env): Promise<object | null> {
  switch (req.method) {
    case "initialize":
      return ok(req.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, { tools: TOOLS });
    case "tools/call": {
      const name = (req.params?.name as string) ?? "";
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      if (name !== "status") return err(req.id, -32602, `Unknown tool: ${name}`);
      try {
        const { text, structured } = await runStatus(env, args.project as Project | undefined, args.deep === true);
        return ok(req.id, { content: [{ type: "text", text }], structuredContent: structured, isError: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return ok(req.id, { content: [{ type: "text", text: `status failed: ${msg}` }], isError: true });
      }
    }
    default:
      return err(req.id, -32601, `Method not found: ${req.method}`);
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
        },
      });
    }
    if (request.method === "GET") {
      return new Response("status-mcp server. POST JSON-RPC to this endpoint.\n", {
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
      });
    }
    if (request.method !== "POST") return new Response("Method not allowed.\n", { status: 405, headers: JSON_HEADERS });

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify(err(null, -32700, "Parse error")), { status: 200, headers: JSON_HEADERS });
    }

    if (Array.isArray(payload)) {
      const responses = (await Promise.all(payload.map((p) => handleRpc(p as RpcRequest, env)))).filter((r): r is object => r !== null);
      return new Response(responses.length ? JSON.stringify(responses) : "", { status: responses.length ? 200 : 202, headers: JSON_HEADERS });
    }
    const response = await handleRpc(payload as RpcRequest, env);
    return new Response(response ? JSON.stringify(response) : "", { status: response ? 200 : 202, headers: JSON_HEADERS });
  },
} satisfies ExportedHandler<Env>;
