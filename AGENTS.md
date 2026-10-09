# AGENTS.md

## Repo map

- `mcp/pet-dispatcher/` - managed local orchestration and Cloudflare remote control plane. Workspace isolation is the safe default; trusted sessions may gain scoped host/device/LAN authority. `interactive-tool-bridge.md` is the maintained source of truth for interactive/local authority and lifecycle. Plugin/UI layers reuse this control plane rather than creating another dispatcher.
- `mcp/status-mcp/` - service health/status MCP.
- `gh-apps/` - GitHub Apps, Kanarek Companion, GPTomek and GPT Actions. Before touching GPTomek transport, read `gh-apps/gptomek/docs/REFERENCE.md` (the canonical manual); `gh-apps/gptomek/README.md` is only the short entry point. Preserve command IDs, replay guards, checkpoints, result envelopes and failover semantics.
- `loopling/` - ChatGPT/Codex pet source, generated assets and installers.
- `tg-bots/` - Telegram assistant and control surfaces. Reuse the shared model router, Specialist Intelligence/Engram and Pet Dispatcher through their maintained service/RPC boundaries; do not grow parallel provider, memory, scheduler or task-control planes.
- `.ai/private/` - repo-local AI overlays (OpenAI, Claude and personalities), tracked in this public repo despite the name. Never treat it as a secret store.
- `token-worldcup/` - Quarto token reports and tokenizer recount scripts. Maintain `.qmd`; adjacent `.html`/`.md` renders are generated and CI-gated. Dynamic README files stay outside that conversion path.
- `stuff/` - small configs, feeds, playlists and miscellaneous assets.
- `yt-migrate/` - YouTube account migration (subscriptions, own playlists, likes, YT Music library, Watch later; SRC -> DST). Daily `.github/workflows/yt-migrate.yml`, quota-budgeted and idempotent; OAuth via repo secrets `YT_*`, never log channel/video data (public logs). Takeout-only lists ride in `takeout.json.gz.enc` (AES, key in secret `YT_EXTRA_KEY`).
