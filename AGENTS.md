# AGENTS.md

Prefer improving existing homes over parallel structures. Inspect local conventions first; keep them unless tasked to change them.

## Repo map

- `mcp/pet-dispatcher/` — managed local orchestration and Cloudflare remote control plane. Workspace isolation is the safe default; trusted sessions may gain scoped host/device/LAN authority. `interactive-tool-bridge.md` is the maintained source of truth for interactive/local authority and lifecycle. Plugin/UI layers reuse this control plane rather than creating another dispatcher.
- `mcp/status-mcp/` — service health/status MCP.
- `gh-apps/` — GitHub Apps, Kanarek Companion, GPTomek and GPT Actions. Before touching GPTomek transport, read `gh-apps/gptomek/README.md`; it owns the current mailbox/fallback identifiers and transport details. Preserve command IDs, replay guards, checkpoints, result envelopes and failover semantics.
- `loopling/` — ChatGPT/Codex pet source, generated assets and installers.
- `tg-bots/` — Telegram assistant and control surfaces. Reuse the shared model router, Specialist Intelligence/Engram and Pet Dispatcher through their maintained service/RPC boundaries; do not grow parallel provider, memory, scheduler or task-control planes.
- `.ai/private/` — repo-local AI overlays (OpenAI, Claude and personalities), tracked in this public repo despite the name. Never treat as a secret store.
- `token-worldcup/` — Quarto token reports and tokenizer recount scripts. Maintain `.qmd`; adjacent rendered files are generated and CI-gated.
- `stuff/` — small configs, feeds, playlists and miscellaneous assets.

For Quarto reports, maintain `.qmd`; committed renders (`.html`/`.md`) are generated. Pin Quarto version; verify generated outputs in CI. Do not convert dynamic README files just to adopt Quarto.

Use nearest `AGENTS.md` for changed files; deeper instructions override broader ones.

## Workflow

- Check target branch, open PRs and recent changes when work may overlap.
- Detect local stack from project files; this repo is mixed.
- Keep one maintained source of truth per concern.
- Use GPTomek for GitHub writes meant for `gptomek[bot]` attribution; create intentionally human-authored PRs as `trvny`.
- Keep one logical change per PR. Trivial low-risk fixes may go directly to `main` when allowed.
- For substantial code changes, run one relevant final validation on final head; do not rerun CI after every intermediate edit. Trivial/docs-only changes may skip CI unless a matching validation workflow is part of the contract.
- For tool-heavy work, prefer small resumable batches: keep orchestration scripts to a handful of dependent tool calls, persist useful state before slow external checks, and re-read live state between batches.
- Resolve actionable review threads when review was actually requested. Prefer squash unless a project-specific workflow requires another merge method.
- Agent/rule-file changes are checked by the shared Instruction Rot workflow; its path filters and checker implementation are canonical.
- Keep PR descriptions, comments and changelogs brief.

## Persistence

Resolve ambiguity from repo context; continue. Ask only if blocked or the next step is materially unsafe or destructive.
