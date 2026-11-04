# Telegram assistant concept

## Goal

Keep an always-on personal assistant on Cloudflare while leaving heavyweight machine work to Hermes. The Cloudflare side should remain useful even when every phone/laptop is asleep, while reusing the infrastructure that already exists in `trvny/trvny`.

```text
Telegram
   │ webhook
   ▼
tg-assistant
   ├─ Queue + update-id state + DLQ
   ├─ RSS / drafts / reminders / lightweight assistant work
   │
   ├─ service binding ─► kanarek-companion free router
   │                    ├─ OpenRouter
   │                    ├─ OrcaRouter
   │                    ├─ AIHubMix
   │
   └─ heavy task ─────► existing pet-dispatcher-control
                        └─ pet-dispatcher-tasks
                               │
                           Legion today
                         Android later
```

## Responsibilities

### Cloudflare assistant

Good fit:

- chat and quick questions;
- filtering RSS/news/changelogs;
- scheduled summaries and reminders;
- summarising URLs supplied by trusted integrations;
- drafting replies;
- lightweight MCP/API integrations;
- receiving work while Hermes is offline;
- deciding whether a task needs Hermes.

Avoid turning it into a fake Linux machine. Repository clones, builds, package installation, arbitrary shell execution and long local jobs belong elsewhere.

The Telegram ingress Queue is only for Telegram delivery. Heavy jobs should reuse the existing Pet Dispatcher control plane rather than creating another general-purpose queue/control protocol.

### Telegram Serverless (optional new-feature runtime)

Telegram Serverless is an **additional option for future Botek features**, not a plan to migrate the existing `tg-assistant` Worker. Evaluate it feature by feature rather than moving established functionality just because a new runtime is available.

- **Keep the existing home:** Cloudflare stays the canonical Telegram update/webhook entry point for `@trvny_bot`, plus its Queues, Durable Objects, reminders/watches, Business/Secretary logic and Mini App control plane. Existing Kanarek routing, Specialist Intelligence/Engram, and Pet Dispatcher remain their own sources of truth.
- **Consider Serverless for isolated additions:** small Telegram-native games, quizzes, leaderboards, feature-local SQLite state, lightweight experiments, or self-contained Mini App modules/endpoints where the platform's current support and integration boundaries actually fit.
- **Do not fork the backend:** no second conversation memory, model/provider router, general-purpose scheduler, task dispatcher or copy of Botek command logic. A new module needing those capabilities should call a narrow authenticated API of the existing service, or stay in Cloudflare.
- **Protect the one-bot update path:** do not enable Serverless update handlers for `@trvny_bot` on the assumption that they can share its existing Cloudflare webhook. First verify whether the proposed Mini App-only/serverless feature can coexist without changing delivery, update subscriptions, or bot ownership. If that is not supported, leave the feature on Cloudflare or prototype it on a separate test bot.
- **Prototype before deployment:** start with a distinct BotFather test bot and one genuinely useful feature. Review early-access limits, runtime/SDK, network and credential handling, Telegram bot identity, rollback and database ownership before choosing Serverless for production. Keep `tgcloud` credentials and bot/API tokens out of Git; do not put external provider secrets in Mini App clients.

