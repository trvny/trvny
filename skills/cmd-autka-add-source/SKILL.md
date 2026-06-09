---
name: cmd-autka-add-source
description: Add a new car marketplace/source to the travino/autka project end-to-end. Because autka aggregates server-side, a "source" is now a backend ingest adapter — a new IngestSource in backend/src/ingest/sources/, registered in runner.ts's ALL_SOURCES — NOT an app-side Hilt binding. Use whenever the user wants to add a marketplace/feed/source (Otomoto, OLX, a US auction, a dealer feed, an import company), mentions "add a source", "ingest X", "pull listings from Y", "wire up the Otomoto feed", or points at the autka repo wanting a new place to get offers from. Keep the CarOffer shape in lib/types.ts and com.autka.core.model.CarOffer in sync, and never add scraping — sources stay disabled until a compliant feed exists.
license: Complete terms in LICENSE.txt
---

# Add a Source (travino/autka)

> **In claude.ai chat.** The repo isn't on disk here and `wrangler`/`gh` aren't authenticated. Two ways to work:
> - **github connector** (`github:get_file_contents`, `github:create_or_update_file`, `github:push_files`) — preferred. Put the new adapter file and the `runner.ts` registration in **one `push_files` commit** so the source is never registered-but-missing or present-but-unregistered. See the `github-ops` skill.
> - **`git clone` in the bash sandbox** only if you need to run the local checks (`npm --prefix backend ci`, `npx tsc --noEmit`). The sandbox has **no GitHub auth**, so clone works only while the repo is **public**. If it's **private**, stay connector-only and verify by watching the Actions run. Never paste a token into chat.
> After writing, re-read the file (commit SHA) and report the SHA + the CI/Actions conclusion, not "done."

## The key fact: sources are server-side now

autka used to multibind a `CarOfferSource` per marketplace **in the app**. It doesn't anymore. Aggregation moved to the **backend Cloudflare Worker** (`/backend`): it fans out to every marketplace, normalizes to one shape, and stores it in D1. The app binds a **single** `BackendCarOfferSource` (plus a `MockCarOfferSource` for offline dev) in `app/.../di/SourcesModule.kt` and never talks to a marketplace directly — credentials and feeds stay off the device.

