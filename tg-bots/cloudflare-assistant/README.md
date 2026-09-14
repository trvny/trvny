# Cloudflare Telegram assistant

Small 24/7 Telegram assistant designed to stay cheap and boring to operate. Cloudflare handles everyday chat and RSS curation; Hermes remains the heavyweight worker for repo/build/test jobs.

## What exists now

- owner-only private Telegram webhook;
- durable Telegram update delivery through Cloudflare Queues;
- persistent `update_id` state in a SQLite Durable Object;
- dead-letter queue for exhausted or non-replayable Telegram deliveries;
- /help, /status, /draft <message>, and /reset;
- /start and /help self-sync the owner-scoped Telegram command list and command menu from code;
- bounded per-chat conversation context for ordinary messages;
- native Telegram reply-to behavior plus ephemeral native thinking drafts with typing fallback for model-backed replies;
- model-backed replies use Telegram Rich Messages with simple Markdown and fall back to plain text only after a deterministic rich-format rejection;
- best-effort native reactions show state for model-backed owner messages (`👀` while working, `👍` after successful delivery, `👎` on handled failures, `🤨` when delivery is ambiguous);
- inline `/status` refresh button backed by Telegram callback queries and message editing;
- native clipboard button on short `/draft` suggestions;
- `/task <repo> <polecenie>` delegates bounded code tasks to the Legion through the existing Pet Dispatcher RPC surface, with inline status/cancel controls;
- owner-only stateless inline mode can answer `@trvny_bot <query>` from other chats, with a native shortcut on `/start` and `/help`; rapid query edits are coalesced before model work;
- owner voice notes transcribed with Workers AI Whisper before normal assistant routing;
- owner-shared locations, venues, contacts and polls normalized into bounded assistant context;
- shared free-model routing through the existing Kanarek Companion router;
- local Workers AI emergency fallback;
- `POST /ingest/rss` for Feedseek/RSS curation;
- explicit RSS retry/error contract;
- `GET /health` for smoke checks;
- no server, polling loop, or always-on phone process.

Engram-backed long-term memory, Telegram Business reply assistance, and Hermes handoff are deliberately left for later slices rather than faked into the MVP.

## Roadmap

