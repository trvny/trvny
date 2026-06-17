// Normalized internal model. Every source is converted to SI-ish units at the
// boundary: temperature °C, wind m/s, pressure hPa (sea-level), precip mm.

export type Condition =
  | "clear" | "clouds" | "fog" | "drizzle"
  | "rain" | "snow" | "storm" | "unknown";

// Point-forecast sources that get blended into the ensemble.
export type SourceId = "openmeteo" | "openweather" | "visualcrossing";

export interface Reading {
  source: SourceId;
  tempC: number | null;
  feelsC: number | null;
  humidity: number | null;     // %
  pressureHpa: number | null;  // sea-level
  windMs: number | null;
  windDir: number | null;      // degrees
  precipMm: number | null;     // last hour
  condition: Condition;
  observedAt: string;          // ISO
}

export interface DayForecast {
  source: SourceId;
  date: string;                // YYYY-MM-DD (local)
  tMaxC: number | null;
  tMinC: number | null;
  precipMm: number | null;
  precipProb: number | null;   // %
  condition: Condition;
}

export interface Stat {
  median: number | null;
  min: number | null;
  max: number | null;
  n: number;                   // how many sources contributed
}

export interface Ensemble {
  observedAt: string;
  tempC: Stat;
  feelsC: Stat;
  humidity: Stat;
  pressureHpa: Stat;
  windMs: Stat;
  precipMm: Stat;
  condition: Condition;        // majority vote, severity tie-break
  sources: SourceId[];
}

export interface DayEnsemble {
  date: string;
  tMaxC: Stat;
  tMinC: Stat;
  precipMm: Stat;
  precipProb: Stat;
  condition: Condition;
  sources: SourceId[];
}

// IMGW official warning (meteo = powiat-scoped, hydro = voivodeship-scoped).
// The high-value, event-shaped feed.
export interface Warning {
  id: string;
  category: "meteo" | "hydro";
  event: string;
  level: number | null;        // stopień 1–3
  probability: number | null;  // %
  from: string | null;         // ISO
  to: string | null;           // ISO
  content: string;
}

export type EntryKind =
  | "warning_new" | "warning_lifted"
  | "current_change" | "forecast_revision";

export interface FeedEntry {
  id: string;                  // stable tag: URI
  kind: EntryKind;
  title: string;
  summary: string;
  published: string;           // ISO
}

export interface CurrentState {
  ensemble: Ensemble;
  warnings: Warning[];
  imgwStation: Reading | null; // nearest synop, reference only
}
