# Telegram assistant concept

## Goal

Keep an always-on personal assistant on Cloudflare while leaving heavyweight machine work to Hermes. The Cloudflare side should remain useful even when every phone/laptop is asleep.

```text
                           ┌─ OrcaRouter Free
Telegram ─► Cloudflare ────┼─ Ollama Cloud Free
            assistant      ├─ OpenRouter Free
               │           └─ Workers AI free allocation
               │
               ├─ RSS / notifications / drafts / reminders
               ├─ future Engram memory
               └─ future durable handoff queue
                            │
                    Hermes worker online?
                       ┌────┴────┐
                    Android    Legion
                    Termux      desktop
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

### Hermes workers

Good fit:

- clone/fetch repositories;
- edit files;
- run tests and builds;
- use `git`, `gh`, SSH and local tooling;
- inspect hardware/local files;
- perform longer autonomous engineering tasks.

A Hermes installation on Android and another on Legion can use the same logical task queue. They should have separate worker identities/capability metadata so the dispatcher can choose the appropriate machine.

## Hermes bot portability

The same Telegram bot identity/token can be moved from Android to a Hermes installation on Legion. With the current polling setup, run only one Hermes Telegram gateway for that bot at a time; two concurrent `getUpdates` pollers will fight over the same bot. Stop the Termux gateway before starting the Legion gateway, or later put a single dispatcher in front of both workers.

Keep the Cloudflare assistant on a separate BotFather bot so its webhook never conflicts with the Hermes poller.

## Handoff design

Future slice:

1. Cloudflare receives a heavy request, for example `sprawdź trvny/feedseek i odpal testy`.
2. It writes a durable job with status `queued`.
3. An online Hermes worker claims the job using a scoped worker token.
4. Hermes posts progress/result back to Cloudflare.
5. Cloudflare forwards a concise result to Telegram.
6. Jobs are idempotent and lease-based so Android and Legion cannot execute the same job accidentally.

Prefer Cloudflare Queues/D1/Workflows only when this slice is implemented. Do not add infrastructure before it has a consumer.

## Personal-assistant roadmap

### 1. MVP

- owner-only Telegram webhook;
- provider fallback chain;
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

- durable queue;
- Android and Legion workers;
- capability-based routing;
- result/progress messages;
- timeouts and retry/lease rules.

### 6. Mini App

Optional dashboard for:

- provider health and active fallback;
- RSS decisions;
- schedules;
- queued/running Hermes jobs;
- worker presence (Android / Legion);
- memory controls.

## Bot identities

Keep the Cloudflare assistant as its own ordinary BotFather bot. The Nous-managed Hermes bot can stay dedicated to Hermes.

This avoids webhook/polling ownership conflicts and keeps the always-on assistant independent from the lifecycle of any Hermes installation.
