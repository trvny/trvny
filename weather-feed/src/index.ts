import { CONFIG } from "./config";
import { renderPage } from "./page";
import { buildDayEnsembles, buildEnsemble } from "./ensemble";
import {
  airQualityChange, currentChange, forecastRevision, renderAtom, warningEntries,
} from "./feed";
import {
  type Env, fetchImgwStation, fetchImgwWarnings, fetchOpenMeteo,
  fetchOpenMeteoAirQuality, fetchOpenWeather, fetchVisualCrossing,
} from "./sources";
import type {
  AirQuality, CurrentState, DayEnsemble, Ensemble, FeedEntry, Reading, SourceId, Warning,
} from "./types";

// KV keys. Writes happen ONLY in scheduled() — request path is read-only,
// matching the tvpi free-tier write discipline (~1k KV writes/day).
const K = {
  entries: "entries",
  baselineCurrent: "baseline:current",
  baselineForecast: "baseline:forecast",
  baselineAir: "baseline:air",
  warnings: "warnings:active",
  current: "state:current",
  lastGood: "lastgood:current",
} as const;

// Point sources eligible for the last-good fallback (keyless OM rarely drops;
// the keyed two are the ones that blip out — see runCurrent).
const POINT_SOURCES: readonly SourceId[] = ["openmeteo", "openweather", "visualcrossing"];
type LastGood = Partial<Record<SourceId, { reading: Reading; storedAt: number }>>;

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

// ── current cycle: every 2h. Point ensemble + air quality + IMGW warnings ────
async function runCurrent(env: Env): Promise<void> {
  const [om, ow, vc, air, warnings, station] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
    fetchOpenMeteoAirQuality().catch(asNull("airquality")),
    fetchImgwWarnings().catch(() => [] as Warning[]),
    fetchImgwStation(CONFIG.imgwStation).catch(() => null),
  ]);

  const liveReadings = [om?.current, ow?.current, vc?.current]
    .filter((r): r is Reading => r != null);

  // Last-good fallback: for any point source that failed THIS tick, reuse its
  // previous reading from KV (when fresh enough) so a single blip doesn't shrink
  // the median. Live readings refresh the cache; cached fill-ins don't, so a
  // persistently-dead source ages out of the cache and drops. See
  // CONFIG.lastGoodMaxAgeMs.
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
      await env.WEATHER_KV.put(K.baselineCurrent, JSON.stringify(ensemble)); // bump baseline only on emit
    }
  }

  // Air quality: emit only on AQI band change, baseline bumped on emit.
  if (air) {
    const prevAir = await load<AirQuality>(env, K.baselineAir);
    const entry = airQualityChange(prevAir, air);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineAir, JSON.stringify(air));
    }
  }

  const prevWarnings = (await load<Warning[]>(env, K.warnings)) ?? [];
  fresh.push(...warningEntries(prevWarnings, warnings));
  await env.WEATHER_KV.put(K.warnings, JSON.stringify(warnings));

  // Persist the latest snapshot for the page / state.json. Keep a prior ensemble
  // if this cycle somehow had no point readings, so the page never goes blank.
  if (ensemble) {
    const state: CurrentState = { ensemble, warnings, airQuality: air, imgwStation: station };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  } else if (air) {
    const prevState = await load<CurrentState>(env, K.current);
    if (prevState) await env.WEATHER_KV.put(K.current, JSON.stringify({ ...prevState, warnings, airQuality: air }));
  }

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
    const url = new URL(req.url);
    const { pathname, origin } = url;
    const entries = (await load<FeedEntry[]>(env, K.entries)) ?? [];

    switch (pathname) {
      case "/feed.atom":
        return atom(renderAtom(entries, `Pogoda — ${CONFIG.place}`, origin));
      case "/warnings.atom":
        return atom(renderAtom(
          entries.filter((e) => e.kind === "warning_new" || e.kind === "warning_lifted"),
          `Ostrzeżenia IMGW — ${CONFIG.place}`, origin));
      case "/state.json": {
        const state = await load<CurrentState>(env, K.current);
        return json({ place: CONFIG.place, ...state, entryCount: entries.length });
      }
      case "/healthz":
        return json({ ok: true, entries: entries.length });
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
      case "/":
        return new Response(renderPage(origin), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=3600" },
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
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "max-age=600",
      "access-control-allow-origin": "*",
    },
  });
}
function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}
