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
- `pages/` - TRAVNY hub (travny.pages.dev). Pages project `travny`, root `pages`, output `site/`, Functions in `functions/`; `travny-pages-control.yml` asserts its Git source. `trfny.com` and `www.trfny.com` 301 via `functions/_middleware.js`; `tvpi.pages.dev` is a redirect-only project in trvny/tvpi. Pages repo is fixed at creation: changing it means recreating the project. TV data stays in the tvpi Worker.
- `stuff/` - small configs, feeds, playlists and miscellaneous assets.
- `yt-migrate/` - YouTube account migration (subscriptions, own playlists, likes, YT Music library, Watch later; SRC -> DST). Daily `.github/workflows/yt-migrate.yml`, quota-budgeted and idempotent; OAuth via repo secrets `YT_*`, never log channel/video data (public logs). Takeout-only lists ride in `takeout.json.gz.enc` (AES, key in secret `YT_EXTRA_KEY`).

## ChatGPT GitHub attribution

- Use the GPTomek Issue #203 transport for ChatGPT-made commits. Keep pull
  requests authored by `trvny` so external review automation runs.
- If the GitHub user connection creates a commit as `trvny` instead, append
  `Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>`
  to the **commit message** (not just the PR description). Preserve other trailers.
- ChatGPT-created PRs opened outside the Codex Connector must include
  `<!-- chatgpt-assisted-pr -->` in the description to opt into the attribution
  guard. Explain AI participation visibly; do not mark unrelated human work.
- The reusable `.github/workflows/chatgpt-attribution.yml` checks such PRs.
  Missing trailers require a corrected commit or GPTomek `adopt_branch`;
  never auto-force-push someone else's branch.
