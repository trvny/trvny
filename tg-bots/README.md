# Telegram bots

Small Telegram experiments and assistants.

## Cloudflare assistant

[`cloudflare-assistant/`](cloudflare-assistant/) is the always-available lightweight bot:

```text
Telegram
   ↓ webhook
Cloudflare Worker
   ├─ chat / drafts
   ├─ RSS curator
   ├─ provider fallback router
   └─ future: memory + schedules + Hermes handoff
```

The intended split is simple:

- **Cloudflare bot:** 24/7, cheap/free, event-driven, everyday assistant work.
- **Hermes:** started on demand on Android/PC for Git, files, builds, tests and heavier agentic jobs.

See [`CONCEPT.md`](CONCEPT.md) for the roadmap and handoff design.
