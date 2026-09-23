# AGENTS.md

Prefer improving existing homes over parallel structures. Inspect local conventions first; keep them unless tasked to change them.

## Repo map

- `mcp/pet-dispatcher/` — managed local orchestration and Cloudflare remote control plane. Workspace isolation is the safe default; trusted sessions may gain scoped host/device/LAN authority. `interactive-tool-bridge.md` is the maintained source of truth for interactive/local authority and lifecycle.
- `mcp/status-mcp/` — service health/status MCP.
- `gh-apps/` — GitHub Apps, Kanarek Companion, GPTomek and GPT Actions.
  Before touching GPTomek control transport, read `gh-apps/gptomek/README.md`.
  Use Issue `trvny/trvny#203` for normal commands. It and closed PR `#176` expose
  the same GPTomek operations. Issue relay auto-fallback to `#176` plus
  `gptomek/control` runs only if primary Worker wake fails. Keep fallback PR/ref
  and command IDs: replay safety, result envelopes and cross-transport deduplication
  depend on the documented transport contract.
- `loopling/` — ChatGPT/Codex pet source, generated assets and installers.
- `.ai/private/` — repo-local AI overlays (OpenAI, Claude and personalities), tracked in this public repo despite the name. Never treat as a secret store.
- `token-worldcup/` — Quarto token reports (language ranking, model x effort
  cost matrix) and tokenizer recount scripts. Maintain `.qmd`; adjacent
  `.html` is generated, gated by `.github/workflows/quarto.yml`.
- `stuff/` — small configs, feeds, playlists and miscellaneous assets.

For Quarto reports, maintain `.qmd`; committed renders (`.html`/`.md`) are generated.
Pin Quarto version; verify generated outputs in CI. Do not convert dynamic README
files just to adopt Quarto.

Use nearest `AGENTS.md` for changed files; deeper instructions override broader ones.

## Workflow

- Check target branch, open PRs and recent changes when work may overlap.
- Detect local stack from project files; this repo is mixed.
- Keep one maintained source of truth per concern.
- Use GPTomek for GitHub writes meant for `gptomek[bot]` attribution; create intentionally human-authored PRs as `trvny`.
- Keep one logical change per PR. Trivial low-risk fixes may go directly to `main` when allowed.
- For substantial code changes, run one relevant final validation on final head; do not rerun CI after every intermediate edit. Trivial/docs-only changes may skip CI.
- Resolve actionable review threads when review was actually requested. Prefer squash.
- Changes to `AGENTS.md` / `CLAUDE.md` run the experimental Instruction Rot checks (`rotcheck`, `yaplint`, RickLang reference guard).
- Keep PR descriptions, comments and changelogs brief.

## Persistence

Resolve ambiguity from repo context; continue. Ask only if blocked or next step is materially unsafe or destructive.
