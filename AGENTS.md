# AGENTS.md

## Repo map

- `.devcontainer/` - on-demand Codespaces AI Devbox; its README owns environment setup, browser/uBOL and security boundaries. Actions stay the default for repeatable jobs; do not copy provider keys from the private Kanarek router.
- `mcp/pet-dispatcher/` - managed local orchestration and Cloudflare remote control plane. Workspace isolation is the safe default; trusted sessions may gain scoped host/device/LAN authority. `interactive-tool-bridge.md` is the maintained source of truth for interactive/local authority and lifecycle. Plugin/UI layers reuse this control plane rather than creating another dispatcher.
- `mcp/status-mcp/` - service health/status MCP.
- `gh-apps/` - GitHub Apps, Kanarek Companion, GPTomek, GPT Actions, Gremlin, Claudiusz. Code shared between Workers lives in `gh-apps/core/` (see its README); never import another app's `src/`. Before touching GPTomek transport, read `gh-apps/gptomek/docs/REFERENCE.md` (the canonical manual); `gh-apps/gptomek/README.md` is the practical operator guide. Preserve command IDs, replay guards, checkpoints, result envelopes and failover semantics.
- `loopling/` - ChatGPT/Codex pet source, generated assets and installers.
- `tg-bots/` - Telegram assistant and control surfaces. Reuse the shared model router, Specialist Intelligence/Engram and Pet Dispatcher through their maintained service/RPC boundaries; do not grow parallel provider, memory, scheduler or task-control planes.
- `.ai/private/` - repo-local AI overlays (OpenAI, Claude and personalities), tracked in this public repo despite the name. Never treat it as a secret store.
- `pages/token-worldcup/` - Quarto token reports and tokenizer recount scripts. Maintain `.qmd`; adjacent `.html`/`.md` renders are generated and CI-gated; the Pages build copies them to `/teksty/token-worldcup/`. Dynamic README files stay outside that conversion path.
- `pages/` - TRAVNY hub (travny.pages.dev). Pages project `travny`, root `pages`, output `site/`, Functions in `functions/`; `travny-pages.yml` asserts its Git source. `trfny.com` and `www.trfny.com` 301 via `functions/_middleware.js`; `tvpi.pages.dev` is a redirect-only project in trvny/tvpi. Pages repo is fixed at creation: changing it means recreating the project. TV data stays in the tvpi Worker.
- `stuff/` - small configs, feeds, playlists and miscellaneous assets.
- `yt-migrate/` - account migration home: YouTube at `migrate.py` and Contacts/Tasks/Calendar at `google/` (own `README.md`, `migrate.py`, tests). Separate `.github/workflows/yt-migrate.yml` and `google-migrate.yml`; distinct OAuth secrets `YT_*` / `GM_*` and quota/checkpoint state. Never log personal data (public Actions logs). YouTube Takeout extras are AES-encrypted at `yt-migrate/takeout.json.gz.enc` with `YT_EXTRA_KEY`.

## Code Review Rules

### 

- Avoid repeating what's already covered by CI checks, linting etc.