The detailed Botek roadmap lives in [`../CONCEPT.md`](../CONCEPT.md#botek-roadmap) so the agent/integration plan and Telegram-native feature plan have one maintained source of truth.

## Reused infrastructure

This Worker intentionally does not own another copy of the free-provider stack.

```text
travny-tg-assistant
        │ service binding
        ▼
kanarek-companion /review-router/v1/chat/completions
        │ private service binding
        ▼
kanarek-review
        ├─ OpenRouter free pool
        ├─ OrcaRouter free
        ├─ AIHubMix free
        └─ Workers AI
```

The private `kanarek-review` Worker owns provider credentials, fallback/cooldown behavior, and Workers AI fallback behind the companion proxy. The Telegram assistant needs only the existing `KANAREK_REVIEW_ROUTER_TOKEN`; if that route is unavailable it can still use its own Workers AI binding.

Future heavyweight jobs should reuse the existing `pet-dispatcher-control` + `pet-dispatcher-tasks` transport instead of creating another task-control plane. The current dispatcher targets the Legion; multi-worker Android/Legion routing is a later extension.

## Stack

- Cloudflare Workers, TypeScript, Wrangler;
- same-account Service Binding to `kanarek-companion`;
- Cloudflare Queues for reliable Telegram update processing;
- SQLite Durable Objects for Telegram update deduplication and bounded conversation context;
- Workers AI as the local emergency fallback;
- Telegram Bot API webhook.

## Local setup

Requires Node.js supported by current Wrangler.

```bash
cd tg-bots/cloudflare-assistant
npm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars`. Never commit it. `KANAREK_REVIEW_ROUTER_TOKEN` is optional locally; without it the assistant falls back to Workers AI.

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

Create the ingress Queue and its DLQ once before the first deployment:

```bash
npm run queue:create
```

Set bot-specific production values. Wrangler prompts interactively, so values do not need to appear in shell history:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put INGEST_SECRET
npx wrangler secret put OWNER_TELEGRAM_USER_ID
npx wrangler secret put TELEGRAM_OWNER_CHAT_ID
```

Deploy:

```bash
npm run deploy
```

The first deployment can run on Workers AI alone. After the Worker exists, run GitHub Actions workflow **Sync Worker credentials** with target `travny-tg-assistant`. It copies the repository's existing `KANAREK_REVIEW_ROUTER_TOKEN` to the Worker. OpenRouter/OrcaRouter/AIHubMix keys remain centralized in the private `kanarek-review` Worker and are not duplicated.

Then create a local `.dev.vars` containing the Telegram token and webhook secret and register the production webhook. The helper subscribes to `message`, `inline_query`, and `callback_query` updates:

```bash
npm run webhook:set -- https://<worker>.workers.dev/telegram/webhook
npm run webhook:info
```

`/start` and `/help` also best-effort reassert the current webhook URL, secret and allowed update types, so Telegram-native controls can self-heal after a deployment. Telegram can point a bot to only one webhook at a time. Keep the Cloudflare assistant on a separate BotFather bot from the Hermes polling bot.

### Enable Telegram inline mode

Inline mode itself is a BotFather capability and cannot be enabled through the Bot API. In `@BotFather`, run `/setinline`, choose `@trvny_bot`, and set a placeholder such as `Zapytaj Botka…`. Then send `/start` to Botek once so the Worker reasserts the webhook update types. Inline queries are owner-only and stateless. A small Durable Object debounce keeps superseded keystroke queries from fanning out model calls, while an inline-specific short router/fallback deadline keeps answers inside Telegram's query lifetime. The generated answer is sent only after the owner taps the result. Runtime webhook sync and the setup helper both read allowed update types from `telegram-config.json`.

## Cloudflare Workers Builds

The one-time Queue creation and bot-specific runtime secrets must exist before enabling automatic production deploys.

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

Normal requests first go over the `KANAREK_COMPANION` service binding to the existing private free router. At the time this project was added, that router tries:

1. OpenRouter free models;
2. OrcaRouter `orcarouter/free`;
3. AIHubMix `coding-glm-5.3-free`;
4. Workers AI.

If the internal router itself is unavailable, times out, or its token is not configured, this Worker falls back to its own Workers AI binding (`@cf/zai-org/glm-4.7-flash`). Structured RSS validation remains part of the local fallback loop, so malformed curator output can still fall through to local Workers AI.

## Conversation context

Ordinary owner messages load up to eight recent successful chat turns from `TelegramConversationMemory`, with the model-facing history capped at roughly 8,000 characters. `/draft` stays stateless, command replies are not stored, and `/reset` clears the chat context. Conversation reads fail open to stateless chat, while reset generations prevent older retried deliveries from restoring cleared context. A turn is persisted only after Telegram accepts the reply and delivery is committed as `sent`; remembered assistant text is clipped to what fits in the delivered Telegram message, and memory persistence failures are logged without retrying an already-delivered message.

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
| `503` | `providers_unavailable` | `true` | shared router and local Workers AI both failed |
| `502` | `telegram_delivery_failed` | `true` | transient Telegram/network failure |
| `500` | `telegram_delivery_failed` | `false` | non-transient Telegram failure |
| `500` | `configuration_error` | `false` | required bot/chat configuration is missing |
| `500` | `internal_error` | `false` | unexpected processing failure |

A Telegram `429` response exposes `retryAfterSeconds` when Telegram provides it. Feedseek can retry only responses that explicitly say `retryable: true`.

## Telegram delivery

The webhook validates Telegram's secret header, parses a bounded update, and publishes it to `travny-tg-assistant-updates`. Only a successful Queue write gets `200 OK`.

Queue processing uses `TelegramUpdateDedup`, keyed by Telegram `update_id`, to cache the generated reply before sending. Known 429/5xx failures reset the state to `prepared`, so retries reuse the cached reply instead of repeating the model call. Telegram's `retry_after` is honored when available.

The send boundary has one unavoidable ambiguity: Telegram does not offer an idempotency key for `sendMessage`. If the network dies while a send is in flight, or the Worker stops after Telegram accepts the message but before state is committed, automatic replay could duplicate a message. The Worker therefore marks that update `ambiguous`, sends a diagnostic to the DLQ, and does not blindly resend it.

Non-retryable configuration/4xx errors are also copied to the DLQ and acknowledged. Retryable failures that exhaust `max_retries` are moved to the same DLQ by Cloudflare.

## Security boundaries

- Telegram webhook requests must carry the configured Telegram secret header;
- missing webhook/ingest secrets fail closed;
- chat accepts only `OWNER_TELEGRAM_USER_ID` in a private chat;
- Telegram and RSS request bodies are bounded before parsing/model use;
- voice notes are capped at 3 minutes / 2 MB, transcribed transiently, and only the bounded transcript enters short conversation memory;
- photos are capped at 5 MB, analyzed transiently, and only bounded text from the vision pass enters short conversation memory; image bytes are not persisted;
- shared locations, venues and contacts are normalized to bounded text; contact vCards and third-party metadata are not injected into the model context;
- shared polls are normalized to bounded question/options/vote context;
- RSS input and curator output lengths are bounded;
- RSS ingestion has a separate bearer secret;
- free-provider API keys stay in the private `kanarek-review` Worker, not this Worker;
- API keys never belong in source control;
- `/draft` produces text only and never sends messages on the owner's behalf;
- automatic replies to third parties are intentionally not enabled in this MVP.