So **adding a source = adding a backend ingest adapter.** You only touch the app if the shared `CarOffer` shape itself changes (see [If the shared shape changes](#if-the-shared-caroffer-shape-changes)). Do not add a new `@Binds @IntoSet` marketplace adapter on the app side — that path is retired.

## How ingestion fits together

```
backend/src/ingest/
├── source.ts            # IngestSource interface (sourceId, displayName, isEnabled, fetch)
├── runner.ts            # ALL_SOURCES[] registry + runIngestion(): runs enabled sources, isolates failures, upserts to D1, records ingest_runs
├── images.ts            # cacheOfferImages() → mirrors images to R2 (best-effort, never throws)
└── sources/
    ├── mock.ts          # always-on sample data (the canonical worked example)
    └── stubs.ts         # otomoto/olx/facebook/us_auction — DISABLED until a compliant feed exists
backend/src/lib/types.ts # canonical CarOffer — mirrors com.autka.core.model.CarOffer (keep in sync)
```

`runIngestion(env)` filters `ALL_SOURCES` to the enabled ones, runs them with `Promise.all` where **each is wrapped in its own try/catch**, upserts results to D1, and writes one `ingest_runs` row per source. One source throwing must never sink the others — preserve that.

## Step 0: Is there a compliant way to get this data? (the hard part)

This is the real gate, not the code. The existing `stubs.ts` spells it out and you must respect it:

- **Otomoto / OLX (OLX Group):** no open public listings API. Needs an official partner/dealer-feed agreement or a licensed data provider. Scraping the public site breaks their ToS — **don't**.
- **Facebook Marketplace:** Meta's ToS prohibits scraping and there's no third-party listings API. There is **no compliant ingestion path** — deep-link users into a pre-filled Marketplace search instead of ingesting.
- **US auctions (Copart/IAAI):** require registered membership or a licensed broker API. The app already computes import cost client-side; surface that rather than fake an ingest.

If the user has a real feed + credentials, proceed. If they don't, the correct deliverable is a **disabled stub** (below) plus a note on what feed/agreement unlocks it — not scraping. If asked to scrape a ToS-protected site, decline that part and offer the compliant alternatives.

## Step 1: Write the adapter

Create `backend/src/ingest/sources/<sourceId>.ts`. Implement `IngestSource`. Gate `isEnabled` on the credential/feed actually being configured in `env` — a source with no feed returns `false` and contributes nothing:

```ts
import type { IngestSource } from "../source";
import type { CarOffer } from "../../lib/types";

export const otomotoSource: IngestSource = {
  sourceId: "otomoto",
  displayName: "Otomoto",
  // Only runs when a compliant feed is wired in. No creds → disabled, not scraping.
  isEnabled: (env) => Boolean(env.OTOMOTO_FEED_URL && env.OTOMOTO_API_KEY),
  async fetch(env): Promise<CarOffer[]> {
    const res = await fetch(env.OTOMOTO_FEED_URL!, {
      headers: { Authorization: `Bearer ${env.OTOMOTO_API_KEY}` },
    });
    if (!res.ok) throw new Error(`otomoto feed ${res.status}`); // runner records this in ingest_runs.error
    const payload = await res.json();
    return payload.items.map(toCarOffer); // map THEIR shape → canonical CarOffer
  },
};
```

Mapping rules into `CarOffer` (from `lib/types.ts` — match exactly):
- `id` is **namespaced by source**: `"otomoto:12345"`. `sourceId` repeats the source id.
- `region` ∈ `POLAND | EUROPE | USA`; `price.currency` ∈ `PLN | EUR | USD`; `fuelType`/`transmission` are the canonical enums (map unknowns to `UNKNOWN`, not a guess).
- Nullable fields (`year`, `mileageKm`, `powerHp`, `location`, `thumbnailUrl`, `postedAtEpochMs`, `latitude`, `longitude`) are `null` when absent — don't invent values.
- Leave image-to-R2 mirroring to `cacheOfferimages` in the runner; just put source URLs in `thumbnailUrl`/`imageUrls`.

New env keys go in `backend/src/env.d.ts` (the `Env` type) and are set as Worker secrets (`wrangler secret put OTOMOTO_API_KEY`) — never committed, never a `buildConfigField`, never sent to the app.

For a source with no feed yet, mirror `stubs.ts` instead: `isEnabled: () => false`, `fetch` returns `[]`.

## Step 2: Register it

Append to `ALL_SOURCES` in `backend/src/ingest/runner.ts` and import it. One line + one import:

```ts
import { otomotoSource } from "./sources/otomoto";
// ...
export const ALL_SOURCES: IngestSource[] = [
  mockSource,
  otomotoSource,   // ← added
  olxSource, facebookSource, usAuctionSource,
];
```

That's the whole wiring. The runner picks it up, gates on `isEnabled`, and isolates its failures.

## If the shared CarOffer shape changes

Only if you add/rename a `CarOffer` field (not for a normal new source). Then change **both** sides in the same PR or the app fails to parse:
- `backend/src/lib/types.ts` — the canonical `CarOffer`.
- `app/src/main/java/com/autka/core/model/CarOffer.kt` — the Kotlin mirror, plus the DTO/parse in `data/remote/backend/BackendCarOfferSource` and the Room entity/mapper if persisted.
Keep the enum sets (`Region`, `FuelType`, `Transmission`, `Currency`) identical on both sides.

## Verify

```bash
# Backend type-checks (you edited TS):
npm --prefix backend ci && npx --prefix backend tsc --noEmit
# Run ingestion locally and confirm the source ran:
cd backend && npx wrangler dev &        # then hit the ingest route/cron trigger
#   check the ingest_runs table for a row: source_id=<id>, ok=1, offers_upserted>0
npx wrangler d1 execute <DB> --command \
  "SELECT source_id, ok, offers_upserted, error FROM ingest_runs ORDER BY started_at_ms DESC LIMIT 5"
```

Good = `tsc` clean, the source shows `ok=1` with `offers_upserted>0` (or `isEnabled=false` and absent, by design), and `/offers` returns its listings. A disabled stub correctly contributes nothing — that's success, not failure.

## Commit & ship

- Adapter file + `runner.ts` edit in **one commit** (`github:push_files`). Message imperative: `Add Otomoto ingest source`.
- Open a PR against `main`; CI runs on the backend. Tell the user to watch the check rather than asserting it passes.
- Run `github:run_secret_scanning` on the adapter before committing — a feed key in code is the easy mistake. If it flags, stop.

## Guardrails

- **Never scrape a ToS-protected marketplace.** No feed/credentials → ship a disabled stub + note, not a scraper.
- **It's a backend change, not an app change** — don't add app-side marketplace `CarOfferSource` bindings; only `Backend` + `Mock` are bound there.
- **Credentials stay server-side**: `env` secrets only, never committed, never shipped to the device.
- **Keep `CarOffer` in lockstep** across `lib/types.ts` and `com.autka.core.model.CarOffer` when the shape changes.
- **Don't let one source break the run** — keep the per-source try/catch in the runner; a new source must not be able to throw out of `runIngestion`.
- **Namespace ids** (`"<source>:<theirId>"`) so cross-source dedupe works.
