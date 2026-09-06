# Cloudflare Telegram assistant

Small 24/7 Telegram assistant designed to stay cheap and boring to operate. Cloudflare Worker handles everyday chat and RSS curation; Hermes remains the optional heavyweight worker for repo/build/test jobs.

## What exists now

- Telegram webhook with secret-token validation.
- Owner-only direct messages.
- `/help`, `/status`, and `/draft <message>`.
- LLM fallback chain: OrcaRouter → Ollama Cloud → OpenRouter → Workers AI.
- `POST /ingest/rss` for Feedseek/RSS curation; only items over the configured score are forwarded to Telegram.
- `GET /health` for smoke checks.
- No server, polling loop, or always-on phone process.

Conversation memory, Engram, Telegram Business reply assistance, and Hermes job handoff are deliberately left for later slices rather than faked into the MVP.

## Stack

- Cloudflare Workers, TypeScript, Wrangler.
- Workers AI as the no-key final fallback.
- Telegram Bot API webhook.
- External providers use OpenAI-compatible `chat/completions` endpoints.

## Local setup

Requires Node.js supported by current Wrangler.

```bash
cd tg-bots/cloudflare-assistant
npm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars`. Never commit it.

Before setting the webhook, send one message to the new bot and inspect Telegram IDs:

```bash
npm run telegram:updates
```

Put the owner's numeric user/chat IDs in `.dev.vars` for local development and in Cloudflare runtime variables/secrets for production.

Run locally:

```bash
npm run dev
```

Type-check:

```bash
npm run check
```

## Deploy

Authenticate Wrangler once:

```bash
npx wrangler login
```

Set required production values. Values are entered interactively and do not need to appear in shell history:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put INGEST_SECRET
npx wrangler secret put OWNER_TELEGRAM_USER_ID
npx wrangler secret put TELEGRAM_OWNER_CHAT_ID
```

Optional provider keys:

```bash
npx wrangler secret put ORCAROUTER_API_KEY
npx wrangler secret put OLLAMA_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

Deploy:

```bash
npm run deploy
```

Then create a local `.dev.vars` containing the same Telegram token and webhook secret and register the production webhook:

```bash
npm run webhook:set -- https://<worker>.workers.dev/telegram/webhook
npm run webhook:info
```

Telegram can point a bot to only one webhook at a time. Do not run another polling/webhook backend for the same bot simultaneously.

## Cloudflare Workers Builds

Recommended monorepo settings after the Worker exists:

| Setting | Value |
| --- | --- |
| Worker name | `travny-tg-assistant` |
| Repository | `trvny/trvny` |
| Production branch | `main` |
| Root directory | `tg-bots/cloudflare-assistant` |
| Build command | `npm run check` |
| Deploy command | `npm run deploy` |
| Preview command | `npx wrangler versions upload` |
| Build watch include | `tg-bots/cloudflare-assistant/**` |

Runtime secrets belong in **Worker → Settings → Variables & Secrets**, not Workers Builds build variables.

## Provider chain

Defaults live in `wrangler.jsonc`:

1. `orcarouter/free` when `ORCAROUTER_API_KEY` exists.
2. `glm-5.3` on Ollama Cloud when `OLLAMA_API_KEY` exists.
3. `openrouter/free` when `OPENROUTER_API_KEY` exists.
4. Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

Any provider failure falls through to the next one. Model IDs are ordinary Wrangler variables so they can be changed without touching secrets.

## RSS curator

Authenticated endpoint:

```text
POST /ingest/rss
Authorization: Bearer <INGEST_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "title": "Example title",
  "url": "https://example.com/post",
  "summary": "Optional source summary",
  "source": "Feedseek"
}
```

The model returns a score from 0–100. Items at or above `RSS_MIN_SCORE` (default `75`) are forwarded to `TELEGRAM_OWNER_CHAT_ID`.

Example:

```bash
curl -X POST https://<worker>.workers.dev/ingest/rss \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Interesting thing","url":"https://example.com","source":"Feedseek"}'
```

## Security boundaries

- Telegram webhook requests must carry the configured Telegram secret header.
- Direct chat ignores everyone except `OWNER_TELEGRAM_USER_ID`.
- RSS ingestion has a separate bearer secret.
- API keys never belong in source control.
- `/draft` produces text only; it never sends messages on the owner's behalf.
- Automatic replies to third parties are intentionally not enabled in this MVP.
