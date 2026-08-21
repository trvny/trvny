# AGENTS.md

This directory is the shared Cloudflare Worker runtime for Kanarek Companion, GPTomek and GPT Actions.

- Keep webhook companion behavior and operator/GPT Actions concerns separated even though they share a runtime.
- Never log or persist private keys, OAuth bearer tokens or other credentials.
- Keep mutation paths guarded against stale state, replay and duplicate side effects.
- Prefer existing high-level guarded actions over new raw mutation endpoints.
- Run `npm run check` before considering code changes complete.
