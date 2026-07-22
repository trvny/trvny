import { CONFIG } from "./config";
import { renderPage } from "./page";
import { buildDayEnsembles, buildEnsemble } from "./ensemble";
import {
  airQualityChange, currentChange, FEED_ID, forecastRevision, renderAtom, warningEntries,
} from "./feed";
import {
  type Env, fetchImgwStation, fetchImgwWarnings, fetchOpenMeteo,
  fetchOpenMeteoAirQuality, fetchOpenWeather, fetchVisualCrossing,
} from "./sources";
import type {
  AirQuality, CurrentState, DayEnsemble, Ensemble, FeedEntry, Reading, SourceId, Warning,
} from "./types";
import { reconcileWarnings } from "./warnings";

const K = {
  entries: "entries",
  baselineCurrent: "baseline:current",
  baselineForecast: "baseline:forecast",
  baselineAir: "baseline:air",
  warnings: "warnings:active",
  current: "state:current",
  lastGood: "lastgood:current",
  statusCurrent: "status:current",
  statusForecast: "status:forecast",
} as const;

const POINT_SOURCES: readonly SourceId[] = ["openmeteo", "openweather", "visualcrossing"];
type LastGood = Partial<Record<SourceId, { reading: Reading; storedAt: number }>>;
interface CycleStatus {
  ok: boolean;
  completedAt: string;
  sources?: SourceId[];
  warningsFresh?: ("meteo" | "hydro")[];
  message?: string;
}

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

async function runCurrent(env: Env): Promise<void> {
  const [om, ow, vc, air, warningFetch, station] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
    fetchOpenMeteoAirQuality().catch(asNull("airquality")),
    fetchImgwWarnings().catch(asNull("imgw-warnings")),
    fetchImgwStation(CONFIG.imgwStation).catch(asNull("imgw-station")),
  ]);

  const liveReadings = [om?.current, ow?.current, vc?.current]
    .filter((r): r is Reading => r != null);

  const now = Date.now();
  const cache = (await load<LastGood>(env, K.lastGood)) ?? {};
  const readings: Reading[] = [...liveReadings];
  for (const id of POINT_SOURCES) {
    if (readings.some((r) => r.source === id)) continue;
    const hit = cache[id];
    if (hit && now - hit.storedAt <= CONFIG.lastGoodMaxAgeMs) {
      readings.push(hit.reading);
      log("info", { msg: "source from cache", source: id, ageMs: now - hit.storedAt });
    }
  }
  if (liveReadings.length > 0) {
    const next: LastGood = { ...cache };
    for (const r of liveReadings) next[r.source] = { reading: r, storedAt: now };
    await env.WEATHER_KV.put(K.lastGood, JSON.stringify(next));
  }
  log("info", { msg: "current sources", n: readings.length, sources: readings.map((r) => r.source) });

  const fresh: FeedEntry[] = [];
  let ensemble: Ensemble | null = null;

  if (readings.length > 0) {
    ensemble = buildEnsemble(readings);
    const prev = await load<Ensemble>(env, K.baselineCurrent);
    const entry = currentChange(prev, ensemble);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineCurrent, JSON.stringify(ensemble));
    }
  }

  if (air) {
    const prevAir = await load<AirQuality>(env, K.baselineAir);
    const entry = airQualityChange(prevAir, air);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineAir, JSON.stringify(air));
    }
  }

  const prevWarnings = (await load<Warning[]>(env, K.warnings)) ?? [];
  let warnings = prevWarnings;
  if (warningFetch && warningFetch.succeeded.length > 0) {
    warnings = reconcileWarnings(prevWarnings, warningFetch);
    fresh.push(...warningEntries(prevWarnings, warnings));
    await env.WEATHER_KV.put(K.warnings, JSON.stringify(warnings));
  } else {
    log("warn", { msg: "IMGW warnings unavailable; preserving previous state" });
  }

  const prevState = await load<CurrentState>(env, K.current);
  if (ensemble) {
    const state: CurrentState = {
      ensemble,
      warnings,
      airQuality: air ?? prevState?.airQuality ?? null,
      imgwStation: station ?? prevState?.imgwStation ?? null,
    };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  } else if (prevState) {
    const state: CurrentState = {
      ...prevState,
      warnings,
      airQuality: air ?? prevState.airQuality,
      imgwStation: station ?? prevState.imgwStation,
    };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  }

  await pushEntries(env, fresh);
  const status: CycleStatus = {
    ok: liveReadings.length > 0,
    completedAt: new Date().toISOString(),
    sources: liveReadings.map((reading) => reading.source),
    warningsFresh: warningFetch?.succeeded ?? [],
  };
  await env.WEATHER_KV.put(K.statusCurrent, JSON.stringify(status));
}

