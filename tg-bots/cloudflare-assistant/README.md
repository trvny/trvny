# Cloudflare Telegram assistant

Small 24/7 Telegram assistant designed to stay cheap and boring to operate. Cloudflare handles everyday chat and RSS curation; Hermes remains the optional heavyweight worker for repo/build/test jobs.

## What exists now

- owner-only private Telegram webhook;
- durable Telegram update delivery through Cloudflare Queues;
- `/help`, `/status`, and `/draft <message>`;
- LLM fallback chain: OrcaRouter → Ollama Cloud → OpenRouter → Workers AI;
- `POST /ingest/rss` for Feedseek/RSS curation;
- explicit RSS retry/error contract;
- `GET /health` for smoke checks;
- no server, polling loop, or always-on phone process.

Conversation memory, Engram, Telegram Business reply assistance, and Hermes job handoff are deliberately left for later slices rather than faked into the MVP.

## Stack

- Cloudflare Workers, TypeScript, Wrangler;
- Cloudflare Queues for reliable Telegram update processing;
- Workers AI as the no-key final fallback;
- Telegram Bot API webhook;
- external providers through OpenAI-compatible `chat/completions` endpoints.

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

Put the owner's numeric user/chat IDs in `.dev.vars` for local development and in Cloudflare runtime secrets for production.

Run locally:

```bash
npm run dev
```

Type-check:

```bash
npm run check
```

## First production setup

Authenticate Wrangler once:

```bash
npx wrangler login
```

Create the Queue once before the first deployment:

```bash
npm run queue:create
```

Set required production values. Wrangler prompts interactively, so secrets do not need to appear in shell history:

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

Telegram can point a bot to only one webhook at a time. Keep the Cloudflare assistant on a separate BotFather bot from the Hermes polling bot.

## Cloudflare Workers Builds

The one-time Queue creation and runtime secrets must exist before enabling automatic production deploys.

Recommended monorepo settings:

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

Runtime secrets belong in **Worker → Settings → Variables & Secrets**, not in repository files or ordinary build variables.

## Provider chain

Defaults live in `wrangler.jsonc`:

1. `orcarouter/free` when `ORCAROUTER_API_KEY` exists;
2. `glm-5.3` on Ollama Cloud when `OLLAMA_API_KEY` exists;
3. `openrouter/free` when `OPENROUTER_API_KEY` exists;
4. Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

External provider requests have bounded timeouts. Invalid structured RSS output also counts as a failed provider attempt and advances the fallback chain.

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

The model returns a score from 0–100. Items at or above `RSS_MIN_SCORE` (default `75`) are forwarded to `TELEGRAM_OWNER_CHAT_ID`. The article URL is kept intact even when notification text needs truncation.

Example:

```bash
curl -X POST https://<worker>.workers.dev/ingest/rss \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Interesting thing","url":"https://example.com","source":"Feedseek"}'
```

### Failure contract

| HTTP | `error` | `retryable` | Meaning |
| --- | --- | --- | --- |
| `503` | `providers_unavailable` | `true` | every model provider failed |
| `502` | `telegram_delivery_failed` | `true` | Telegram returned 429/5xx |
| `500` | `telegram_delivery_failed` | `false` | non-transient Telegram failure |
| `500` | `configuration_error` | `false` | required bot/chat configuration is missing |
| `500` | `internal_error` | `false` | unexpected processing failure |

Feedseek can retry only responses that explicitly say `retryable: true`.

## Telegram delivery

The webhook validates Telegram's secret header, parses a bounded update, and publishes it to `travny-tg-assistant-updates`. Only a successful Queue write gets `200 OK`. Queue processing retries failed bot work up to the configured consumer retry limit, so a quick webhook acknowledgement no longer means the update was silently discarded.

## Security boundaries

- Telegram webhook requests must carry the configured Telegram secret header;
- missing webhook/ingest secrets fail closed;
- chat accepts only `OWNER_TELEGRAM_USER_ID` in a private chat;
- Telegram and RSS request bodies are bounded before parsing/model use;
- RSS input and curator output lengths are bounded;
- RSS ingestion has a separate bearer secret;
- API keys never belong in source control;
- `/draft` produces text only and never sends messages on the owner's behalf;
- automatic replies to third parties are intentionally not enabled in this MVP.
