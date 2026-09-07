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
   ├─ existing Kanarek free-model router
   └─ future: memory + schedules + Pet Dispatcher handoff
```

The intended split is simple:

- **Cloudflare bot:** 24/7, cheap/free, event-driven, everyday assistant work;
- **Kanarek Companion:** shared free-model routing and provider credentials;
- **Pet Dispatcher + Hermes:** on-demand OS/repository work, builds and tests.

See [`CONCEPT.md`](CONCEPT.md) for the roadmap and reuse boundaries.
