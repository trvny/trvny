# weather-feed

Multi-source weather aggregator for **Kościelec (Chrzanów)**, 50.14 N / 19.42 E,
served as an Atom feed of *changes* — not a firehose of identical readings.

## What it does

- **Ensemble**, not concatenation. Three point sources (Open-Meteo, OpenWeather,
  Visual Crossing) are normalized to common units, then reduced to a **median +
  spread** per variable. The spread is the signal: "all three say 18°" vs
  "range 14–22°" is the thing no single API tells you.
- **IMGW warnings** are the high-value, genuinely event-shaped content — new and
  lifted warnings each get an entry. Two endpoints:
  - **meteo** — filtered precisely to powiat chrzanowski (TERYT `1203`);
  - **hydro** — carries no TERYT, so filtered to voivodeship (małopolskie). These
    are regional by nature (drought/flood per catchment), so a małopolskie
    drought warning will surface even if its catchment isn't right at Chrzanów.
- **Entries only on change.** Hysteresis vs the last *published* baseline, so
  small drift doesn't spam the feed:
  - current: condition flips, |Δtemp| ≥ 3 °C, or precip starts/stops;
  - forecast: a day's max moves ≥ 3 °C or precip-prob crosses 50 %.
- IMGW's nearest synop (Kraków, ~30 km) is shown in `/state.json` as reference
  context but **not** blended into the point ensemble — wrong location.

## Schedule

| cron | cycle |
|---|---|
| `0 */2 * * *` | current conditions + IMGW warnings |
| `0 5 * * *`   | daily forecast revision check |

## Endpoints

- `GET /feed.atom` — all change entries
- `GET /warnings.atom` — IMGW warnings only
- `GET /state.json` — latest ensemble + active warnings + synop reference
- `GET /healthz`, `GET /`

Served read-only from KV; KV is written **only** by the cron (tvpi free-tier
write discipline).

## Setup

```sh
npm install
wrangler kv namespace create WEATHER_KV     # paste id into wrangler.jsonc
wrangler secret put OPENWEATHER_KEY
wrangler secret put VISUALCROSSING_KEY
npm run typecheck
wrangler deploy
```

Open-Meteo and IMGW need no key. Without the two secrets the worker still runs
on Open-Meteo alone (degraded ensemble, n=1). CI deploy needs repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (already used by status-mcp).

## Known caveats (flagged, not hidden)

- **OpenWeather free forecast** is 5-day/3-hour bucketed to **UTC** days, so its
  daily max/min are off by the UTC↔Warsaw offset. Acceptable for a 3-source
  median; fix by bucketing on `Europe/Warsaw` if it matters.
- **IMGW warning field names** — the hydro shape is confirmed live (`zdarzenie`,
  `stopień`, `data_od/do`, `obszary[]`). Meteo shares it but had no active
  warning to confirm against; the parser reads keys with fallbacks. Verify
  meteo's `obszary[].teryt` against a live stopień-2 event and tighten if needed.
- **Validation** is hand-rolled guards (zero-dep, tvpi style). Upgrade per the
  `typescript-resilient-fetch` skill: swap each parse block for a Zod
  `safeParse` so an upstream shape change fails cleanly at the edge.
- Free-tier quotas are the binding constraint — Visual Crossing 1000 records/day
  and OpenWeather call caps. At 12 current + 1 forecast cycles/day you're far
  under, but check before raising frequency.