async function runForecast(env: Env): Promise<void> {
  const [om, ow, vc] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
  ]);

  const perSource = [om?.days ?? [], ow?.days ?? [], vc?.days ?? []].filter((d) => d.length > 0);
  if (perSource.length === 0) {
    log("warn", { msg: "no forecast sources" });
    const status: CycleStatus = { ok: false, completedAt: new Date().toISOString(), message: "no forecast sources" };
    await env.WEATHER_KV.put(K.statusForecast, JSON.stringify(status));
    return;
  }

  const next = buildDayEnsembles(perSource);
  const prev = await load<DayEnsemble[]>(env, K.baselineForecast);
  const entry = forecastRevision(prev, next);
  if (entry) {
    await env.WEATHER_KV.put(K.baselineForecast, JSON.stringify(next));
    await pushEntries(env, [entry]);
  }
  const sources = [om, ow, vc]
    .flatMap((result) => result?.days[0]?.source ? [result.days[0].source] : []);
  const status: CycleStatus = { ok: true, completedAt: new Date().toISOString(), sources };
  await env.WEATHER_KV.put(K.statusForecast, JSON.stringify(status));
}

function asNull(source: string) {
  return (e: unknown) => {
    log("warn", { msg: "source failed", source, error: e instanceof Error ? e.message : String(e) });
    return null;
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname, origin } = url;
    const entries = (await load<FeedEntry[]>(env, K.entries)) ?? [];

    switch (pathname) {
      case "/feed.atom":
        return atom(renderAtom(entries, `Pogoda — ${CONFIG.place}`, origin, "/feed.atom", FEED_ID));
      case "/warnings.atom":
        return atom(renderAtom(
          entries.filter((e) => e.kind === "warning_new" || e.kind === "warning_lifted"),
          `Ostrzeżenia IMGW — ${CONFIG.place}`,
          origin,
          "/warnings.atom",
          `${FEED_ID}:warnings`,
        ));
      case "/state.json": {
        const state = await load<CurrentState>(env, K.current);
        return json({ place: CONFIG.place, ...state, entryCount: entries.length });
      }
      case "/healthz": {
        const [current, forecast] = await Promise.all([
          load<CycleStatus>(env, K.statusCurrent),
          load<CycleStatus>(env, K.statusForecast),
        ]);
        const currentAgeMs = current ? Date.now() - Date.parse(current.completedAt) : null;
        const healthy = Boolean(current?.ok && currentAgeMs !== null && currentAgeMs <= CONFIG.currentStaleAfterMs);
        return json({ ok: healthy, entries: entries.length, current, forecast, currentAgeMs }, healthy ? 200 : 503);
      }
      case "/robots.txt":
        return new Response(
          `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
          { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "max-age=86400" } },
        );
      case "/sitemap.xml":
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>\n`
          + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
          + `  <url><loc>${origin}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`
          + `  <url><loc>${origin}/feed.atom</loc><changefreq>hourly</changefreq></url>\n`
          + `  <url><loc>${origin}/warnings.atom</loc><changefreq>hourly</changefreq></url>\n`
          + `</urlset>\n`,
          { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "max-age=86400" } },
        );
      case "/": {
        const state = await load<CurrentState>(env, K.current);
        return new Response(renderPage(origin, state, entries), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300, stale-while-revalidate=600",
          },
        });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = event.cron === "0 5 * * *" ? runForecast(env) : runCurrent(env);
    ctx.waitUntil(job.catch((e) => log("error", { msg: "cron failed", cron: event.cron, error: String(e) })));
  },
};

function atom(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "max-age=600",
      "access-control-allow-origin": "*",
    },
  });
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
