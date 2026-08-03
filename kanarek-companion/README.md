# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion`.

## Endpoints

- `GET` or `HEAD /health` reports deployment readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a delivery.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets

The Worker requires `GITHUB_WEBHOOK_SECRET`. Keep it identical to the webhook
secret configured in the GitHub App. The GitHub App private key will be added in
the next stage, when installation authentication and PR comments are enabled.
