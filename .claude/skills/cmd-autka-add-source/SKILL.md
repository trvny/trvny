---
name: cmd-autka-add-source
description: Add or prepare a compliant marketplace, dealer, auction, or import-company source in trvny/Autka. Sources are server-side Cloudflare Worker ingest adapters, not Android bindings. Verify that a licensed feed or official API exists, preserve snapshot and locking invariants, keep the shared CarOffer contract synchronized only when it changes, and never replace a missing business agreement with scraping.
license: ISC
---

# Add an Autka source

Repository: `trvny/Autka`  
Backend: `backend/`  
Production Worker currently retains the legacy `cargate-*` Cloudflare names.
Do not rename the Worker, D1 database, or R2 bucket as part of adding a source.

Use the GitHub connector for repository work. Credentials belong in Cloudflare
Worker secrets and must never be committed or sent to the Android app.

## Compliance is the first gate

Proceed only when there is a permitted data path, for example:

- an official partner or dealer feed,
- a documented marketplace API with suitable terms,
- a licensed data provider,
- a broker or auction API the operator is entitled to use.

Otomoto and OLX currently need an official agreement or licensed provider.
Facebook Marketplace has no general third-party listings API. Copart, IAAI, and
similar auctions normally require membership, broker access, or licensed APIs.
Do not scrape public pages to fill this gap.

Without a compliant feed, leave or add a disabled stub that documents what
agreement or credential would unlock it. A disabled source is the correct state,
not an incomplete failure.

## Current ingestion architecture

```text
backend/src/ingest/
├── source.ts          IngestSource contract
├── runner.ts          ALL_SOURCES registry, source locks, snapshot writes
├── images.ts          best-effort image mirroring to R2
└── sources/           adapters and disabled stubs
backend/src/lib/types.ts
backend/src/env.d.ts
```

The Android app reads normalized offers from the backend. Do not add a new
marketplace-specific Hilt binding to the app.

`runIngestion()` currently:

1. selects enabled sources,
2. runs sources independently so one failure does not sink the others,
3. acquires a per-source D1 lease,
4. treats `fetch()` as a complete source snapshot,
5. mirrors offer images to R2,
6. refreshes the lease before writes,
7. upserts offers into D1,
8. deletes rows not seen in the successful snapshot,
9. records the result in `ingest_runs`,
10. releases the source lock.

Preserve this ordering. In particular, never delete old offers after a partial or
failed fetch, and never bypass the source lock.

## Implement the adapter

Create `backend/src/ingest/sources/<source-id>.ts` implementing
`IngestSource`:

- stable lowercase `sourceId`,
- human-readable `displayName`,
- `isEnabled(env)` tied to the required feed URL or credentials,
- `fetch(env)` returning the complete normalized snapshot,
- non-2xx and invalid payloads reported as errors rather than empty success.

Namespace offer ids as `<source-id>:<provider-id>`. Map unknown enum values to
the canonical unknown value instead of guessing. Missing optional data remains
`null`; do not manufacture year, mileage, location, coordinates, or prices.
Put original image URLs in the offer and let `cacheOfferImages()` handle R2.

Add new environment declarations to `backend/src/env.d.ts`. Public non-secret
configuration may live in `backend/wrangler.jsonc`; API keys and tokens must be
set as Worker secrets.

Register the adapter in `ALL_SOURCES` in
`backend/src/ingest/runner.ts`. Add the adapter and registry change together so
the branch never contains half-wired code.

## Shared contract changes

A normal new source should not change `CarOffer`. When a genuine new field or
enum value is required, update the backend and Android representations in the
same PR:

- `backend/src/lib/types.ts`,
- the corresponding Kotlin model under
  `app/src/main/java/com/autka/core/model/`,
- backend DTO parsing, Room mapping, fixtures, and tests that depend on it.

Keep regions, currencies, fuel types, transmissions, and nullability identical
on both sides.

## Verification

From `backend/` run:

```bash
npm ci
npx wrangler types
npm run typecheck
npm test
```

For an enabled source, verify a controlled ingestion against a development
Worker or test database:

- one `ingest_runs` row is recorded,
- success returns the expected upsert count,
- a source failure leaves the previous snapshot intact,
- overlapping runs are skipped by the source lock,
- `/offers` returns normalized records,
- no credentials appear in logs, diffs, or generated files.

A disabled stub should type-check and contribute no offers.

## Delivery

Use one focused PR for one source. Keep code, env type, registry entry, tests,
and necessary documentation together. Do not include unrelated UI work,
infrastructure renames, or speculative refactors.

Report the compliant data path, source id, files changed, verification results,
PR and head SHA, CI conclusion, and any credentials the maintainer still needs
to add through Cloudflare.

## Guardrails

- No compliant feed means no scraper.
- Credentials stay server-side.
- Preserve per-source isolation, locking, and complete-snapshot deletion rules.
- Keep ids namespaced.
- Do not enable mock data in production.
- Do not casually rename the existing `cargate-backend`, D1, or R2 resources;
  those are legacy identifiers with live state attached.
