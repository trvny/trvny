# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion`.

## Endpoints

- `GET /health` reports deployment readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a delivery.

## Secrets

The Worker requires `GITHUB_WEBHOOK_SECRET`. Keep it identical to the webhook
secret configured in the GitHub App. The GitHub App private key will be added in
the next stage, when installation authentication and PR comments are enabled.

```bash
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```
