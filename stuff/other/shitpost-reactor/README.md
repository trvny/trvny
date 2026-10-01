# Shitpost Reactor

Small scheduled draft generator. GitHub Actions is the clock; the existing Kanarek free-router is the model pool; the `edgy-dark-meme` skill in `trvny/.ai` is the single style source of truth.

## Flow

1. `.github/workflows/shitpost-reactor.yml` runs daily at **21:37 Europe/Warsaw** or manually with an optional topic.
2. `generate.mjs` downloads `trvny/.ai/skills/edgy-dark-meme.zip` and extracts `SKILL.md` at runtime. The prompt is not copied into this repo.
3. The Action calls the authenticated public proxy at `kanarek-companion.travny.workers.dev` with synthetic model `kanarek-review-free`.
4. `kanarek-companion` forwards the call through its same-account Service Binding to private `kanarek-review`, which owns the free provider order, credentials, cooldowns and Workers AI fallback.
5. The draft is validated and saved as `latest.json` plus a readable `latest.md`, uploaded as a short-lived Actions artifact and shown in the job summary.

The workflow needs only the existing repository secret `KANAREK_REVIEW_ROUTER_TOKEN`. It does **not** get OpenRouter, OrcaRouter, AIHubMix, Groq, Hugging Face or other provider keys.

## Output

The model must return one JSON object with:

- `dialect`
- `format`
- `caption`
- `visual`
- `alt_text`

The artifact adds generation time, actual provider/model metadata and a SHA-256 of the loaded skill. Invalid model output fails the run instead of becoming publishable content.

## Manual run

Use **Actions → Shitpost Reactor → Run workflow** and optionally provide a topic. Scheduled runs deliberately use evergreen Polish tech/work/internet absurdity instead of inventing current news.

For local testing:

```bash
npm test
KANAREK_REVIEW_ROUTER_TOKEN=... npm run generate
```

## Publishing later

V1 intentionally stops at a reviewable artifact. A public sink can be added without changing generation: for example a tiny Cloudflare Worker/R2 feed, a Pages endpoint, or Botek/Telegram. Keep exactly one publisher responsible for the public state rather than teaching every provider how to post.
