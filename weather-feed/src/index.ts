import { CONFIG } from "./config";
import { buildDayEnsembles, buildEnsemble } from "./ensemble";
import {
  currentChange, forecastRevision, renderAtom, warningEntries,
} from "./feed";
import {
  type Env, fetchImgwStation, fetchImgwWarnings,
  fetchOpenMeteo, fetchOpenWeather, fetchVisualCrossing,
} from "./sources";
import type {
  CurrentState, DayEnsemble, Ensemble, FeedEntry, Reading, Warning,
} from "./types";

// KV keys. Writes happen ONLY in scheduled() — request path is read-only,
// matching the tvpi free-tier write discipline (~1k KV writes/day).
const K = {
  entries: "entries",
  baselineCurrent: "baseline:current",
  baselineForecast: "baseline:forecast",
  warnings: "warnings:active",
  current: "state:current",
} as const;

async function load<T>(env: Env, key: string): Promise<T | null> {
  return env.WEATHER_KV.get(key, "json") as Promise<T | null>;
}

function log(level: "info" | "warn" | "error", fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, ...fields }));
}

async function pushEntries(env: Env, fresh: FeedEntry[]): Promise<void> {
  if (fresh.length === 0) return;
  const existing = (await load<FeedEntry[]>(env, K.entries)) ?? [];
  const merged = [...fresh, ...existing].slice(0, CONFIG.maxEntries);
  await env.WEATHER_KV.put(K.entries, JSON.stringify(merged));
  log("info", { msg: "entries appended", added: fresh.length, total: merged.length });
}

// ── current cycle: every 2h. Point ensemble + IMGW warnings + change detect ──
async function runCurrent(env: Env): Promise<void> {
  const [om, ow, vc, warnings, station] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
    fetchImgwWarnings().catch(() => [] as Warning[]),
    fetchImgwStation(CONFIG.imgwStation).catch(() => null),
  ]);

  const readings = [om?.current, ow?.current, vc?.current]
    .filter((r): r is Reading => r != null);
  log("info", { msg: "current sources", n: readings.length, sources: readings.map((r) => r.source) });

  const fresh: FeedEntry[] = [];

  if (readings.length > 0) {
    const ensemble = buildEnsemble(readings);
    const prev = await load<Ensemble>(env, K.baselineCurrent);
    const entry = currentChange(prev, ensemble);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineCurrent, JSON.stringify(ensemble)); // bump baseline only on emit
    }
    const state: CurrentState = { ensemble, warnings, imgwStation: station };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  }

  const prevWarnings = (await load<Warning[]>(env, K.warnings)) ?? [];
  fresh.push(...warningEntries(prevWarnings, warnings));
  await env.WEATHER_KV.put(K.warnings, JSON.stringify(warnings));

  await pushEntries(env, fresh);
}

// ── forecast cycle: once a day. Daily ensemble + revision detect ─────────────
async function runForecast(env: Env): Promise<void> {
  const [om, ow, vc] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
  ]);

  const perSource = [om?.days ?? [], ow?.days ?? [], vc?.days ?? []].filter((d) => d.length > 0);
  if (perSource.length === 0) { log("warn", { msg: "no forecast sources" }); return; }

  const next = buildDayEnsembles(perSource);
  const prev = await load<DayEnsemble[]>(env, K.baselineForecast);
  const entry = forecastRevision(prev, next);
  if (entry) {
    await env.WEATHER_KV.put(K.baselineForecast, JSON.stringify(next));
    await pushEntries(env, [entry]);
  }
}

function asNull(source: string) {
  return (e: unknown) => {
    log("warn", { msg: "source failed", source, error: e instanceof Error ? e.message : String(e) });
    return null;
  };
}

// ── HTTP: serve pre-built entries from KV (read-only, no upstream fan-out) ───
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    const entries = (await load<FeedEntry[]>(env, K.entries)) ?? [];

    switch (pathname) {
      case "/feed.atom":
        return atom(renderAtom(entries, `Pogoda — ${CONFIG.place}`));
      case "/warnings.atom":
        return atom(renderAtom(
          entries.filter((e) => e.kind === "warning_new" || e.kind === "warning_lifted"),
          `Ostrzeżenia IMGW — ${CONFIG.place}`));
      case "/state.json": {
        const state = await load<CurrentState>(env, K.current);
        return json({ place: CONFIG.place, ...state, entryCount: entries.length });
      }
      case "/healthz":
        return json({ ok: true, entries: entries.length });
      case "/":
        return json({
          place: CONFIG.place, lat: CONFIG.lat, lon: CONFIG.lon,
          feeds: ["/feed.atom", "/warnings.atom", "/state.json"],
        });
      default:
        return new Response("not found", { status: 404 });
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // "0 5 * * *" = daily forecast cycle; anything else = the 2h current cycle.
    const job = event.cron === "0 5 * * *" ? runForecast(env) : runCurrent(env);
    ctx.waitUntil(job.catch((e) => log("error", { msg: "cron failed", cron: event.cron, error: String(e) })));
  },
};

function atom(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "max-age=600" },
  });
}
function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