Reference: [Telegram Serverless documentation](https://core.telegram.org/bots/serverless). This is an architectural option, **not** authorization to turn on Serverless, switch the current webhook or create a parallel service today.

### Shared free-model router

The assistant should not duplicate provider credentials or fallback logic. `kanarek-companion` exposes the OpenAI-compatible review endpoint while the private `kanarek-review` Worker owns provider credentials, cooldowns and provisioning for OpenRouter, OrcaRouter and AIHubMix. The Telegram Worker calls the companion endpoint through a same-account Service Binding and keeps only the shared router bearer. Workers AI is temporarily reserved for SpaceMolt.

### Hermes workers

Good fit:

- clone/fetch repositories;
- edit files;
- run tests and builds;
- use `git`, `gh`, SSH and local tooling;
- inspect hardware/local files;
- perform longer autonomous engineering tasks.

The existing Pet Dispatcher control plane already provides a signed durable task envelope, Queue delivery, task state, cancellation, heartbeats and result reporting. It currently identifies the worker as `legion`. Generalizing it to multiple worker identities/capabilities is a later change; do not build a parallel handoff protocol inside `tg-bots`.

## Hermes bot portability

The same Telegram bot identity/token can be moved from Android to a Hermes installation on Legion. With the current polling setup, run only one Hermes Telegram gateway for that bot at a time; two concurrent `getUpdates` pollers will fight over the same bot. Stop the Termux gateway before starting the Legion gateway, or later put a single dispatcher in front of both workers.

Keep the Cloudflare assistant on a separate BotFather bot so its webhook never conflicts with the Hermes poller.

## Handoff design

Current Legion path, based on the existing Pet Dispatcher:

1. Cloudflare receives a heavy request, for example `sprawdź trvny/feedseek i odpal testy`.
2. The assistant calls the scoped Pet Dispatcher RPC through the `PET_DISPATCHER` same-account Service Binding; it does not store or send the operator control-plane bearer.
3. Pet Dispatcher creates the durable task state and enqueues the signed task on `pet-dispatcher-tasks`.
4. The Legion worker claims the task, heartbeats, and reports a result.
5. The assistant reads the result and forwards a concise summary to Telegram.
6. Multi-worker routing extends the existing dispatcher with worker identity/capability selection rather than creating a second task system.

## Botek roadmap

Botek has two maintained tracks: agent/integration work and Telegram-native UX. The detailed operational surface belongs in [cloudflare-assistant/README.md](cloudflare-assistant/README.md); this file keeps only product direction.

### Current state

- durable owner-scoped Telegram delivery with short per-chat/topic context, Rich Message streaming, reactions, callbacks and safe fallbacks;
- inline mode, Guest Mode, groups/topics, native polls/quizzes/dice/stickers/structured sends and bounded document/media context;
- Engram-backed explicit memory plus cue-triggered recall;
- one-shot reminders and proactive watches for Legion, GitHub PR conditions and Feedseek topics;
- Pet Dispatcher delegation with status/cancel controls, conservative repo-work auto-routing and terminal-result notifications;
- Telegram Business/Secretary drafts with isolated bounded context; optional contacts-only 12-hour Botek auto-reply remains fail-closed and cannot make consequential commitments;
- Mini App/control surfaces reuse existing services instead of creating new backends.

### Capability-first foundation

Botek should own **one identity, one Telegram ingress, one policy boundary, and one interaction model**. A capability is a reusable operation, not a command-shaped microservice. Chat commands, Rich Message buttons, callbacks, inline results, Mini App actions, and later bot-to-bot conversations may present the same operation through different interfaces.

- **Capability map:** maintain the implemented command inventory in `cloudflare-assistant/src/commands.ts`. The interactive catalog in `src/capability-catalog.ts` groups those existing commands by purpose and execution home; no fake capabilities or duplicate handler logic. The catalog is **descriptive**, never an authorization decision.
- **Interaction envelope:** keep origin (chat/user/topic/bot), intent, request/correlation ID, relevant permissions, deadline, result and reply destination distinct. Preserve existing Telegram update dedup and Pet Dispatcher job envelopes; don't launch a parallel scheduler or event bus.
- **Local first, delegate deliberately:** native Telegram operations and lightweight orchestration stay in `tg-assistant`. Existing memory/Feedseek/model specialists and Pet Dispatcher remain canonical. Future third-party bots are **optional providers** for a capability, not automatic owner-trusted agents.
- **Normal vs special operations:** passive chat/read commands can be low-friction. Mutating, paid, external-account, machine and cross-bot actions must use the current scope-specific authorization/approval policy and delivery auditing. Never infer consent from the presence of a callback or bot-to-bot message.
- **Bot collaboration:** Telegram supports bot-to-bot messages in groups and private chats with mode/configuration restrictions. Before enabling it, use an allowlisted peer identity, bounded hop count, request IDs, deduplication, rate limits, timeouts and a termination rule. Treat peer output as untrusted data, not owner instructions. No token-sharing or third-party bot impersonation.
- **Interleaved delivery:** improve Rich Messages, Telegram-native utilities and local capability handlers in small slices. Integrate one peer/service only when a real use case needs it. `@hermes_trv_bot` remains independent; access to its machine work goes through approved handoff paths.

Reference: [Telegram Bot-to-Bot Communication](https://core.telegram.org/bots/features#bot-to-bot-communication) and [Bot API changelog](https://core.telegram.org/bots/api-changelog).

### Product direction

Botek should feel like a Telegram-native operating surface, not a folder of large links. Chat is the command line; messages, inline results and Mini App views are alternate front ends to the **same** underlying capabilities. A prompt may start in chat, continue in a Mini App, and finish as a Telegram message or file.

- **Owner plane:** private work, documents, automations, Legion, GitHub, approved actions.
- **Guest plane:** useful public tools for people and peer bots, with scoped permissions and per-sender rate limits; never owner memory or machine access.
- **Public TRAVNY plane:** anonymous contact and deliberately shared tools, without a Telegram account or phone number.
- **Broadcast plane:** opt-in channel/news publishing, distinct from private messages and Business/Secretary.
- **Hermes remains separate:** `@hermes_trv_bot` owns the Hermes/Termux gateway. `@trvny_bot` owns the wider Telegram experience. Pet Dispatcher stays the bridge for approved machine work.

### Interactive Bench integrations (replace link-only tiles)

Existing Control Center tiles merely call `Telegram.WebApp.openLink` for Codebench, Streambench and Docbench. Keep their standalone sites, but replace the Mini App's link-only behavior with usable flows. Reuse real Bench code/APIs where feasible; do not fork three full applications into `tg-assistant`.

#### Docbench: Draft Studio

**V1 delivered:** Owner-only `/doc` and `/draft new` open the existing Mini App editor. Markdown/text templates, safe preview, import/export, opt-in unencrypted device-only saving and explicit private-chat `sendDocument` are implemented. Existing `/draft <text>` is preserved. Rich rendering, PDF/DOCX conversion, chat/message import, encrypted persistence and broader share targets remain future scope.


**Desired flow:** `/doc`, `/draft new` or a "Create document" button opens a scoped editor **inside Telegram**. Keep existing `/draft <text>` reply drafting and the current bare `/draft` usage handler intact unless deliberately migrated with compatibility tests. Write/edit markdown or rich text, attach a message/file, inspect a preview, then send the document back to the chat, save an explicit draft, or export it.

- V1: plain text/Markdown editor, autosave only after clear opt-in, templates, preview, share/send to the current conversation, export `.txt` and `.md`.
- V2: existing Docbench rendering/conversion where its interface supports reuse; `.html`, `.pdf`, possibly `.docx`, plus document import and formatting presets. Verify actual worker/client conversion interfaces before promising formats.
- Import Telegram content only from explicitly replied-to/forwarded messages, user-uploaded files, or a voluntarily supplied chat export. Bot API does **not** grant arbitrary historical access to someone's chats.
- Export a selected message/thread as Markdown/JSON/JSONL with timestamps, author labels, provenance, attachments or safe links when available; offer redaction before sharing or publishing. Manual Telegram Desktop export import is a separate, consent-based path.
- Keep the composer useful offline where feasible; encrypted/private draft handling, bounded attachments, no accidental server retention. Large documents use a scoped API, not `WebApp.sendData` as a bulk transport.
- Add a bounded `sendDocument` upload method to the **existing** Telegram transport/allowlist; there is no dedicated document-send wrapper today. Reuse the existing delivery guards and Docbench conversion functions where they actually exist, instead of silently sending drafts to an AI provider.

**Done when:** a user can compose inside the Mini App and receive a real file in their Telegram chat without navigating to the standalone Docbench page.

#### Streambench: native radio session

**Desired flow:** `@trvny_bot dawaj muze` (or `/radio`) replies with a compact station/now-playing card and a **Play in Botek** Mini App button. It opens a real audio player, not the current Streambench link tile.

- V1: Radio Paradise Main Mix, play/pause, volume, station icon/cover, title, artist, live state, fallback art, and "More stations." Share the existing `pages/astro/src/components/RadioMini.astro` interaction pattern and `pages/functions/api/radio-now.js` metadata endpoint instead of duplicating upstream scraping.
- The Pages metadata response currently has no cross-origin allowance for the Telegram Worker's Mini App. Provide a small **same-origin, fixed-upstream** metadata relay in `tg-assistant` (or a narrowly authorized CORS policy) before wiring the player. Cache briefly; never create an arbitrary URL proxy.
- V2: station picker/favorites and playlist import from Streambench's maintained catalog; verify each upstream station's embed/CORS/format/rights before exposing it. Preserve Streambench as the streaming catalog/player source of truth.
- Prefer HTML5 audio inside the Telegram Mini App, opened by `web_app` button or `?startapp=radio` deep link when the Main Mini App is configured. Playback may **require a user tap** due to browser and Telegram client autoplay policies. No promise of sound starting automatically from a bot message.
- Telegram `sendAudio` is for an audio file, not a guarantee of an indefinitely playing live radio stream. Do not upload copyrighted streams or proxy arbitrary remote URLs.
- Optional now-playing rich card in chat with refresh/share buttons; source availability and metadata age must be visible.

**Done when:** saying "dawaj muze" produces a station card and opens an actual in-Telegram player with one tap. Check Android/iOS/Desktop separately.

#### Codebench: useful chat-native shortcuts

- Generate QR/barcode from a replied-to link/text via bot response; scan a code in a Mini App with camera permission and paste/share decoded content.
- Respect camera permissions, input sanitization and device support; use the existing Codebench implementation, not a second codec toolkit.
- Promote frequent actions as compact tool commands or contextual buttons; keep the standalone Bench for advanced use.

### Public TRAVNY ↔ Botek inbox

**Desired flow:** a visitor opens `travny.pages.dev` and uses "Send a message" without logging into Telegram, exposing a phone number or opening a Botek chat. The owner receives a private Botek notification that somebody actually sent something.

- Build a small public form/guest messaging endpoint in the **existing Pages Functions**. Only deliberate Send/Request actions create owner alerts; don't silently report ordinary visits or track everyone who clicks around.
- Server-to-server handoff to the existing `tg-assistant` delivery path using a scoped secret/service authorization; never expose the bot token, owner chat ID, or direct Telegram send method in browser code.
- Choose **one canonical inbox store in `tg-assistant`** (a scoped Durable Object with bounded retention and receipt IDs). Pages Functions submit via a narrow authenticated create API; owner Telegram/Mini App views read the same stored item. Persist and dedupe before notifying; queue/retry the alert without creating a second inbox or losing the receipt when Telegram delivery fails.
- Anonymous by default: optional nickname/contact method, clear reply expectations, a random receipt ID and basic privacy notice. No forced Telegram account, phone or email.
- Spam defenses: tight per-origin/session limits, size/attachment bounds, bot screening/Turnstile if needed, dedupe and delivery failure handling. Minimize IP retention.
- V1: one-way visitor → private owner Botek notification, with URL/page context if voluntarily relevant, and a link to the persisted inbox entry. Define storage expiry and the response shown if submission or notification fails; never claim delivery solely because the request was accepted.
- V2: optional two-way replies through an expiring, unguessable receipt link or an explicitly provided return address. Separate opt-in consent and abuse controls; no public exposure of Business/Secretary messages.
- Keep a single inbox source of truth. Website and Telegram render the same item; notification is only delivery, not a second message store.

**Done when:** a visitor without Telegram can submit a short message and the owner sees one well-identified Botek alert, with a safe spam limit.

### Feedseek news desk and broadcast channel

**Desired flows:** `@trvny_bot co tam w świecie polityki` answers in chat, `/news politics` works without magic words, and an opted-in Telegram channel gets nicely formatted periodic updates.

- Read Feedseek through the maintained `BOTEK_SPECIALISTS.feedseekRecent` boundary (`cloudflare-assistant/src/types.ts`); preserve item link, source, publication time and freshness. No second RSS fetcher or copy of the feed index.
- **AI healthy:** rank, cluster and briefly summarize retrieved items, with source links, timestamp and factual/neutral framing. Reject invented citations, unverified details and unsupported political claims.
- **AI unavailable:** deterministic source-only fallback. Choose latest fresh eligible entries, optionally a visibly labeled rotation/random pick **from the fetched items**, and format metadata without model-generated interpretation. Do not invent a headline or imply a stale item is breaking news.
- V1: private chat/on-demand topics (`politics`, `tech`, `games`, `science`, `local`), compact rich cards with source links, "More", "Watch topic" and "Send to channel" controls.
- V2: channel publishing by explicit owner opt-in; bot must be channel admin with posting rights. Topic selection, schedule, quiet hours, digest size, per-source diversity, duplicate ledger, manual publish and pause. Avoid cross-posting private chats.
- Personalization can reuse explicit Engram preferences, but public channel editorial rules must be owner-configured and independent of private memory.
- Track successful Telegram delivery and stop on permission loss, 429, duplicate requests or invalid source items. Periodic jobs reuse the current scheduler/watch infrastructure where it fits.

**Done when:** a politics request works with **no AI provider online**, and channel mode never requires an AI response to publish verified Feedseek links.

### Cross-cutting features and experiments

These were proposed alongside the Bench/news/inbox ideas. Keep them in **this same roadmap**, rather than making competing issue/plan documents.

| Area | Ideas | Scope and reuse |
| --- | --- | --- |
| Approval Inbox | explicit approval/deny/expiry for consequential actions; audit receipts; typed multi-step flows | Owner-only, short opaque callbacks; reuse Pet Dispatcher task policy and existing Durable Objects |
| GitHub War Room | PR state, CI, review summaries, action buttons, deployment status and project alerts | Read via approved GitHub integration; write only through GPTomek/policy-gated actions |
| Watchtower | reminder/watch dashboard, fresh/stale state, pause/cancel, better notifications | **Current:** owner Mini App read/cancel shipped in PR #1272; fix in-flight cancellation race in issue #1273 before stronger guarantees |
| Agent Arena | bounded Botek ↔ Hermes/other bot collaboration, debate, handoff and summarized outcomes | Check current bot-to-bot Telegram support in a test chat; owner approval, hop/turn limits and signed envelopes; no webhook/poller collisions |
| Media Forge | voice transcription, OCR, PDF/Office extraction, format conversion, captioning and previews | Local/approved providers for heavy conversion; file-size, copyright, privacy and retention limits |
| Rich chat UX | interactive messages, expandable results, topic-scoped actions, inline share, private replies | Detect client/Bot API support and provide plain-message fallback; keep callback handling centralized |
| Device cockpit | Legion health, process/task view, QR pairing, permissions, Android shortcut and optional geolocation | Existing Pet Dispatcher task/state truth; consent and explicit scoped capability per action |
| Botek Lab | opt-in experiments, little games, quizzes, polls, shareable cards, feature flags | Sandbox unsafe novelty; no extra production webhook or general-purpose scheduler |
| Automation | recurring digests, smart quiet hours, event watches, approval reminders, proactive alerts | Existing cron/Watchtower/DO primitives; per-target limits and kill switches |
| Public experience | no-account contact, guest tools, deliberate visitor alerts, shareable read-only results | TRAVNY Pages + bounded Botek handoff; never leak owner data to anonymous visitors |
| Platform watch | Bot API release/drift review, new Mini App capabilities and framework patterns | Follow `FRAMEWORK-AUDIT.md`; adopt a capability for a real use case, not just a new SDK |

### Recommended delivery sequence

These are parallel delivery tracks, not a single giant migration. The capability and permission foundations precede any new cross-bot execution path; Telegram-native UX may improve between integration slices.


1. **P0 — Working radio flow.** Reuse the current RadioMini/metadata pair; add chat command/mention handler, now-playing card and working Mini App player. Browser playback needs an explicit tap. Test on Android Telegram first.
2. **P0 — Draft Studio V1.** Telegram-native composer plus `.md`/`.txt` export and send-back to chat. Separate drafts from external AI/Docbench rendering until consent and API capability are confirmed.
3. **P1 — News on demand.** Source-grounded Feedseek cards with deterministic no-AI fallback; only then add channel schedule/admin delivery.
4. **P1 — Anonymous TRAVNY inbox.** Rate-limited submit-only MVP plus private Botek alert. Add return/reply links only after storage, privacy and abuse model are tested.
5. **P1 — Approval Inbox and GitHub War Room.** Build durable user decisions and safe follow-through before more write integrations.
6. **P2 — Advanced export, multiple Bench tools, Agent Arena, device pairing and broader Lab ideas.** Add only after the corresponding access model and tests exist.

### Implementation rules

- **One home per concern.** `tg-assistant` owns the bot webhook/Telegram delivery and Mini App; TRAVNY Pages owns public web input; Bench owns its rendering/player/catalog; Feedseek owns items; Kanarek owns model routing; Engram owns memory; Pet Dispatcher owns machine tasks.
- **No invisible permissions.** Owner, guest, public visitor and channel publisher are separate roles. Validate Telegram `initData` on the server, never trust `initDataUnsafe`, and authorize every write at the API boundary.
- **Treat chat as an interface, not unlimited history.** Bots receive only Telegram-delivered updates and explicitly shared media. Arbitrary private conversation exports require manual user action.
- **Keep offline/provider fallbacks honest.** Missing AI means selection/formatting of real data, not fake summaries. Missing media stream means a clear unavailable status.
- **Bound state and cost.** Short-lived tokens, limited file sizes, rate limits, idempotent sends, DLQ/retries as appropriate, timeout/cancel, observability, rollback.
- **Design as a slice.** Each feature should include a chat entry point, an actual working UI/action, permissions, a recovery path, and a test. A bigger link tile is not a shipped feature.

Reference docs: [Telegram Bot API](https://core.telegram.org/bots/api), [Telegram Mini Apps](https://core.telegram.org/bots/webapps), and [Telegram deep links](https://core.telegram.org/api/links). Framework patterns and implementation order: [FRAMEWORK-AUDIT.md](FRAMEWORK-AUDIT.md).

Keep Telegram as the control surface while Cloudflare, Kanarek routing, Engram and Pet Dispatcher remain the canonical backend pieces. Do not add parallel command-specific services.

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.