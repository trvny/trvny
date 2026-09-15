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

- owner-only Telegram webhook with explicit `/ask` opt-in for group/supergroup replies;
- durable Telegram update queue, update-id deduplication and DLQ;
- shared free-model router with local Workers AI fallback;
- /ask, /draft, /status, /help, /poll, /quiz, /dice, /sticker, /location, /venue, /contact and /reset;
- owner-scoped Telegram commands and command menu self-synced from the Worker;
- bounded recent conversation context with reset generations;
- private-chat topic mode and explicit group `/ask` keep Telegram delivery and short memory isolated per chat/topic;
- native private-chat topic creation through `/topic <name>`;
- native reply-to delivery plus rate-bounded live Rich Message drafts with plain-draft and typing fallback for model-backed replies, including Bot API 10.3 stop-generation handling;
- model-backed replies sent as Telegram Rich Messages with the 32,768-character rich-text budget and deterministic escaped-Rich-HTML/plain fallback when Telegram rejects Markdown formatting;
- best-effort native message reactions for model-backed owner messages (`👀` while processing, `👍` after successful delivery, `👎` on handled failures, `🤨` on ambiguous delivery);
- inline `/status` refresh using callback queries and in-place message editing;
- native button colors distinguish primary, success and destructive inline actions;
- native clipboard action on short `/draft` suggestions;
- manual `/task <repo> <polecenie>` delegation to the Legion through the scoped Pet Dispatcher RPC entrypoint, with inline status/cancel controls;
- owner-only stateless Telegram inline answers for `@trvny_bot <query>` plus an inline-mode shortcut, Durable Object debounce for rapid edits, and an inline-specific response deadline;
- owner-only Telegram Guest Mode for one-shot stateless replies in chats where Botek is not a member, with no private-memory/tool access and no acting on behalf of the owner;
- owner voice notes and bounded audio uploads transcribed through Workers AI Whisper and routed into normal chat;
- owner photos and screenshots analyzed transiently through Workers AI vision, with bounded text-only context persisted;
- video, video-note and animation inputs use bounded metadata plus thumbnail-only vision without downloading the full media;
- owner-shared locations, venues, contacts, polls, stickers and Telegram dice normalized into bounded chat context;
- native owner-created polls through `/poll question | option 1 | option 2`;
- native multi-answer quizzes through `/quiz question | +correct | wrong | +also correct`;
- native Telegram dice/game sends through `/dice [🎲|🎯|🏀|⚽|🎳|🎰]`;
- native sticker resend by replying `/sticker` to an existing Telegram sticker;
- native owner-only location, venue and contact sends through structured commands;
- owner-shared text/code documents read transiently with bounded UTF-8 content and untrusted-data framing;
- same-chat reply context and forwarded messages normalized into bounded untrusted context, with forwarded command text kept outside the owner-command path;
- Feedseek/RSS curation endpoint;
- health/status endpoint.

### Track A: agent brain and integrations

1. **Hermes / Legion handoff** — manual bounded `code` delegation through Pet Dispatcher RPC plus inline status/cancel is implemented. Next add automatic heavy-task routing, richer task profiles, progress/result notifications and broader local-tool workflows without bypassing the dispatcher security boundary.
2. **Long-term memory** — add explicit remember/forget flows and Engram-backed retrieval on top of the current short conversation window, with clear retention boundaries for private chat data.
3. **Multimodal work** — voice notes, bounded audio uploads, owner photos/screenshots and bounded text/code documents are implemented; add PDF/office extraction and richer media backends next.
4. **Tool routing** — let normal language invoke approved GitHub/GPTomek, Cloudflare/status, Feedseek/RSS, web/search and other integrations without requiring a dedicated command for every capability.
5. **Scheduler and proactive assistance** — add briefings, reminders, condition watches, important RSS/CI/service alerts and completed-task notifications while avoiding noisy low-value notifications.
6. **Reply assistant** — keep human-in-the-loop drafts first. Telegram Business/Secretary-style automation may later auto-answer only low-risk categories; money, commitments, dates, private matters and ambiguous requests remain approval-only.
7. **Task UX** — expose delegated work through commands or controls such as `/tasks`, status, cancellation and result retrieval.

Suggested order: Hermes/Legion handoff → long-term memory → multimodal input → tool routing → proactive workflows.

### Track B: Telegram-native experience

1. **Native chat UX** — reply-to delivery, live Rich Message streaming with safe fallbacks, native generation stop, Telegram Rich Message formatting and in-place `/status` refresh are implemented; next add richer editing without chains of status messages.
2. **Inline keyboards and callbacks** — callback plumbing, `/status` refresh and short-draft clipboard actions are implemented; extend buttons to confirmations, task controls, model choices, retries and other frequent actions.
3. **Command/menu synchronization** — owner-scoped commands and the native command menu are synced from code on `/start` or `/help`; add localization when Botek gains additional user-facing languages.
4. **Reactions and lightweight feedback** — model-backed owner messages now use best-effort state reactions for processing, success, handled failure and ambiguous delivery. Native reaction feedback from the owner is not relied on in the private chat because Bot API reaction updates require bot administrator access; use callbacks for explicit feedback where needed.
5. **Inline mode** — owner-only stateless `@trvny_bot ...` answers are implemented for quick ask/summarize/translate flows; next add richer inline result types and optional feedback telemetry.
6. **Media and Telegram inputs** — voice notes, audio uploads, owner photos/screenshots, thumbnail-based video/video-note/animation previews, stickers, dice, text/code files, locations, venues, contacts, polls, reply context and forwarded-message context are implemented; add PDF/office documents and richer media backends where they improve a workflow.
7. **Groups, topics and Business** — explicit owner-only `/ask` replies are implemented for groups/supergroups with chat/topic-isolated memory, and owner-only Guest Mode provides stateless one-shot replies without joining the chat; extend only selected workflows further while preserving explicit approval boundaries for third-party replies.
8. **Mini App** — provide a Telegram-native dashboard for Memory, Tasks, GitHub, Feeds, Models, Legion and service status. Use Mini App capabilities such as theme integration, QR scanning, device storage or biometrics only where they improve a concrete workflow.

Suggested order: typing/replies/formatting/buttons → callbacks/editing/reactions → inline mode → richer media → Mini App and broader Telegram surfaces.

The two tracks should converge: Telegram is the control surface, while Cloudflare, the shared model router, Engram and Pet Dispatcher remain the maintained backend pieces. Do not grow parallel command-specific backends when an existing service already owns the concern.

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.
