# Shitpost Reactor

[![gh apps ci CI](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml) [![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflareworkers&logoColor=white&style=flat-square)](https://developers.cloudflare.com/workers/)

> **Agent entry:** `generate.mjs` drafts; `publish.mjs` publishes; Worker serves the public Reactor.
> **Validate:** `cd gh-apps/shitpost-reactor && npm ci && npm run check`.
> **Boundary:** [scheduled publisher](../../.github/workflows/shitpost-reactor.yml) is an operational workflow, **not** the CI status; published titles/Atom IDs must remain stable.

Public presentation: **Reactor**. Post titles derive from the stored topic when it is a presentable subject or sourced headline; internal generation instructions fall back to the post's opening line. Homepage, archives, canonical posts, social metadata and feeds share this title. Public content is styled as editorial commentary without "shitpost" labels. Internal workflow, R2 keys, OIDC audience and historical feed identifiers remain unchanged.

Small scheduled shitpost generator and public feed. GitHub Actions is the only clock; the existing Kanarek free-router is the model pool; local `style-reference.md` owns Reactor-specific craft notes.

## Flow

1. `.github/workflows/shitpost-reactor.yml` runs daily at **04:20 Europe/Warsaw** (free provider quotas fresh) or manually with an optional topic. The generator job uses `ubuntu-latest`.
2. `generate.mjs` uses compact Chinese-language craft notes in bundled `style-reference.md` and an untrusted reference data contract. No runtime style download or override. Published records retain their `skill.source` and the local asset SHA-256; generation rules own the output schema.
3. The Action calls the authenticated public proxy at `automation.travny.workers.dev` with synthetic model `kanarek-shitpost-free`. Duel: up to 2 successful candidates, each from a provider not used yet (`x-kanarek-review-exclude-provider`), then one `kanarek-judge-free` call picks the funniest against `taste-profile.json`. Transient 502/503/504 exhaustion gets bounded retries (5s, 15s); candidate slots count successful drafts. The judge gets the final 6 minutes of a 30-minute budget and may revise the winner in its existing response, using the other finalist as inspiration without another provider call. One candidate skips judging; an invalid verdict uses the first. The run artifact includes both original drafts and the judge decision. Only the losing draft and judge metadata are archived privately under R2 `editorial/gh-<run_id>-<attempt>.json`; the winner is published as usual. No private archive entry is written when only one candidate succeeds. Public posts, feeds and sitemap remain winner-only. The GitHub-hosted job is capped at 90 minutes, including setup and publishing.
4. `kanarek-companion` forwards the call through its same-account Service Binding to private `kanarek-review`, which owns the shared provider inventory, shitpost task policy, credentials and cooldowns. Workers AI is currently excluded because its account allocation is reserved for SpaceMolt.
5. The chosen draft and both original candidates are saved in `latest.json` plus a readable winner-only `latest.md`. If generation fails from router rate limits, exhausted models, transport errors or unusable model output, the emergency text path chooses a random-looking language deterministically from the run seed. It samples Bacon Ipsum for a meat motif without using a model for translation; if Bacon Ipsum itself fails, local meat choices still yield a post. Authentication/configuration errors never trigger fallback.
6. `publish.mjs` requests a short-lived GitHub Actions OIDC token and POSTs the draft to `https://shitpost-reactor.travny.workers.dev/api/publish`. No extra publishing secret is stored in GitHub.
7. The `shitpost-reactor` Worker verifies the GitHub OIDC signature and pins claims to `trvny/trvny`, this exact workflow and `refs/heads/main`, then stores the entry in the `shitpost-reactor` R2 bucket.
8. The same Worker serves the public archive and feeds. Cloudflare has **no cron trigger** for this project.

The workflow still needs only the existing repository secret `KANAREK_REVIEW_ROUTER_TOKEN` for generation. It does **not** get OpenRouter, OrcaRouter, AIHubMix, Groq, Hugging Face or other provider keys.

## Public endpoints

- `https://shitpost-reactor.travny.workers.dev/` — latest entries with feed autodiscovery;
- `https://shitpost-reactor.travny.workers.dev/archive` — all R2 posts, newest first, in stable 25-entry cursor pages backed by the same complete index used by the feed;
- `https://shitpost-reactor.travny.workers.dev/rss.xml` — RSS 2.0;
- `https://shitpost-reactor.travny.workers.dev/feed.xml` — RSS compatibility alias;
- `https://shitpost-reactor.travny.workers.dev/atom.xml` — Atom 1.0;
- `https://shitpost-reactor.travny.workers.dev/feed.json` — JSON Feed 1.1;
- `https://shitpost-reactor.travny.workers.dev/sitemap.xml`, `/robots.txt` and `/llms.txt` — crawler and agent discovery;
- `/site.webmanifest` and `/browserconfig.xml` — installability/platform metadata;
- `/favicon.svg`, classic `/favicon.ico`, PNG favicon sizes, Apple touch icon and manifest icons — one generated icon propagated across browsers, feeds and install surfaces;
- `/posts/gh-<run_id>-<run_attempt>` — stable canonical page for each published entry;
- `/version` — public deployed commit SHA (or `unknown` for a manual release without the marker).

Public URLs and the fixed OIDC audience live in `urls.mjs`; the workflow uses the publisher defaults. The audience remains `https://shitpost.trfny.com` as an authentication identifier, independent of DNS. Existing stored records are never rewritten: their original URLs remain RSS GUIDs, Atom entry IDs and JSON Feed item IDs. The Atom feed-level ID also stays unchanged. Links, canonicals, structured data, discovery and deployment probes use the durable Workers origin. New posts receive durable URLs and IDs.

RSS, Atom and JSON Feed expose stable entry IDs, publication dates, categories and icon metadata. RSS and Atom also expose self-links and content with the correct feed MIME types. The Worker maintains one complete R2 `index.json` array manifest ordered newest-first (with completeness recorded in R2 custom metadata, keeping the JSON readable by older Worker versions). Feeds still read up to 50 entries and the homepage shows up to 20. `/archive` reads just 25 post bodies per page and uses a stable last-post cursor, with Older, Newer and Newest links. Publishing a new post does not shift subsequent pages. The previous index format retained only 250 posts; its entries are reconciled with canonical R2 object metadata on a legacy archive read (read-only) and permanently migrated on the next authenticated publish. Authenticated publishes also reconcile the canonical post objects, recovering entries if a prior index write failed. Once migrated, archive requests never scan the full bucket. Browser Back works, and the archive header still omits the descriptive subtitle.

## Worker

Archive index updates use conditional ETag writes with bounded retries. Concurrent publishers cannot replace a newer manifest with a stale snapshot; exhausted conflicts fail explicitly.

`worker.mjs` is intentionally read-mostly. `icons.mjs` is the single generated-icon implementation used for SVG, PNG, ICO, Apple touch, Windows tile and manifest surfaces. The only write route is `POST /api/publish`, accepted only with a valid GitHub Actions OIDC token from the scheduled/manual workflow on `main`. It stores only the runner-up privately in R2 when a second draft is available, keeping the public archive unchanged. A repeated request from the same GitHub run/attempt is idempotent.

Deploys only via Cloudflare Workers Builds on push to `main` (root `gh-apps/shitpost-reactor`, build `npm run check`, deploy `npm run deploy`). `npm run deploy` (`deploy.mjs`, on `../core/worker-deploy.mjs`) requires `WORKERS_CI_COMMIT_SHA`, deploys only while its commit is the newest `main` commit for the watch paths, stamps `DEPLOY_COMMIT`, verifies `/version` matches and `/archive` is newest-first, and on failure restores the previous deployment (only while its own version is still active) and fails the build. Runs under the shared D1 deploy lock (`../core/deploy-lock.mjs`). Builds watch paths: `gh-apps/shitpost-reactor/**`, `gh-apps/core/worker-deploy.mjs`, `gh-apps/core/deploy-lock.mjs`.

`wrangler.jsonc` binds the R2 bucket and configures Workers Logs at **1%** (`head_sampling_rate: 0.01`), with invocation logs and traces disabled. `shitpost-reactor.travny.workers.dev` is canonical. The old custom domain redirects public GET/HEAD requests, preserving path and query. Both hosts still accept authenticated publishing for compatibility.

## Output

New records use schema v2 and contain only finished publishable content:

- `{"kind":"text","text":"..."}` for a standalone post;
- `{"kind":"meme","template":"...","top_text":"...","bottom_text":"...","font":"...","color":"...","layout":"..."}` for a macro rendered through `api.memegen.link`. Optional look fields are allowlisted and preserved through publish, archive and feeds. The generator offers 21 two-caption templates by ID/name, then lets the model pick a suitable one after finding the joke. A run-seeded look still samples four fonts, three contrast palettes and occasional top-aligned layout. Older posts without look fields render unchanged.

There is no generated `dialect`, `format`, `visual` or `alt_text` taxonomy anymore. The model sees the bundled style reference as optional inspiration, not as a response schema. The Worker still reads schema v1 so already-published posts remain valid.

Scheduled runs use `auto`. Topic lanes now use a reproducible hash instead of the fixed seven-run cycle: world news, politics, public meme threads, local Chrzanów-area events, Polish Wikipedia/culture, AI self-roasts and evergreen absurdity. Sources are sampled before their recent entries to prevent large feeds from dominating; manual topics still win. Headlines must be no older than 48 hours, and direct victim-harm stories are filtered. BBC RSS, Feedseek Reuters/Euronews/Wikipedia, TVP/PAP/Gov.pl/Wykop, DoRzeczy, wPolityce, and public meme feeds provide untrusted titles only. Local topics use Google News RSS, including site-scoped searches for `przelom.pl` and `chrzanow.naszemiasto.pl`, plus Chrzanów, Trzebinia, Libiąż and Alwernia. A missing or stale source never blocks generation. Source headlines remain in entry metadata; fictional allegations are forbidden. Politics matches include scandals, corruption, municipal government and everyday institutions.

Limericks are optional rather than imposed on every second run. In `auto`, the model selects text or meme based on the joke instead of a run-seeded format coin flip. Explicit `text` and `meme` choices still constrain the kind. Meme templates are chosen from the existing allowlist by name, not from actual image inspection; no new renderer or image provider is introduced. Model-facing generation and judging rules are compact Simplified Chinese; published output language remains unconstrained. `style-reference.md` and `taste-profile.json` provide compact Chinese-language craft context.
## Bacon Ipsum emergency mode

The fallback is only used after the normal Kanarek router fails (429/402, 5xx, timeout, network) or returns empty/invalid output. Successful text, memes, the usual language rotation and provider cooldowns remain unchanged. The model is **not** called for translation: Bacon Ipsum offers English only, so a run-seeded choice among Polish, English, German, French, Spanish, Italian, Russian and Japanese uses curated local one-liners with ingredients sampled from the Bacon Ipsum response. The API call has a four-second deadline and is optional. The published entry is always schema-v2 `text`, with `provider` set to `baconipsum` or `bacon-offline` and a `bacon-fallback/<language>` model label. Fallback posts are not attributed to their original news lane. Auth/config errors and publishing failures still fail normally. No cron or worker changes.

## Manual run

Use **Actions → Shitpost Reactor → Run workflow** on `main`, optionally provide a topic, and choose `auto`, `text` or `meme`. Scheduled news posts use dated RSS or Feedseek JSON Feed headlines as untrusted inspiration instead of inventing current events. Polish political posts roast public conduct and bureaucratic absurdity, not voting choices. The generator does not publish the source feed or copy its article text.

For local testing:

```bash
npm test
KANAREK_REVIEW_ROUTER_TOKEN=... npm run generate
npm run check
```


## Quality inputs

The generator keeps one small quality stack instead of importing another large
agent framework:

- the local quality kernel forces specificity, remote-association/collision,
  predictability rejection, Send Test, Feed Glance, and zero-cringe checks;
- `taste-profile.json` is the maintained, compact source of project taste;
- `style-reference.md` is the local source for dialect and craft cues, not an output contract;
- [mysaas.lol](https://mysaas.lol/for-agents) is an optional, read-only
  inspiration/anti-copy probe. Dev/startup/SaaS topics are eligible directly;
  other runs sample it deterministically at about 25%.

MySaaS results are passed only as reference metadata. Reactor does not republish
their image assets or copy meme wording. If the public API is unavailable,
generation continues without it.

The local asset is a one-time curated extraction from `trvny/.ai/skills/edgy_dark_meme.skill` (SKILL.md, collision-engine, craft, Polish-net). The upstream archive remains independent. Update the asset deliberately instead of syncing or bundling the whole package, its image assets, format registry, search/judge tooling, or output contract.

The compact kernel is conceptually distilled from
[imMamdouhaboammar/meme-marketing](https://github.com/imMamdouhaboammar/meme-marketing),
especially its Collision Engine and post-tuning ideas. The full skill is
deliberately not loaded into the runtime prompt.

Generation deliberately favors quality over latency. The completion budget is
16,384 tokens of generation/reasoning headroom, not a target post length; final
text still has the same 2,400-character safety ceiling and the prompt explicitly
forbids padding to a limit. The client can wait up to 20 minutes for the shared
router, while the GitHub job has a 30-minute ceiling. The router itself gives the
shitpost task a bounded two-minute budget per provider, shared across that
provider's internal model fallbacks.
