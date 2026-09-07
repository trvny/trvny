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

The assistant should not duplicate provider credentials or fallback logic. `kanarek-companion` already exposes a private OpenAI-compatible free router with provider cooldowns and existing provisioning for OpenRouter, OrcaRouter, AIHubMix and Workers AI. The Telegram Worker calls it through a same-account Service Binding and keeps only the shared router bearer.

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

## Personal-assistant roadmap

### 1. MVP

- owner-only private Telegram webhook;
- durable Telegram update queue;
- update-id deduplication + DLQ;
- shared free-model router + local Workers AI fallback;
- `/draft`;
- Feedseek/RSS curation endpoint;
- health/status.

### 2. Memory

- Engram MCP/API when the integration is stable;
- short local conversation history only where needed;
- explicit retention boundaries for private chats.

### 3. Scheduler

- briefings;
- reminders;
- RSS polling only where push from Feedseek is unavailable;
- condition watches that notify only on meaningful changes.

### 4. Reply assistant

Start with human-in-the-loop drafts. Later, Telegram Business/Secretary-style automation may auto-answer only low-risk categories. Money, commitments, dates, private matters and ambiguous requests remain approval-only.

### 5. Hermes handoff

- reuse `pet-dispatcher-control` and `pet-dispatcher-tasks`;
- add Android/Legion worker identities and capability-based routing;
- surface progress/results back to Telegram;
- keep task leases, signing and state in the existing control plane.

### 6. Mini App

Optional dashboard for:

- shared router/provider health;
- RSS decisions;
- schedules;
- queued/running Pet Dispatcher jobs;
- worker presence (Android / Legion);
- memory controls.

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.
