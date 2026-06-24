// All location- and policy-specific knobs in one place.

export const CONFIG = {
  place: "Kościelec (Chrzanów)",
  lat: 50.14,
  lon: 19.42,
  tz: "Europe/Warsaw",

  // powiat chrzanowski — IMGW *meteo* warnings are issued per powiat TERYT.
  terytPowiat: "1203",
  // IMGW *hydro* warnings carry no TERYT (scoped by catchment/voivodeship),
  // so they can only be filtered to the voivodeship. Chrzanów = małopolskie.
  wojewodztwo: "małopolskie",

  // Nearest IMGW synop station (~30 km). Shown as reference context only;
  // NOT blended into the point ensemble, since it's a different location.
  imgwStation: "Kraków",

  forecastDays: 7,

  // Pollen species fetched from the Open-Meteo Air Quality API (CAMS European
  // domain). Olive omitted — Mediterranean, irrelevant at this latitude.
  pollenSpecies: ["alder", "birch", "grass", "mugwort", "ragweed"] as const,

  // Change-detection thresholds. Entries are emitted only when the new reading
  // crosses one of these vs the last *published* baseline (hysteresis — avoids
  // drift spam). Tune to taste.
  thresholds: {
    currentTempC: 3,        // |Δ ensemble median temp| since last entry
    precipOnsetMm: 0.1,     // current precip starts/stops across this
    forecastTMaxC: 3,       // per-day |Δ tmax| to flag a revision
    forecastPrecipProb: 50, // per-day precip prob crossing this → revision
    // UV and pollen are shown on the page/state but do NOT emit entries:
    // UV swings 0↔high every day/night and pollen has no clean band, so
    // triggering on them would flood the feed. Air quality DOES emit, keyed
    // on the European AQI band changing (clean, well-defined boundaries).
  },

  maxEntries: 60,           // Atom ring-buffer length
  sourceTimeoutMs: 8000,

  // One retry on transient failure (timeout / 5xx / 429). Rescues a slow or
  // briefly-unavailable upstream so a single blip doesn't drop a source from
  // the median for the whole 2h window. Does NOT rescue a blown daily quota.
  sourceRetries: 1,
  retryBaseMs: 300,         // backoff base; wait ≈ retryBaseMs * 2^(n-1) + jitter
} as const;

export const SOURCE_LABEL: Record<string, string> = {
  openmeteo: "Open-Meteo",
  openweather: "OpenWeather",
  visualcrossing: "Visual Crossing",
};

export const POLLEN_PL: Record<string, string> = {
  alder: "olcha", birch: "brzoza", grass: "trawy", mugwort: "bylica", ragweed: "ambrozja",
};
