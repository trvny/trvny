# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion` and maintaining the Kanarek PR status comment.

## Endpoints

- `GET` or `HEAD /health` reports webhook, installation auth, companion lock, KV bank, and optional AI readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a delivery.

PR, review, completed CI/check-suite, and commit-status events refresh the affected pull request. A per-PR Durable Object serializes overlapping deliveries and deduplicates redeliveries.

Add the `no-goblin` label to silence Kanarek on a PR; removing it restores the companion.

Safe same-repository PRs may be updated to the base branch automatically when CI and review are settled. The GitHub App needs `Pull requests: write` and `Contents: write` for this action. Set `KANAREK_UPDATE_BRANCH=false` to disable this.

## GPTomek

The same Worker hosts the separate [`gptomek`](../gptomek/) GitHub App bridge
for authored commits, comments, review replies, and reactions. Commands use the
private `trvny/trvny#176` pull request as a branchless control mailbox; edits to
that PR are handled even after it is closed or merged. Normal pull requests
remain opened as `trvny`.

The bridge reuses Kanarek's existing `pull_request` webhook delivery path, so GPTomek does not need another Worker or webhook endpoint.

## Quips

The Worker keeps the existing Kanarek preset set and reads the shared phrase bank directly from the Workers KV namespace under `kanarek:companion:quip-bank:v1`.

Learned quips are persistent: the bank keeps up to 256 entries per context and 4096 total, while incremental maintenance removes legacy TTLs and trims overflow.

AI quips remain optional. Provider order and defaults are OpenAI (`gpt-5.6-luna`, then `gpt-5.4-nano`), Anthropic, Gemini, and xAI. Without provider secrets Kanarek uses the shared pool and presets.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `gh-apps/kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets

Required Worker secrets:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GPTOMEK_PRIVATE_KEY` for GPTomek operations

Optional AI secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

GitHub App metadata, model defaults, AI percentage, and the KV binding are defined in `wrangler.jsonc`.