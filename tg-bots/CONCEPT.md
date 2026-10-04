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

### Next

- richer in-progress Pet Dispatcher updates and broader approved local-tool workflows;
- PDF/Office extraction and better document/audio handling where useful;
- quieter recurring briefings, quiet hours and broader service watches;
- richer structured task/GitHub/research replies and inline result types;
- selected Business actions only with separate permissions and approval boundaries;
- multi-worker Pet Dispatcher routing when Android/other workers are real.

Keep Telegram as the control surface while Cloudflare, Kanarek routing, Engram and Pet Dispatcher remain the canonical backend pieces. Do not add parallel command-specific services.

The framework-pattern audit lives in [FRAMEWORK-AUDIT.md](FRAMEWORK-AUDIT.md).

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.