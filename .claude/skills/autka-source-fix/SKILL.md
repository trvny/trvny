---
name: autka-source-fix
description: Diagnose and fix a dead, empty, or stale marketplace source in the travino/autka project — read the backend ingest_runs table to localize which source failed and why, confirm the cause against the live feed, make a minimal edit to the adapter in backend/src/ingest/sources/ (mapping, endpoint, auth) keeping CarOffer parity, and verify. Use whenever a source is returning nothing, listings are stale, "Otomoto stopped showing up", an ingest run is failing, the app shows old/empty results, or someone says "autka has no offers", "the feed broke", "source X is down". Never fix by scraping — if the compliant feed is gone, disable the source.
license: Complete terms in LICENSE.txt
---

# Fix a Source (travino/autka)

> **In claude.ai chat.** Read/write via the github connector; you can't run the Worker here, so confirm live behavior with `curl` against the (permitted) feed in the bash sandbox and read backend state via `wrangler d1 execute` only if the user runs it / it's wired in CI. Report findings against files and the `ingest_runs` evidence, not guesses.

autka aggregates server-side: the backend Worker runs each `IngestSource`, upserts to D1, and the app reads the D1-backed API into its Room cache. A "dead source" almost always means an ingest adapter stopped returning rows — fix it at the backend, not the app.

## Step 1: Localize with `ingest_runs`

The runner records one row per source per run (`source_id, ok, offers_upserted, error`). That table tells you which layer broke before you read any code:

```sql
SELECT source_id, ok, offers_upserted, error, started_at_ms
FROM ingest_runs ORDER BY started_at_ms DESC LIMIT 20;
```

Read it:
- **No recent row for the source** → it's not enabled. Check `isEnabled(env)` and whether its feed/credentials env keys are set. Often the whole fix is configuring a secret, not code.
- **`ok=0` with an `error`** → `fetch` threw. The message localizes it: HTTP status (feed moved/auth expired), JSON parse (payload shape changed), or a mapping error.
- **`ok=1` but `offers_upserted=0`** → fetch succeeded but mapped to zero offers. The feed's field names/structure changed and your `map(...)` now produces nothing (or everything is filtered out).
- **All sources `ok=1`, offers present, but the app is stale** → not a source bug. Jump to [App-side staleness](#app-side-staleness).

## Step 2: Confirm against the live feed

Don't edit from a guess. Hit the actual (permitted) feed and compare its current shape to what the adapter expects:

```bash
curl -s -H "Authorization: Bearer $KEY" "$FEED_URL" | head -c 2000 | python3 -m json.tool | head -40
```

Find what moved: a renamed field, a nested path, a changed auth scheme, a new pagination envelope, a status/region code that no longer maps to a `CarOffer` enum.

## Step 3: Minimal fix in the adapter

Edit `backend/src/ingest/sources/<sourceId>.ts` — change only what moved:
- **Endpoint/auth:** update the URL or header; new env keys go in `env.d.ts` and are set as Worker secrets (never committed).
- **Mapping:** fix the `toCarOffer` field paths. Keep the canonical shape from `lib/types.ts`: namespaced `id` (`"<source>:<theirId>"`), `region`/`currency`/`fuelType`/`transmission` enums (unmapped → `UNKNOWN`, never a guess), `null` for genuinely-absent nullable fields.
- **Don't widen the blast radius:** one source's fix shouldn't touch `runner.ts`, the shared types, or other sources unless the `CarOffer` shape itself changed (then sync `com.autka.core.model.CarOffer` too — that's a `cmd-autka-add-source` shaped change).

If the compliant feed is **gone** (agreement lapsed, endpoint retired) and there's no permitted replacement, the honest fix is to **disable** the source (`isEnabled: () => false`, `fetch` returns `[]`) and note what would re-enable it. Do not switch to scraping a ToS-protected site to "keep it working."

## App-side staleness

If the backend is healthy but the app shows old/empty data:
- **Just after a `CarOffer` shape change:** the app's parse in `data/remote/backend/BackendCarOfferSource` or `CarOffer.kt` drifted from `lib/types.ts` — re-sync both sides.
- **Refresh not firing / cache not updating:** the repository should expose Room via `Flow` and trigger `refresh()` separately; check the refresh is actually invoked and writes the DAO. Room being the source of truth means a failed refresh shows *stale* (not empty) data — that's by design, not the bug.

## Verify

```bash
npx --prefix backend tsc --noEmit                 # adapter still type-checks
# re-run ingestion (wrangler dev + trigger the route/cron), then:
npx wrangler d1 execute <DB> --command \
  "SELECT source_id, ok, offers_upserted, error FROM ingest_runs ORDER BY started_at_ms DESC LIMIT 5"
```

Good = the source now shows `ok=1, offers_upserted>0` and `/offers` returns its listings again — or, if you disabled it, it's cleanly absent with a note, and the other sources are unaffected.

## Guardrails

- **Diagnose from `ingest_runs` first** — don't rewrite an adapter that's merely disabled or mis-keyed.
- **Never scrape to "fix" it.** Gone feed → disable + note, not a scraper.
- **Keep the failure isolated** — a fix that lets the source throw out of `runIngestion` regresses invariant #2 (one source can't sink the rest).
- **Secrets stay in `env`**, never committed; run `github:run_secret_scanning` on the change.
- **Only sync the app** when the shared shape changed; a normal feed fix is backend-only.
