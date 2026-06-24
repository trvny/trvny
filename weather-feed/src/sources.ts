import { CONFIG } from "./config";
import type {
  AirQuality, Condition, DayForecast, PollenReading, Reading, Warning,
} from "./types";

export interface Env {
  WEATHER_KV: KVNamespace;
  OPENWEATHER_KEY?: string;
  VISUALCROSSING_KEY?: string;
}

// ── shared fetch helper (resilient: timeout + retry/backoff + status check) ──
// Retries transient failures (timeout / 5xx / 429) up to CONFIG.sourceRetries
// with exponential backoff + jitter. Returns null on reached-but-unusable
// (e.g. 401/404 — won't fix itself within a tick); throws after exhausting
// retries so the caller's asNull() logs which source failed and why. JSON is
// validated per-source below, not blindly cast.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CONFIG.sourceRetries; attempt++) {
    if (attempt > 0) {
      await sleep(CONFIG.retryBaseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * CONFIG.retryBaseMs));
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.sourceTimeoutMs) });
      if (res.ok) return res.json();
      if (RETRYABLE_STATUS.has(res.status)) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return null; // reached but unusable — no point retrying
    } catch (e) {
      lastErr = e; // timeout / transport — retry if attempts remain
    }
  }
  throw lastErr ?? new Error(`getJson exhausted: ${url}`);
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
// NOTE: these are hand-rolled guards to stay zero-dependency (tvpi house style).
// Drop-in upgrade per the typescript-resilient-fetch skill: replace each parse
// block with a Zod `safeParse` so an upstream shape change fails cleanly here.

// ── condition normalization ─────────────────────────────────────────────
function wmo(code: number | null): Condition {
  if (code === null) return "unknown";
  if (code === 0) return "clear";
  if (code <= 3) return "clouds";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "storm";
  return "unknown";
}
function owmCond(id: number | null): Condition {
  if (id === null) return "unknown";
  if (id >= 200 && id < 300) return "storm";
  if (id >= 300 && id < 400) return "drizzle";
  if (id >= 500 && id < 600) return "rain";
  if (id >= 600 && id < 700) return "snow";
  if (id >= 700 && id < 800) return "fog";
  if (id === 800) return "clear";
  if (id > 800) return "clouds";
  return "unknown";
}
function vcCond(icon: unknown): Condition {
  const s = String(icon ?? "");
  if (s.includes("thunder")) return "storm";
  if (s.includes("snow")) return "snow";
  if (s.includes("rain")) return "rain";
  if (s.includes("fog")) return "fog";
  if (s.includes("cloud") || s === "wind") return "clouds";
  if (s.includes("clear")) return "clear";
  return "unknown";
}

// ── Open-Meteo (no key) ───────────────────────────────────────────────
export async function fetchOpenMeteo(): Promise<{ current: Reading | null; days: DayForecast[] }> {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(CONFIG.lat));
  u.searchParams.set("longitude", String(CONFIG.lon));
  u.searchParams.set("timezone", CONFIG.tz);
  u.searchParams.set("wind_speed_unit", "ms");
  u.searchParams.set("forecast_days", String(CONFIG.forecastDays));
  u.searchParams.set("current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,uv_index");
  u.searchParams.set("daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,weather_code");

  const data = await getJson(u.toString());
  if (!isObj(data)) return { current: null, days: [] };

  let current: Reading | null = null;
  const c = data["current"];
  if (isObj(c)) {
    current = {
      source: "openmeteo",
      tempC: num(c["temperature_2m"]),
      feelsC: num(c["apparent_temperature"]),
      humidity: num(c["relative_humidity_2m"]),
      pressureHpa: num(c["pressure_msl"]),
      windMs: num(c["wind_speed_10m"]),
      windDir: num(c["wind_direction_10m"]),
      precipMm: num(c["precipitation"]),
      uvIndex: num(c["uv_index"]),
      condition: wmo(num(c["weather_code"])),
      observedAt: typeof c["time"] === "string" ? c["time"] : new Date().toISOString(),
    };
  }

  const days: DayForecast[] = [];
  const d = data["daily"];
  if (isObj(d) && Array.isArray(d["time"])) {
    const time = d["time"] as unknown[];
    const tmax = (d["temperature_2m_max"] ?? []) as unknown[];
    const tmin = (d["temperature_2m_min"] ?? []) as unknown[];
    const psum = (d["precipitation_sum"] ?? []) as unknown[];
    const pprob = (d["precipitation_probability_max"] ?? []) as unknown[];
    const uvmax = (d["uv_index_max"] ?? []) as unknown[];
    const code = (d["weather_code"] ?? []) as unknown[];
    for (let i = 0; i < time.length; i++) {
      days.push({
        source: "openmeteo",
        date: String(time[i]),
        tMaxC: num(tmax[i]), tMinC: num(tmin[i]),
        precipMm: num(psum[i]), precipProb: num(pprob[i]),
        uvIndexMax: num(uvmax[i]),
        condition: wmo(num(code[i])),
      });
    }
  }
  return { current, days };
}

