# Cloudflare Telegram assistant

Small 24/7 Telegram assistant designed to stay cheap and boring to operate. Cloudflare handles everyday chat and RSS curation; Hermes remains the heavyweight worker for repo/build/test jobs.

## What exists now

- owner-only Telegram webhook; private chat is conversational, while groups/supergroups require explicit owner `/ask` or native ephemeral `/whisper`;
- durable Telegram update delivery through Cloudflare Queues;
- persistent `update_id` state in a SQLite Durable Object;
- dead-letter queue for exhausted or non-replayable Telegram deliveries;
- /help, /ask <question>, /status, /draft <message>, /remember, /recall, /memory_status, /remind, /reminders, /remind_cancel, /poll, /quiz, /dice, /sticker, /location, /venue, /contact, and /reset; group-only `/whisper <question>` is advertised as an ephemeral command only to the owner;
- /start and /help self-sync the owner-scoped Telegram command list and command menu from code;
- bounded per-chat conversation context for ordinary messages;
- owner `/ask <question>` works in groups and forum topics; other group traffic is ignored, replies use typing instead of private-chat drafts, and short memory stays isolated by chat/topic; the first visible `/ask` in a chat also syncs the owner-only group command scope so `/whisper <question>` can arrive as a native ephemeral command and receive a stateless private reply within Telegram's short delivery window;
- private-chat topics keep replies, thinking indicators and short conversation memory inside the originating topic;
- `/topic <name>` creates a native private-chat topic when Botek topic mode is enabled in Telegram;
- native Telegram reply-to behavior plus rate-bounded live `sendRichMessageDraft` streaming for model-backed replies, with plain-draft and typing fallbacks;
- Bot API 10.3 generation-stop controls abort active streamed replies, bypass the serialized update queue, and preserve the generated partial as a normal message when possible;
- model-backed replies use Telegram Rich Messages up to 32,768 characters; deterministic Markdown rejection retries as escaped Rich HTML before the legacy 4,096-character plain-text fallback;
- best-effort native reactions show state for model-backed owner messages (`👀` while working, `👍` after successful delivery, `👎` on handled failures, `🤨` when delivery is ambiguous);
- ordinary private model replies expose owner-only `👍 Pomogło` / `👎 Słabo` callback feedback; one rating per bot reply is kept as bounded telemetry and never enters model context;
- `/status` uses a native Rich Message table plus expandable fallback details, with the existing refresh callback editing the same structured view and a plain-text fallback for deterministic Rich Message rejection;
- Telegram-native button styles distinguish primary actions, successful copy actions and destructive task cancellation;
- native clipboard button on short `/draft` suggestions;
- `/task <repo> <polecenie>` delegates bounded code tasks to the Legion through the existing Pet Dispatcher RPC surface, with inline status/cancel controls and proactive terminal-result notifications;
- `/remind 15m | tekst` stores a bounded one-shot reminder (relative minutes/hours/days, up to 30 days); `/reminders` lists active entries and `/remind_cancel <id>` removes one; delivery reuses the existing minute cron;
- `/watch`, `/watches` and `/watch_cancel` share one durable proactive-watch registry: Legion online/offline transitions and GitHub PR conditions are one-shot, while Feedseek topic watches stay active and deduplicate already-seen entries; the same minute cron evaluates all sources with source-specific intervals and short claims to avoid duplicate notifications;
- `/remember <tekst>`, `/recall <pytanie>` and `/memory_status` use the existing Engram specialist core through a narrow same-account Service Binding; the Telegram Worker never receives the Engram credential; ordinary private text also performs a bounded best-effort recall only on explicit prior-context cues, and retrieved memory is injected as non-instruction context;
- owner-only stateless inline mode can answer `@trvny_bot <query>` from other chats, with a native shortcut on `/start` and `/help`; rapid query edits are coalesced before model work;
- optional Telegram Guest Mode lets the owner summon Botek with `@trvny_bot` in chats where the bot is not a member; guest replies are stateless, bounded, one-shot, and explicitly barred from private memory or acting on the owner's behalf;
- optional Telegram Business/Secretary draft mode watches only the owner's enabled Business connection, keeps an isolated six-entry text/caption context per connection+chat from updates Botek actually receives, and turns supported incoming third-party messages into a private suggestion; it never sends the suggestion back to the third party automatically;
- owner voice notes and bounded audio uploads transcribed with Workers AI Whisper before normal assistant routing;
- owner photos/screenshots support native Telegram albums: items sharing `media_group_id` are briefly coalesced, ordered and deduplicated; pure photo albums analyze up to six photos, while mixed photo/video albums keep one ordered request with full photo analysis plus video metadata and bounded thumbnail analysis;
- videos, video notes and animations use bounded Telegram metadata plus best-effort thumbnail vision; full media bytes are not downloaded or claimed as inspected;
- owner-shared locations, venues, contacts, polls, checklists, stickers and Telegram dice normalized into bounded assistant context; checklist task additions/status changes are captured when quoted or forwarded instead of causing unsolicited bot replies;
- `/poll question | option 1 | option 2` sends a native non-anonymous Telegram poll with 2–12 options;
- `/quiz question | +correct | wrong | +also correct` sends a native quiz; prefix each correct answer with `+` (`++text` escapes a literal leading plus);
- `/dice [🎲|🎯|🏀|⚽|🎳|🎰]` sends Telegram's native random dice/game animation;
- replying `/sticker` to a sticker resends that exact Telegram sticker by `file_id`;
- `/location`, `/venue` and `/contact` send native Telegram structured messages from bounded owner-only command input;
- owner-shared text/code documents downloaded transiently with strict size/type bounds and injected as untrusted document data;
- replies and forwarded messages are normalized into bounded untrusted context; forwarded command-looking text cannot trigger owner commands;
- shared free-model routing through the existing Kanarek Companion router;
- local Workers AI emergency fallback;
- `POST /ingest/rss` for Feedseek/RSS curation;
- explicit RSS retry/error contract;
- `GET /health` for smoke checks;
- no server, polling loop, or always-on phone process.

