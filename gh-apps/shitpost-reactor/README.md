# Shitpost Reactor

Small scheduled shitpost generator and public feed. GitHub Actions is the only clock; the existing Kanarek free-router is the model pool; local `style-reference.md` owns Reactor-specific craft notes.

## Flow

1. `.github/workflows/shitpost-reactor.yml` runs daily at **21:37 Europe/Warsaw** or manually with an optional topic. The generator job uses `ubuntu-latest`.
2. `generate.mjs` reads bundled `style-reference.md`, distilled from useful parts of the `edgy-dark-meme` archive. No download, unpacking or remote override at runtime. Published records keep the existing `skill.source`/`skill.sha256` fields for compatibility, now pointing to the local asset and its exact on-disk SHA-256 (including its trailing newline). Reactor rules still own the output contract.
3. The Action calls the authenticated public proxy at `automation.travny.workers.dev` with synthetic model `kanarek-shitpost-free`.
4. `kanarek-companion` forwards the call through its same-account Service Binding to private `kanarek-review`, which owns the shared provider inventory, shitpost task policy, credentials and cooldowns. Workers AI is currently excluded because its account allocation is reserved for SpaceMolt.
5. The draft is validated and saved as `latest.json` plus a readable `latest.md`. If generation fails from router rate limits, exhausted models, transport errors or unusable model output, the emergency text path chooses a random-looking language deterministically from the run seed. It samples Bacon Ipsum for a meat motif without using a model for translation; if Bacon Ipsum itself fails, local meat choices still yield a post. Authentication/configuration errors never trigger fallback.
6. `publish.mjs` requests a short-lived GitHub Actions OIDC token and POSTs the draft to `https://shitpost.trfny.com/api/publish`. No extra publishing secret is stored in GitHub.
7. The `shitpost-reactor` Worker verifies the GitHub OIDC signature and pins claims to `trvny/trvny`, this exact workflow and `refs/heads/main`, then stores the entry in the `shitpost-reactor` R2 bucket.
8. The same Worker serves the public archive and feeds. Cloudflare has **no cron trigger** for this project.

The workflow still needs only the existing repository secret `KANAREK_REVIEW_ROUTER_TOKEN` for generation. It does **not** get OpenRouter, OrcaRouter, AIHubMix, Groq, Hugging Face or other provider keys.

## Public endpoints

- `https://shitpost.trfny.com/` — latest entries with feed autodiscovery;
- `https://shitpost.trfny.com/archive` — all R2 posts, newest first, in stable 25-entry cursor pages backed by the same complete index used by the feed;
- `https://shitpost.trfny.com/rss.xml` — RSS 2.0;
- `https://shitpost.trfny.com/feed.xml` — RSS compatibility alias;
- `https://shitpost.trfny.com/atom.xml` — Atom 1.0;
- `https://shitpost.trfny.com/feed.json` — JSON Feed 1.1;
- `https://shitpost.trfny.com/sitemap.xml`, `/robots.txt` and `/llms.txt` — crawler and agent discovery;
- `/site.webmanifest` and `/browserconfig.xml` — installability/platform metadata;
- `/favicon.svg`, classic `/favicon.ico`, PNG favicon sizes, Apple touch icon and manifest icons — one generated icon propagated across browsers, feeds and install surfaces;
- `/posts/gh-<run_id>-<run_attempt>` — stable canonical page for each published entry;
- `/version` — public deployed commit SHA (or `unknown` for a manual release without the marker).

RSS, Atom and JSON Feed expose stable entry IDs/URLs, publication dates, categories and icon metadata. RSS and Atom also expose self-links and content with the correct feed MIME types. The Worker maintains one complete R2 `index.json` array manifest ordered newest-first (with completeness recorded in R2 custom metadata, keeping the JSON readable by older Worker versions). Feeds still read up to 50 entries and the homepage shows up to 20. `/archive` reads just 25 post bodies per page and uses a stable last-post cursor, with Older, Newer and Newest links. Publishing a new post does not shift subsequent pages. The previous index format retained only 250 posts; its entries are reconciled with canonical R2 object metadata on a legacy archive read (read-only) and permanently migrated on the next authenticated publish. Authenticated publishes also reconcile the canonical post objects, recovering entries if a prior index write failed. Once migrated, archive requests never scan the full bucket. Browser Back works, and the archive header still omits the descriptive subtitle.

