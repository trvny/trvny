# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion`.

## Endpoints

- `GET` or `HEAD /health` reports webhook and installation-auth readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a delivery.

For `installation.created`, `installation.unsuspend`,
`installation.new_permissions_accepted`, and `installation_repositories` events,
the Worker also creates a short-lived installation token and verifies repository
access. Tokens are never returned or logged.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets

The Worker requires:

- `GITHUB_WEBHOOK_SECRET`, identical to the webhook secret configured in the GitHub App;
- `GITHUB_PRIVATE_KEY`, the complete PEM downloaded from the GitHub App settings.

`GITHUB_APP_ID` and `GITHUB_APP_SLUG` are ordinary Wrangler variables.
