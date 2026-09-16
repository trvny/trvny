# Telegram assistant concept

## Goal

Keep an always-on personal assistant on Cloudflare while leaving heavyweight machine work to Hermes. The Cloudflare side should remain useful even when every phone/laptop is asleep, while reusing the infrastructure that already exists in `trvny/trvny`.

```text
Telegram
   │ webhook
   ▼
travny-tg-assistant
   ├─ Queue + update-id state + DLQ
   ├─ RSS / drafts / reminders / lightweight assistant work
   │
   ├─ service binding ─► kanarek-companion free router
   │                    ├─ OpenRouter
   │                    ├─ OrcaRouter
   │                    ├─ AIHubMix
   │                    └─ Workers AI
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

### Shared free-model router

The assistant should not duplicate provider credentials or fallback logic. `kanarek-companion` exposes the OpenAI-compatible review endpoint while the private `kanarek-review` Worker owns provider credentials, cooldowns and provisioning for OpenRouter, OrcaRouter, AIHubMix and Workers AI. The Telegram Worker calls the companion endpoint through a same-account Service Binding and keeps only the shared router bearer.

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

Future slice, based on the existing Pet Dispatcher:

1. Cloudflare receives a heavy request, for example `sprawdź trvny/feedseek i odpal testy`.
2. The assistant calls `pet-dispatcher-control` with a scoped control-plane credential.
3. Pet Dispatcher creates the durable task state and enqueues the signed task on `pet-dispatcher-tasks`.
4. The available Hermes/device worker claims the task, heartbeats, and reports a result.
5. The assistant reads the result and forwards a concise summary to Telegram.
6. Multi-worker routing extends the existing dispatcher with worker identity/capability selection rather than creating a second task system.

## Botek roadmap

The target is not just an AI behind a Telegram chat. Botek should become a capable personal agent and a first-class Telegram application. Development therefore has two parallel tracks that converge on one maintained backend.

### Implemented baseline

- owner-only Telegram webhook with explicit `/ask` or ephemeral `/whisper` opt-in for group/supergroup replies;
- durable Telegram update queue, update-id deduplication and DLQ;
- shared free-model router with local Workers AI fallback;
- /ask, /draft, /status, /help, /poll, /quiz, /dice, /sticker, /location, /venue, /contact and /reset, plus owner-only group `/whisper` as a native ephemeral command;
- owner-scoped Telegram commands and command menu self-synced from the Worker;
- bounded recent conversation context with reset generations;
- private-chat topic mode and explicit group `/ask` keep Telegram delivery and short memory isolated per chat/topic;
- native private-chat topic creation through `/topic <name>`;
- native reply-to delivery plus rate-bounded live Rich Message drafts with plain-draft and typing fallback for model-backed replies, including Bot API 10.3 stop-generation handling;
- model-backed replies sent as Telegram Rich Messages with the 32,768-character rich-text budget and deterministic escaped-Rich-HTML/plain fallback when Telegram rejects Markdown formatting;
- best-effort native message reactions for model-backed owner messages (`👀` while processing, `👍` after successful delivery, `👎` on handled failures, `🤨` on ambiguous delivery);
- `/status` rendered as a native Rich Message provider table with expandable fallback details, refreshed in place through callback queries;
- native button colors distinguish primary, success and destructive inline actions;
- native clipboard action on short `/draft` suggestions;
- manual `/task <repo> <polecenie>` delegation to the Legion through the scoped Pet Dispatcher RPC entrypoint, with inline status/cancel controls;
- owner-only stateless Telegram inline answers for `@trvny_bot <query>` plus an inline-mode shortcut, Durable Object debounce for rapid edits, and an inline-specific response deadline;
- owner-only Telegram Guest Mode for one-shot stateless replies in chats where Botek is not a member, with no private-memory/tool access and no acting on behalf of the owner;
- owner-only Telegram Business/Secretary draft mode for bounded incoming third-party text/captions: the Business connection is revalidated against the owner, model work is stateless, and only a private suggestion is delivered to the owner with no automatic send-on-behalf;
- owner voice notes and bounded audio uploads transcribed through Workers AI Whisper and routed into normal chat;
- owner photos and screenshots analyzed transiently through Workers AI vision, including bounded `media_group_id` album coalescing with up to six ordered photo analyses and text-only context persisted;
- video, video-note and animation inputs use bounded metadata plus thumbnail-only vision without downloading the full media;
- owner-shared locations, venues, contacts, polls, stickers and Telegram dice normalized into bounded chat context;
- native owner-created polls through `/poll question | option 1 | option 2`;
- native multi-answer quizzes through `/quiz question | +correct | wrong | +also correct`;
- native Telegram dice/game sends through `/dice [🎲|🎯|🏀|⚽|🎳|🎰]`;
- native sticker resend by replying `/sticker` to an existing Telegram sticker;
- native owner-only location, venue and contact sends through structured commands;
- owner-shared text/code documents read transiently with bounded UTF-8 content and untrusted-data framing;
- owner-shared Telegram checklists normalized directly, with task-added/task-status service updates captured as bounded untrusted reply/forward context rather than standalone triggers;
- same-chat reply context and forwarded messages normalized into bounded untrusted context, with forwarded command text kept outside the owner-command path;
- Feedseek/RSS curation endpoint;
- health/status endpoint.

### Track A: agent brain and integrations

1. **Hermes / Legion handoff** — manual bounded `code` delegation through Pet Dispatcher RPC plus inline status/cancel is implemented. Next add automatic heavy-task routing, richer task profiles, progress/result notifications and broader local-tool workflows without bypassing the dispatcher security boundary.
2. **Long-term memory** — add explicit remember/forget flows and Engram-backed retrieval on top of the current short conversation window, with clear retention boundaries for private chat data.
3. **Multimodal work** — voice notes, bounded audio uploads, owner photos/screenshots and bounded text/code documents are implemented; add PDF/office extraction and richer media backends next.
4. **Tool routing** — let normal language invoke approved GitHub/GPTomek, Cloudflare/status, Feedseek/RSS, web/search and other integrations without requiring a dedicated command for every capability.
5. **Scheduler and proactive assistance** — add briefings, reminders, condition watches, important RSS/CI/service alerts and completed-task notifications while avoiding noisy low-value notifications.
6. **Reply assistant** — human-in-the-loop drafts now include the first Telegram Business/Secretary slice: bounded incoming third-party text/captions produce a private stateless suggestion only. Future low-risk auto-answering remains opt-in; money, commitments, dates, private matters and ambiguous requests stay approval-only.
7. **Task UX** — expose delegated work through commands or controls such as `/tasks`, status, cancellation and result retrieval.

Suggested order: Hermes/Legion handoff → long-term memory → multimodal input → tool routing → proactive workflows.

### Track B: Telegram-native experience

1. **Native chat UX** — reply-to delivery, live Rich Message streaming with safe fallbacks, native generation stop, Telegram Rich Message formatting and a structured Rich Message `/status` view are implemented; next expand structured blocks to task/GitHub/research reports and richer editing without chains of status messages.
2. **Inline keyboards and callbacks** — callback plumbing, `/status` refresh and short-draft clipboard actions are implemented; extend buttons to confirmations, task controls, model choices, retries and other frequent actions.
3. **Command/menu synchronization** — owner-scoped commands and the native command menu are synced from code on `/start` or `/help`; add localization when Botek gains additional user-facing languages.
4. **Reactions and lightweight feedback** — model-backed owner messages now use best-effort state reactions for processing, success, handled failure and ambiguous delivery. Native reaction feedback from the owner is not relied on in the private chat because Bot API reaction updates require bot administrator access; use callbacks for explicit feedback where needed.
5. **Inline mode** — owner-only stateless `@trvny_bot ...` answers are implemented for quick ask/summarize/translate flows; next add richer inline result types and optional feedback telemetry.
6. **Media and Telegram inputs** — voice notes, audio uploads, owner photos/screenshots, bounded multi-photo album analysis, thumbnail-based video/video-note/animation previews, stickers, dice, text/code files, locations, venues, contacts, polls, checklists, reply context and forwarded-message context are implemented; add PDF/office documents and richer mixed-media album backends where they improve a workflow.
7. **Groups, topics and Business** — explicit owner-only `/ask` replies are implemented for groups/supergroups with chat/topic-isolated memory, owner-only `/whisper` uses Telegram ephemeral commands for stateless private-in-group replies, owner-only Guest Mode provides stateless one-shot replies without joining the chat, and the first Business/Secretary slice delivers private draft-only suggestions for owner Business messages; extend only selected workflows further while preserving explicit approval boundaries for third-party replies.
8. **Mini App** — provide a Telegram-native dashboard for Memory, Tasks, GitHub, Feeds, Models, Legion and service status. Use Mini App capabilities such as theme integration, QR scanning, device storage or biometrics only where they improve a concrete workflow.

Suggested order: typing/replies/formatting/buttons → callbacks/editing/reactions → inline mode → richer media → Mini App and broader Telegram surfaces.
### Telegram capability backlog

Keep this list as the single roadmap for Telegram-platform features that are interesting but not all worth shipping at once. Prefer features that improve the owner's daily Botek workflow; keep Business/Secretary and account-management surfaces explicitly opt-in.

- **Rich Message blocks (in progress)** — `/status` now uses a compact native table and expandable fallback details. Next extend selected structured replies with details/quotes, document/media blocks, maps, collage/slideshow, draft-only thinking blocks and inline actions for GitHub/Pet Dispatcher reports and research summaries, while retaining Rich Markdown/HTML/plain fallbacks.
- **Media groups / albums (photo slice implemented)** — messages sharing `media_group_id` are coalesced for a short bounded window, and up to six ordered photos/screenshots are analyzed as one owner request. Extend the same maintained gate to mixed photo/video/document batches instead of creating a parallel album path.
- **Richer inline mode** — focused ask/summarize/translate/explain/reply prefixes are implemented on the existing stateless inline path. Next add code/search result variants, richer inline result types and `chosen_inline_result` telemetry without persisting unrelated chat contents.
- **Mini App control center** — a small Telegram-native dashboard for Models, Memory, Tasks, GitHub, Feeds, Legion and health. Start read-mostly; add device storage, QR/biometric features or prepared inline messages only for concrete workflows.
- **Secretary / Business mode (draft-only slice implemented)** — enabled owner Business connections can now turn bounded incoming third-party text/captions into a private stateless reply suggestion without sending anything on the owner's behalf. Next investigate bounded `getUserPersonalChatMessages`, richer Business context and separately permissioned reply actions. Payments, commitments, scheduling, private matters and ambiguous third-party replies stay approval-only.
- **Bot-to-bot delegation** — allow narrowly scoped handoffs to specialist bots such as Kanarek/research helpers when bot-to-bot communication is enabled. Add loop prevention, hop limits, provenance and cost/token guards before any autonomous chaining.
- **Managed Bots** — optional future bot-factory flow for creating/configuring tightly scoped helper bots and managing their access settings. Never expose or persist managed-bot tokens outside the existing secret-management path.
- **Communities and broader chat topology** — understand Telegram Communities, linked channels/groups/bots and direct-message topics only when there is a real multi-chat workflow that benefits from shared routing or context.
- **Profile polish** — local tooling now supports `setMyProfilePhoto` / `removeMyProfilePhoto` and bounded read-only `getUserProfileAudios` inspection. Profile audio cannot currently be set through Bot API; custom emoji and other small bot-profile capabilities remain optional follow-ups without coupling them to assistant logic.
- **Reactions and feedback** — keep state reactions, then add richer reaction-driven feedback only where Telegram permissions allow reliable updates; otherwise prefer callbacks. Do not turn ambient reaction changes into unsolicited assistant replies.
- **Message effects and presentation** — optionally use message effects, silent/protected delivery and other small send-time affordances for deliberate owner-facing UX, never as default noise.
- **Stories / business media** — business story posting, paid media and related monetization surfaces stay off by default; consider only with an explicit owner workflow and separate permission boundary.
- **Local Bot API server** — keep `logOut`/`close` migration support documented as an escape hatch for large-file or local-hosted workflows. Do not move the always-on Cloudflare bot off the hosted Bot API without a concrete operational reason.
- **Large/local files and richer documents** — if PDF/Office/media workflows outgrow hosted Bot API or Worker limits, prefer a bounded Pet Dispatcher/local extraction path rather than silently downloading huge files in the Worker.

Platform constraints to preserve: Guest/ephemeral/Secretary/Business capabilities have different delivery windows and permission models; reactions may require administrator rights in chats; some profile/business surfaces require specific rights; `sendChecklist` is business-account-only; draft-only rich blocks such as thinking must not leak into normal persisted messages.

The two tracks should converge: Telegram is the control surface, while Cloudflare, the shared model router, Engram and Pet Dispatcher remain the maintained backend pieces. Do not grow parallel command-specific backends when an existing service already owns the concern.

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.