---
name: tvpi-channel-fix
description: Diagnose and repair a dead, stale, or dropping channel in trvny/tvpi. Start with the Worker's X-Source-* headers, distinguish normal residential-push dependence from a code defect, keep all three channel registries synchronized, make the smallest fix, and verify the Worker, raw mirror, D1/R2 fallbacks, and residential pusher as applicable.
license: ISC
---

# TVPI channel repair

Repository: `trvny/tvpi`  
Worker: `https://tvpi.travny.workers.dev`

Use the GitHub connector for repository reads, writes, PRs, workflow state, and
logs. Do not use an unauthenticated GitHub API call or paste a token into chat.

## Current architecture

The Worker resolves each channel through:

1. per-colo Cache API,
2. live TVP API,
3. D1 last-known-good,
4. raw GitHub mirror,
5. R2 mirror.

`POST /push/<slug>` accepts a validated manifest from
`scripts/residential_push.py` and writes the residential result into D1 and R2.
The ordinary GET path reads D1 but does not write it.

TVP currently rejects most playlist API requests from non-Polish cloud
infrastructure with `GEOIP_FILTER_FAILED`. A Polish residential pusher running
roughly every ten minutes is therefore the normal source for most channels, not
an emergency workaround. GitHub Actions and Cloudflare colos cannot replace it.
A stale residential source may be an infrastructure-availability problem rather
than a parser bug.

Current channels, synchronized across `worker/src/index.ts`, `generate.py`, and
`scripts/residential_push.py`:

| slug | TVP id |
|---|---:|
| `tvp1` | 399697 |
| `tvp2` | 399698 |
| `tvpinfo` | 399699 |
| `tvpsport` | 399702 |
| `tvpdokument` | 399721 |
| `tvpnauka` | 399722 |
| `tvprozrywka` | 399724 |
| `tvphistoria` | 399703 |
| `tvpmuzyka` | 2999109 |

## Diagnose before editing

Read the headers for one channel and the combined playlist:

```bash
curl -sSI https://tvpi.travny.workers.dev/tvpsport.m3u | grep -Ei 'x-source|x-revalidating'
curl -sSI https://tvpi.travny.workers.dev/playlist.m3u | grep -Ei 'x-source|x-revalidating'
```

Interpret them:

| Header | Meaning |
|---|---|
| `X-Source-Cache` | warm-colo cached URL; usually healthy |
| `X-Source-Live` | TVP API succeeded from the Worker colo |
| `X-Source-D1` | last-known-good, commonly supplied by residential push |
| `X-Source-Raw` | committed GitHub snapshot |
| `X-Source-R2` | final Cloudflare mirror fallback |
| all `none` or HTTP 503 | every layer failed or expired |

`D1` or `R2` is not automatically a defect. For geo-blocked channels it can be
the expected delivery path. Check freshness and the residential runner before
changing parsing code.

Then inspect:

- the latest `Refresh M3U` and `Deploy Worker` runs,
- recent commits touching `streams/`,
- open issue #15 for the residential-runner status,
- residential pusher output, if available: fetched/pushed channel count and
  manifest validation failures,
- whether one channel is affected or all nine.

## Root-cause classes

### Residential runner unavailable

Symptoms: most channels fall to old D1/R2/raw entries or 503 together, while
`tvpinfo` may still resolve live.

Action: restore or rerun `scripts/residential_push.py` on a Polish residential
connection. Do not rewrite Worker logic to disguise a missing runner.

### Channel id changed or channel removed

Confirm the current TVP product id from an authoritative TVP page or API. Update
all three registries in one change:

- `worker/src/index.ts` → `CHANNELS`,
- `generate.py` → `TVP_CHANNELS`,
- `scripts/residential_push.py` → `CHANNELS`.

Delete an obsolete `streams/<slug>.m3u` only when the channel is genuinely gone.

### TVP JSON shape changed

The current extraction is `sources.HLS[0].src`. Update the matching extraction
and types in both Worker and Python paths. Also confirm the residential pusher
still finds candidates. Preserve retries, timeouts, validation, and fallback
ordering unless the evidence specifically requires changing them.

### Manifest or player compatibility failure

The residential pusher validates media segments, makes child URIs absolute, and
selects a default audio track. Fix normalization in
`scripts/residential_push.py`; do not simply push an unvalidated master URL.

### Worker deploy failure

From `worker/` run:

```bash
npm ci
npm run typecheck
```

A change under `worker/**` deploys through `.github/workflows/deploy.yml` after
merge to `main`.

### Raw mirror stale

`generate.py` updates `streams/` through `.github/workflows/refresh.yml`. Running
that workflow from a non-Polish runner cannot bypass the TVP geo-block. The raw
mirror is a fallback, not the durable fix for missing residential refreshes.

## Verification

Use the checks that match the edit:

```bash
cd worker && npm ci && npm run typecheck
python3 generate.py
TVPI_PUSH_TOKEN=... python3 scripts/residential_push.py
```

The Python network checks are meaningful for all channels only from a suitable
Polish residential connection.

After deployment or push, re-read the response headers and test the stable
`.m3u8` URL in a real player. A repair is complete when:

- the affected channel resolves through an expected fresh layer,
- the manifest and at least one media segment validate,
- all three channel registries agree,
- relevant CI is green,
- no unrelated fallback or security behavior changed.

## Guardrails

- Headers first, edits second.
- Never commit placeholder URLs as a repair.
- Never expose `PUSH_TOKEN` or put it in `wrangler.jsonc`.
- Do not add D1 writes to ordinary GET requests.
- Do not claim Cloudflare or GitHub Actions can replace the Polish residential
  source while TVP enforces the current geo-block.
- Keep changes minimal and report the failing layer, root cause, exact files,
  verification result, commit or PR, and workflow conclusion.
