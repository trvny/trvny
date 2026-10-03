# Shitpost Reactor

Small scheduled shitpost generator and public feed. GitHub Actions is the only clock; the existing Kanarek free-router is the model pool; the `edgy-dark-meme` skill in `trvny/.ai` is the single style source of truth.

## Flow

1. `.github/workflows/shitpost-reactor.yml` runs daily at **21:37 Europe/Warsaw** or manually with an optional topic. The lightweight job stays on `ubuntu-slim`.
2. `generate.mjs` downloads `trvny/.ai/skills/edgy-dark-meme.zip` and extracts `SKILL.md` at runtime. The skill is advisory style material only; the Reactor owns the prompt and output contract.
3. The Action calls the authenticated public proxy at `kanarek-companion.travny.workers.dev` with synthetic model `kanarek-shitpost-free`.
4. `kanarek-companion` forwards the call through its same-account Service Binding to private `kanarek-review`, which owns the shared provider inventory, shitpost task policy, credentials and cooldowns. Workers AI is currently excluded because its account allocation is reserved for SpaceMolt.
5. The draft is validated and saved as `latest.json` plus a readable `latest.md`.
6. `publish.mjs` requests a short-lived GitHub Actions OIDC token and POSTs the draft to `https://shitpost.trfny.com/api/publish`. No extra publishing secret is stored in GitHub.
7. The `shitpost-reactor` Worker verifies the GitHub OIDC signature and pins claims to `trvny/trvny`, this exact workflow and `refs/heads/main`, then stores the entry in the `shitpost-reactor` R2 bucket.
8. The same Worker serves the public archive and feeds. Cloudflare has **no cron trigger** for this project.

The workflow still needs only the existing repository secret `KANAREK_REVIEW_ROUTER_TOKEN` for generation. It does **not** get OpenRouter, OrcaRouter, AIHubMix, Groq, Hugging Face or other provider keys.

## Public endpoints

- `https://shitpost.trfny.com/` — small HTML archive with feed autodiscovery;
- `https://shitpost.trfny.com/rss.xml` — RSS 2.0;
- `https://shitpost.trfny.com/feed.xml` — RSS compatibility alias;
- `https://shitpost.trfny.com/atom.xml` — Atom 1.0;
- `https://shitpost.trfny.com/feed.json` — JSON Feed 1.1;
- `https://shitpost.trfny.com/sitemap.xml`, `/robots.txt` and `/llms.txt` — crawler and agent discovery;
- `/site.webmanifest` and `/browserconfig.xml` — installability/platform metadata;
- `/favicon.svg`, classic `/favicon.ico`, PNG favicon sizes, Apple touch icon and manifest icons — one generated icon propagated across browsers, feeds and install surfaces;
- `/posts/gh-<run_id>-<run_attempt>` — stable canonical page for each published entry.

RSS, Atom and JSON Feed expose stable entry IDs/URLs, publication dates, categories and icon metadata. RSS and Atom also expose self-links and content with the correct feed MIME types. The Worker keeps the newest 250 entries in its index and emits up to 50 in feeds. The visible archive header intentionally omits the descriptive subtitle; the description remains available to metadata, feeds and crawlers.

## Worker

`worker.mjs` is intentionally read-mostly. `icons.mjs` is the single generated-icon implementation used for SVG, PNG, ICO, Apple touch, Windows tile and manifest surfaces. The only write route is `POST /api/publish`, accepted only with a valid GitHub Actions OIDC token from the scheduled/manual workflow on `main`. A repeated request from the same GitHub run/attempt is idempotent.

`wrangler.jsonc` binds the R2 bucket and configures Workers Logs at **1%** (`head_sampling_rate: 0.01`), with invocation logs and traces disabled. `shitpost.trfny.com` is the production custom domain; `workers.dev` remains available as an emergency/debug route.

## Output

New records use schema v2 and contain only finished publishable content:

- `{"kind":"text","text":"..."}` for a standalone post;
- `{"kind":"meme","template":"...","top_text":"...","bottom_text":"..."}` for a classic meme macro rendered through `api.memegen.link`.

There is no generated `dialect`, `format`, `visual` or `alt_text` taxonomy anymore. The model sees the canonical style skill as optional inspiration, not as a response schema. The Worker still reads schema v1 so already-published posts remain valid.

Scheduled runs use `auto`, deterministically choosing text or meme from the run seed. Manual runs can force `auto`, `text` or `meme`.
## Manual run

Use **Actions → Shitpost Reactor → Run workflow** on `main`, optionally provide a topic, and choose `auto`, `text` or `meme`. Scheduled runs deliberately use evergreen Polish tech/work/internet absurdity instead of inventing current news.

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
- `edgy-dark-meme` stays an optional style reference, not an output contract;
- [mysaas.lol](https://mysaas.lol/for-agents) is an optional, read-only
  inspiration/anti-copy probe. Dev/startup/SaaS topics are eligible directly;
  other runs sample it deterministically at about 25%.

MySaaS results are passed only as reference metadata. Reactor does not republish
their image assets or copy meme wording. If the public API is unavailable,
generation continues without it.

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