Engram-backed long-term memory, broader Telegram Business send-on-behalf workflows, and Hermes handoff are deliberately left for later slices rather than faked into the MVP.

## Roadmap

The detailed Botek roadmap lives in
[`../CONCEPT.md`](../CONCEPT.md#botek-roadmap), so the agent/integration plan
and Telegram-native feature plan have one maintained source of truth.

The framework-pattern audit lives in
[`../FRAMEWORK-AUDIT.md`](../FRAMEWORK-AUDIT.md). It records which ideas from
Go Telegram frameworks are worth porting into Botek without replacing the
Cloudflare/TypeScript runtime.

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
        ├─ OrcaRouter `orcarouter/free`
        ├─ AIHubMix `coding-glm-5.3-free`
        └─ Workers AI
```

The private `kanarek-review` Worker owns provider credentials, fallback/cooldown behavior, and Workers AI fallback behind the companion proxy. The Telegram assistant needs only the existing `KANAREK_REVIEW_ROUTER_TOKEN`; if that route is unavailable it can still use its own Workers AI binding.

Future heavyweight jobs should reuse the existing `pet-dispatcher-control` + `pet-dispatcher-tasks` transport instead of creating another task-control plane. The current dispatcher targets the Legion; multi-worker Android/Legion routing is a later extension.

Manual `/task` delegation can opt into a bounded network profile with
`/task <repo> --net <profile> <polecenie>`. Allowed profiles are
`github-read`, `npm-read`, `github-npm-read`, and `android-read`.
Without `--net`, delegated agents keep `network=none`; automatic
natural-language task routing never grants network access. The Pet Dispatcher
control plane independently enforces the same profile allowlist. Brokered CLI
traffic is confined to the profile's exact HTTPS hosts through the local proxy,
so this is not general Internet access and does not expose host credentials.

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

Then create a local `.dev.vars` containing the Telegram token and webhook secret and register the production webhook. The helper subscribes to `message`, `inline_query`, `callback_query`, `stopped_message_generation`, `guest_message`, `business_connection`, and `business_message` updates:

```bash
npm run webhook:set -- https://<worker>.workers.dev/telegram/webhook
npm run webhook:info
```

`/start` and `/help` also best-effort reassert the current webhook URL, secret and allowed update types, so Telegram-native controls can self-heal after a deployment. Telegram can point a bot to only one webhook at a time. Keep the Cloudflare assistant on a separate BotFather bot from the Hermes polling bot.

### Enable Telegram inline mode

Inline mode itself is a BotFather capability and cannot be enabled through the Bot API. In `@BotFather`, run `/setinline`, choose `@trvny_bot`, and set a placeholder such as `Zapytaj Botka…`. Then send `/start` to Botek once so the Worker reasserts the webhook update types. Inline queries are owner-only and stateless. A small Durable Object debounce keeps superseded keystroke queries from fanning out model calls, while an inline-specific short router/fallback deadline keeps answers inside Telegram's query lifetime. The generated answer is sent only after the owner taps the result. Runtime webhook sync and the setup helper both read allowed update types from `telegram-config.json`.

### Enable Telegram Guest Mode

Guest Mode is also opt-in at Telegram, not something the Worker can enable itself. In BotFather's bot settings, enable **Guest Mode** for `@trvny_bot`, then send `/start` to Botek once so the webhook subscription is refreshed. Telegram can then deliver a `guest_message` when the owner mentions Botek in a supported chat or replies to one of its guest replies, even if Botek is not a member of that chat. Botek answers exactly one guest query through `answerGuestQuery`.

The Worker accepts guest queries only when `guest_message.from.id` matches `OWNER_TELEGRAM_USER_ID`. Guest mode deliberately has no private conversation memory or tool/action surface: quoted chat content is untrusted context, and Botek will not make commitments, authorize payments, schedule work, or claim to act on the owner's behalf from a guest query. Failed/ambiguous guest delivery is logged but never turned into an automatic webhook retry that could duplicate a one-shot reply.

### Enable Telegram Business / Secretary drafts

Connect Botek as a Telegram Business bot for the owner's account and grant only the rights needed for the workflow being tested. The webhook subscribes to `business_connection` and `business_message`. Every incoming Business message is revalidated with `getBusinessConnection`; the connection must be enabled and its `user.id` must match `OWNER_TELEGRAM_USER_ID`.

Secretary mode remains deliberately **draft-only**. Botek keeps at most six recent text/caption Business updates per Business connection + chat in an isolated `TELEGRAM_MEMORY` Durable Object instance. Each entry is capped at 600 characters and carries only owner/contact direction plus the Telegram timestamp when present. Media bytes and private Botek conversation memory are never added to this context. Context reads/writes fail open, so a Durable Object problem falls back to the existing single-message draft behavior, and private `/reset` does not erase Business context.

The model sees that tiny history and the current incoming message as explicitly **untrusted data**, then produces a suggested reply through the stateless short-deadline path. The suggestion is sent privately to `TELEGRAM_OWNER_CHAT_ID` (or the connection's `user_chat_id` fallback) with an explicit `Nic nie zostało wysłane za Ciebie.` footer. `getUserPersonalChatMessages` is not used for this: Telegram defines it as the user's profile personal-chat surface, not direct-message conversation history.

No Business API method that acts on the owner's behalf is used here: no automatic reply, read receipt, deletion, scheduling, payment, task execution or commitment. Broader Secretary actions belong to later opt-in slices with separate permissions and explicit approval boundaries.

### Telegram profile tooling

The local helper can manage Botek's profile photo without adding runtime webhook code: `npm run telegram:profile -- set <photo.jpg>`, `npm run telegram:profile -- set <animation.mp4> [--frame <seconds>]`, or `npm run telegram:profile -- remove`. It also manages Telegram's localized bot text surfaces: `name <text>`, `description <text>`, and `short-description <text>`, each with optional `--lang <xx>`. Telegram's limits are validated locally (64 / 512 / 120 characters) before the API call. The helper loads `TELEGRAM_BOT_TOKEN` from the environment or local `.dev.vars` and never logs it.

Telegram currently exposes profile audio to bots only as a read surface. Inspect the configured owner's profile audio with `npm run telegram:profile -- audio`, or inspect another numeric user ID with `npm run telegram:profile -- audio <user-id> --limit <1..100>`. The helper prints bounded audio metadata only; it does not download audio files, and Bot API does not expose a method for Botek to set profile audio.

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

Normal chat asks the shared OpenAI-compatible router for `stream: true`. Final Rich Messages use Telegram's 32,768-character rich-text budget while short conversation memory stays deliberately bounded to 4,096 assistant characters per turn. Streaming providers are consumed incrementally and coalesced into at most one Telegram draft update per second; if the router selects a non-streaming fallback, Botek simply keeps the native Thinking placeholder until the final reply. If a partial rich draft is rejected deterministically, that generation switches to plain Telegram drafts instead of failing the answer. Drafts expose Telegram's native stop control. A `stopped_message_generation` update is written directly to the draft's Durable Object instead of waiting behind the serialized queue; the active stream polls that state, cancels consumption, skips provider fallback, and sends the bounded partial text as the final message so Telegram's temporary stopped draft does not evaporate.

If the internal router itself is unavailable, times out, or its token is not configured, this Worker falls back to its own Workers AI binding (`@cf/zai-org/glm-4.7-flash`). Structured RSS validation remains part of the local fallback loop, so malformed curator output can still fall through to local Workers AI.

## Conversation context

Ordinary owner messages load up to eight recent successful chat turns from `TelegramConversationMemory`, with the model-facing history capped at roughly 8,000 characters. `/draft` stays stateless, command replies are not stored, and `/reset` clears the chat context. Conversation reads fail open to stateless chat, while reset generations prevent older retried deliveries from restoring cleared context. A turn is persisted only after Telegram accepts the reply and delivery is committed as `sent`; remembered assistant text is clipped to what fits in the delivered Telegram message, and memory persistence failures are logged without retrying an already-delivered message.

Private model replies also keep a separate bounded feedback ledger in the same Durable Object: at most 64 bot message IDs with the owner's latest `up`/`down` rating. Re-rating the same reply overwrites the previous value. This telemetry is not returned by `/history`, never enters a model prompt, and survives `/reset` because resetting conversational context is a separate concern.

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
- voice notes are capped at 3 minutes / 2 MB; audio uploads are capped at 10 minutes / 5 MB; both are transcribed transiently and only bounded transcript context enters short conversation memory;
- photos are capped at 5 MB each and analyzed transiently; photo/video albums inspect at most six visual items, video files themselves are not downloaded, and only bounded text/metadata summaries persist, never raw image or video bytes;
- video/animation previews use only Telegram metadata and thumbnails capped at 512 KB; the full media file is not downloaded;
- shared locations, venues and contacts are normalized to bounded text; contact vCards and third-party metadata are not injected into the model context;
- shared polls are normalized to bounded question/options/vote context;
- stickers and dice expose only bounded Telegram metadata such as emoji/set/type and dice result; sticker files are not downloaded in this slice;
- text/code documents are capped at 512 KB, decoded as UTF-8, clipped before model use, and never persisted as raw file bytes;
- replied-to and forwarded message bodies are bounded and framed as untrusted data; forwarded text cannot enter the owner command parser;
- Secretary/Business messages are accepted only through an enabled owner Business connection; text/captions are bounded before model use, and at most six 600-character entries per connection+chat are kept in an isolated fail-open context that never enters private Botek conversation memory;
- Secretary history and the current message are explicitly framed as untrusted data; media is not retained, private `/reset` does not touch Business context, and `getUserPersonalChatMessages` is not treated as DM history;
- Secretary mode produces a private suggestion only; it does not reply through the Business connection, mark messages read, delete messages, schedule work, make payments or take other third-party actions;
- RSS input and curator output lengths are bounded;
- RSS ingestion has a separate bearer secret;
- free-provider API keys stay in the private `kanarek-review` Worker, not this Worker;
- API keys never belong in source control;
- `/draft` produces text only and never sends messages on the owner's behalf;
- automatic replies to third parties are intentionally not enabled in this MVP.