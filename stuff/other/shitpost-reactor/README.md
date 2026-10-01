# Shitpost Reactor

Small scheduled shitpost generator and public feed. GitHub Actions is the only clock; the existing Kanarek free-router is the model pool; the `edgy-dark-meme` skill in `trvny/.ai` is the single style source of truth.

## Flow

1. `.github/workflows/shitpost-reactor.yml` runs daily at **21:37 Europe/Warsaw** or manually with an optional topic. The lightweight job stays on `ubuntu-slim`.
2. `generate.mjs` downloads `trvny/.ai/skills/edgy-dark-meme.zip` and extracts `SKILL.md` at runtime. The prompt is not copied into this repo.
3. The Action calls the authenticated public proxy at `kanarek-companion.travny.workers.dev` with synthetic model `kanarek-review-free`.
4. `kanarek-companion` forwards the call through its same-account Service Binding to private `kanarek-review`, which owns the free provider order, credentials, cooldowns and Workers AI fallback.
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

The model must return one JSON object with:

- `dialect`
- `format`
- `caption`
- `visual`
- `alt_text`

The artifact adds generation time, actual provider/model metadata and a SHA-256 of the loaded skill. Invalid model output fails the run instead of becoming publishable content.

## Manual run

Use **Actions → Shitpost Reactor → Run workflow** on `main` and optionally provide a topic. Scheduled runs deliberately use evergreen Polish tech/work/internet absurdity instead of inventing current news.

For local testing:

```bash
npm test
KANAREK_REVIEW_ROUTER_TOKEN=... npm run generate
npm run check
```