// ── OpenWeather (key; free /data/2.5) ───────────────────────────────────
// No UV on the free /data/2.5 tier (it lived in the deprecated One Call), so
// uvIndex/uvIndexMax are null here — the ensemble just blends the other two.
export async function fetchOpenWeather(env: Env): Promise<{ current: Reading | null; days: DayForecast[] }> {
  const key = env.OPENWEATHER_KEY;
  if (!key) return { current: null, days: [] };
  const q = `lat=${CONFIG.lat}&lon=${CONFIG.lon}&units=metric&appid=${key}`;

  let current: Reading | null = null;
  const w = await getJson(`https://api.openweathermap.org/data/2.5/weather?${q}`);
  if (isObj(w) && isObj(w["main"]) && Array.isArray(w["weather"])) {
    const m = w["main"] as Record<string, unknown>;
    const wind = isObj(w["wind"]) ? w["wind"] : {};
    const wx = w["weather"][0] as Record<string, unknown> | undefined;
    const rain = isObj(w["rain"]) ? w["rain"] : {};
    current = {
      source: "openweather",
      tempC: num(m["temp"]), feelsC: num(m["feels_like"]),
      humidity: num(m["humidity"]), pressureHpa: num(m["pressure"]),
      windMs: num(wind["speed"]), windDir: num(wind["deg"]),
      precipMm: num(rain["1h"]) ?? 0,
      uvIndex: null,
      condition: owmCond(num(wx?.["id"])),
      observedAt: new Date((num(w["dt"]) ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }

  // Free forecast = 5-day / 3-hour. Roll up to daily.
  // CAVEAT: dt_txt is UTC, so daily buckets are UTC days, not Europe/Warsaw.
  const days: DayForecast[] = [];
  const f = await getJson(`https://api.openweathermap.org/data/2.5/forecast?${q}`);
  if (isObj(f) && Array.isArray(f["list"])) {
    type Bucket = { max: number; min: number; precip: number; prob: number; conds: Condition[] };
    const byDay = new Map<string, Bucket>();
    for (const slot of f["list"] as unknown[]) {
      if (!isObj(slot)) continue;
      const date = String(slot["dt_txt"] ?? "").slice(0, 10);
      if (!date) continue;
      const m = isObj(slot["main"]) ? slot["main"] : {};
      const wx = Array.isArray(slot["weather"]) ? (slot["weather"][0] as Record<string, unknown>) : undefined;
      const rain = isObj(slot["rain"]) ? slot["rain"] : {};
      const snow = isObj(slot["snow"]) ? slot["snow"] : {};
      const t = num(m["temp"]) ?? NaN;
      const b = byDay.get(date) ?? { max: -Infinity, min: Infinity, precip: 0, prob: 0, conds: [] };
      if (Number.isFinite(t)) { b.max = Math.max(b.max, t); b.min = Math.min(b.min, t); }
      b.precip += (num(rain["3h"]) ?? 0) + (num(snow["3h"]) ?? 0);
      b.prob = Math.max(b.prob, (num(slot["pop"]) ?? 0) * 100);
      b.conds.push(owmCond(num(wx?.["id"])));
      byDay.set(date, b);
    }
    for (const [date, b] of byDay) {
      days.push({
        source: "openweather", date,
        tMaxC: b.max === -Infinity ? null : Math.round(b.max * 10) / 10,
        tMinC: b.min === Infinity ? null : Math.round(b.min * 10) / 10,
        precipMm: Math.round(b.precip * 10) / 10,
        precipProb: Math.round(b.prob),
        uvIndexMax: null,
        condition: b.conds[0] ?? "unknown",
      });
    }
  }
  return { current, days };
}

// ── Visual Crossing (key; one call gives current + days) ─────────────────────
export async function fetchVisualCrossing(env: Env): Promise<{ current: Reading | null; days: DayForecast[] }> {
  const key = env.VISUALCROSSING_KEY;
  if (!key) return { current: null, days: [] };
  const u = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${CONFIG.lat},${CONFIG.lon}`
    + `?unitGroup=metric&include=current,days&key=${key}&contentType=json`;

  const data = await getJson(u);
  if (!isObj(data)) return { current: null, days: [] };

  let current: Reading | null = null;
  const cc = data["currentConditions"];
  if (isObj(cc)) {
    const windKmh = num(cc["windspeed"]); // metric = km/h
    current = {
      source: "visualcrossing",
      tempC: num(cc["temp"]), feelsC: num(cc["feelslike"]),
      humidity: num(cc["humidity"]), pressureHpa: num(cc["pressure"]),
      windMs: windKmh === null ? null : Math.round((windKmh / 3.6) * 10) / 10,
      windDir: num(cc["winddir"]),
      precipMm: num(cc["precip"]) ?? 0,
      uvIndex: num(cc["uvindex"]),
      condition: vcCond(cc["icon"]),
      observedAt: typeof cc["datetimeEpoch"] === "number"
        ? new Date(cc["datetimeEpoch"] * 1000).toISOString() : new Date().toISOString(),
    };
  }

  const days: DayForecast[] = [];
  if (Array.isArray(data["days"])) {
    for (const d of (data["days"] as unknown[]).slice(0, CONFIG.forecastDays)) {
      if (!isObj(d)) continue;
      days.push({
        source: "visualcrossing",
        date: String(d["datetime"]),
        tMaxC: num(d["tempmax"]), tMinC: num(d["tempmin"]),
        precipMm: num(d["precip"]) ?? 0, precipProb: num(d["precipprob"]),
        uvIndexMax: num(d["uvindex"]),
        condition: vcCond(d["icon"]),
      });
    }
  }
  return { current, days };
}

// ── Open-Meteo Air Quality (no key; CAMS European domain) ────────────────────
// Single provider — not blended. European AQI + PM + tree/grass/weed pollen.
// Pollen is CAMS-Europe only, which covers PL fine.
export async function fetchOpenMeteoAirQuality(): Promise<AirQuality | null> {
  const u = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  u.searchParams.set("latitude", String(CONFIG.lat));
  u.searchParams.set("longitude", String(CONFIG.lon));
  u.searchParams.set("timezone", CONFIG.tz);
  const pollenParams = CONFIG.pollenSpecies.map((s) => `${s}_pollen`).join(",");
  u.searchParams.set("current", `european_aqi,pm2_5,pm10,${pollenParams}`);

  const data = await getJson(u.toString());
  if (!isObj(data)) return null;
  const c = data["current"];
  if (!isObj(c)) return null;

  const pollen: PollenReading[] = [];
  for (const s of CONFIG.pollenSpecies) {
    const g = num(c[`${s}_pollen`]);
    if (g !== null && g > 0) pollen.push({ species: s, grains: Math.round(g) });
  }
  pollen.sort((a, b) => b.grains - a.grains);

  return {
    observedAt: typeof c["time"] === "string" ? c["time"] : new Date().toISOString(),
    europeanAqi: num(c["european_aqi"]),
    pm25: num(c["pm2_5"]),
    pm10: num(c["pm10"]),
    pollen,
    topPollen: pollen[0] ?? null,
  };
}

// ── IMGW: official warnings (high-value, event-shaped) ──────────────────────
// Two endpoints, same record shape (confirmed live against warningshydro):
//   zdarzenie, stopien (the live key is "stopień" with the diacritic),
//   prawdopodobienstwo, data_od, data_do, numer, przebieg/komentarz, obszary[].
//   None-active → { status:false }.
// Geographic scope differs:
//   meteo → obszary[].teryt[] powiat codes (precise to Chrzanów = 1203)
//   hydro → no teryt; obszary[].wojewodztwo only (regional, małopolskie)
type WarnCat = "meteo" | "hydro";

function matchesArea(w: Record<string, unknown>): boolean {
  const teryts: string[] = [];
  const wojs: string[] = [];
  const top = w["teryt"];
  if (Array.isArray(top)) teryts.push(...top.map(String));
  const obszary = w["obszary"];
  if (Array.isArray(obszary)) {
    for (const o of obszary) {
      if (!isObj(o)) continue;
      const t = o["teryt"];
      if (Array.isArray(t)) teryts.push(...t.map(String));
      if (o["wojewodztwo"] != null) wojs.push(String(o["wojewodztwo"]));
    }
  }
  if (w["wojewodztwo"] != null) wojs.push(String(w["wojewodztwo"]));
  // Precise powiat match when TERYT exists (meteo); voivodeship fallback only
  // when there is no TERYT at all (hydro).
  if (teryts.some((c) => c.startsWith(CONFIG.terytPowiat))) return true;
  if (teryts.length === 0 && wojs.some((v) => v.toLowerCase() === CONFIG.wojewodztwo.toLowerCase())) return true;
  return false;
}

function parseWarnings(data: unknown, category: WarnCat): Warning[] {
  if (!Array.isArray(data)) return []; // {status:false} object → none active
  const out: Warning[] = [];
  for (const w of data) {
    if (!isObj(w) || !matchesArea(w)) continue;
    const pick = (...keys: string[]): unknown => keys.map((k) => w[k]).find((v) => v != null);
    const numer = String(pick("numer", "nr", "id") ?? "");
    const event = String(pick("zdarzenie", "nazwa_zdarzenia", "nazwa") ?? "Ostrzeżenie");
    const from = (pick("data_od", "obowiazuje_od", "od") as string) ?? null;
    out.push({
      category,
      id: `${category}:${numer || `${event}-${from ?? ""}`}`,
      event,
      level: num(pick("stopień", "stopien", "Stopien")),
      probability: num(pick("prawdopodobienstwo", "Prawdopodobienstwo")),
      from,
      to: (pick("data_do", "obowiazuje_do", "do") as string) ?? null,
      content: String(pick("przebieg", "tresc", "Tresc", "komentarz") ?? ""),
    });
  }
  return out;
}

export async function fetchImgwWarnings(): Promise<Warning[]> {
  const base = "https://danepubliczne.imgw.pl/api/data/";
  const [meteo, hydro] = await Promise.all([
    getJson(`${base}warningsmeteo`).then((d) => parseWarnings(d, "meteo")).catch(() => []),
    getJson(`${base}warningshydro`).then((d) => parseWarnings(d, "hydro")).catch(() => []),
  ]);
  return [...meteo, ...hydro];
}

// Nearest synop station — reference context only, not blended into the ensemble.
export async function fetchImgwStation(name: string): Promise<Reading | null> {
  const data = await getJson("https://danepubliczne.imgw.pl/api/data/synop");
  if (!Array.isArray(data)) return null;
  const s = (data as unknown[]).find(
    (x) => isObj(x) && String(x["stacja"]).toLowerCase().includes(name.toLowerCase()),
  );
  if (!isObj(s)) return null;
  const at = `${String(s["data_pomiaru"])}T${String(s["godzina_pomiaru"]).padStart(2, "0")}:00:00`;
  return {
    source: "openmeteo", // placeholder tag; station is shown separately, never blended
    tempC: num(s["temperatura"]), feelsC: null,
    humidity: num(s["wilgotnosc_wzgledna"]), pressureHpa: num(s["cisnienie"]),
    windMs: num(s["predkosc_wiatru"]), windDir: num(s["kierunek_wiatru"]),
    precipMm: num(s["suma_opadu"]), uvIndex: null, condition: "unknown",
    observedAt: at,
  };
}
