# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion` and maintaining the Kanarek PR status comment.

## Endpoints

- `GET` or `HEAD /health` reports webhook, installation auth, companion lock, KV bank, and optional AI readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a delivery.

PR, review, completed CI/check-suite, and commit-status events refresh the affected pull request. A per-PR Durable Object serializes overlapping deliveries and deduplicates redeliveries.

## Quips

The Worker keeps the existing Kanarek preset set and reads the shared phrase bank directly from the Workers KV namespace under `kanarek:companion:quip-bank:v1`.

AI quips remain optional. Provider order and defaults are OpenAI (`gpt-5.6-luna`, then `gpt-5.4-nano`), Anthropic, Gemini, and xAI. Without provider secrets Kanarek uses the shared pool and presets.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets

Required Worker secrets:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`

Optional AI secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

GitHub App metadata, model defaults, AI percentage, and the KV binding are defined in `wrangler.jsonc`.