## Worker

`worker.mjs` is intentionally read-mostly. `icons.mjs` is the single generated-icon implementation used for SVG, PNG, ICO, Apple touch, Windows tile and manifest surfaces. The only write route is `POST /api/publish`, accepted only with a valid GitHub Actions OIDC token from the scheduled/manual workflow on `main`. A repeated request from the same GitHub run/attempt is idempotent.

Deploys only via Cloudflare Workers Builds on push to `main` (root `gh-apps/shitpost-reactor`, build `npm run check`, deploy `npm run deploy`). `npm run deploy` (`deploy.mjs`, on `../core/worker-deploy.mjs`) requires `WORKERS_CI_COMMIT_SHA`, deploys only while its commit is the newest `main` commit for the watch paths, stamps `DEPLOY_COMMIT`, verifies `/version` matches and `/archive` is newest-first, and on failure restores the previous deployment (only while its own version is still active) and fails the build. Runs under the shared D1 deploy lock (`../core/deploy-lock.mjs`). Builds watch paths: `gh-apps/shitpost-reactor/**`, `gh-apps/core/worker-deploy.mjs`, `gh-apps/core/deploy-lock.mjs`.

`wrangler.jsonc` binds the R2 bucket and configures Workers Logs at **1%** (`head_sampling_rate: 0.01`), with invocation logs and traces disabled. `shitpost.trfny.com` is the production custom domain; `workers.dev` remains available as an emergency/debug route.

## Output

New records use schema v2 and contain only finished publishable content:

- `{"kind":"text","text":"..."}` for a standalone post;
- `{"kind":"meme","template":"...","top_text":"...","bottom_text":"..."}` for a classic meme macro rendered through `api.memegen.link`.

There is no generated `dialect`, `format`, `visual` or `alt_text` taxonomy anymore. The model sees the bundled style reference as optional inspiration, not as a response schema. The Worker still reads schema v1 so already-published posts remain valid.

Scheduled runs use `auto`. The run-number topic rotation uses a dated world headline on about one in seven runs, an LLM self-roast on another one in seven, Polish political satire on another one in seven, **Feedseek meme/thread inspiration on another one in seven**, and evergreen absurdity otherwise. Manual topics always win. News references must be no older than 48 hours; a missing, stale or sensitive headline falls back to evergreen. World headlines use BBC RSS plus Feedseek Reuters and Euronews JSON Feeds. The additional Feedseek shitpost lane uses 4chan, 9GAG, JBZD, Memedroid, Cheezburger, Wykop and Lemmy JSON Feeds. It chooses among currently usable sources first, so large feeds cannot monopolize inspiration; accepts only recent, non-tragedy titles from allowed hosts; and passes no post media or bodies to the model. If no source works, the run becomes regular evergreen absurdity. Polish political headlines use Feedseek TVP Info, PAP and Gov.pl JSON Feeds plus DoRzeczy and wPolityce political RSS. All entries must pass the same topical, 48-hour freshness, allowed-host and tragedy filters; an unreachable source is silently skipped. If unavailable, the politics lane uses timeless parliamentary satire without invented events. The headline title, publisher and URL remain in published topic metadata. The existing output modes and languages are unchanged.

Every second workflow run becomes a text limerick, keyed by `GITHUB_RUN_NUMBER`, so retries keep the same slot. Limerick languages rotate English → Polish → Simplified Chinese → Russian. The runs between them keep the existing deterministic text/meme choice. Manual `text` or `meme` explicitly bypasses the limerick cadence; manual `auto` follows it.
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
