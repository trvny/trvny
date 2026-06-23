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
  uvIndex: number | null;      // 0–11+
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
  uvIndexMax: number | null;   // 0–11+
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
  uv: Stat;
  condition: Condition;        // majority vote, severity tie-break
  sources: SourceId[];
}

export interface DayEnsemble {
  date: string;
  tMaxC: Stat;
  tMinC: Stat;
  precipMm: Stat;
  precipProb: Stat;
  uvMax: Stat;
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

// Single-source (Open-Meteo / CAMS) air-quality + pollen snapshot. NOT an
// ensemble — only one provider exposes CAMS, so there's nothing to blend.
export interface PollenReading {
  species: string;             // key: alder|birch|grass|mugwort|ragweed
  grains: number;              // grains/m³
}
export interface AirQuality {
  observedAt: string;
  europeanAqi: number | null;  // 0–100+ (banded)
  pm25: number | null;         // µg/m³
  pm10: number | null;         // µg/m³
  pollen: PollenReading[];     // species with a positive concentration
  topPollen: PollenReading | null;
}

export type EntryKind =
  | "warning_new" | "warning_lifted"
  | "current_change" | "forecast_revision"
  | "air_quality_change";

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
  airQuality: AirQuality | null;
  imgwStation: Reading | null; // nearest synop, reference only
}
