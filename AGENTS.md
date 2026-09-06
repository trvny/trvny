# AGENTS.md

Prefer improving an existing home over creating a parallel structure. Inspect local conventions first and preserve them unless the task is to change them.

## Repo map

- `mcp/pet-dispatcher/` — workspace-confined local MCP worker plus its Cloudflare remote control plane.
- `mcp/status-mcp/` — service health/status MCP.
- `gh-apps/` — GitHub Apps, Kanarek Companion, GPTomek and GPT Actions.
  Before touching GPTomek control transport, read
  `gh-apps/gptomek/README.md`. Issue `trvny/trvny#203` is the primary mailbox;
  closed PR `#176` plus `gptomek/control` is the retained fallback.
- `loopling/` — ChatGPT/Codex pet source, generated assets and installers.
- `remotely-save-gdrive-patch/` — local Remotely Save Google Drive patch and verification harness.
- `.ai/private/openai/` — private Gremlin policy/profile/operator material.
- `.ai/private/claude/` — private Claude notes and memory.
- `stuff/` — small configs, feeds, playlists and miscellaneous assets.

For Quarto-backed reports, treat `.qmd` as the maintained content source and
committed rendered outputs (`.html`/`.md`) as generated artifacts. Keep the
Quarto version pinned and verify generated outputs in CI. Do not convert
dynamic README files merely to adopt Quarto.

Use the nearest `AGENTS.md` for the files being changed; deeper instructions override broader ones.

## Workflow

- Check the target branch, open PRs and recent changes when work may overlap.
- Detect the local stack from project files; this repository is mixed.
- Keep one maintained source of truth per concern.
- Use GPTomek for bot-authored writes; keep intentionally human-authored PR creation as `trvny`.
- Keep one logical change per PR. Trivial low-risk fixes may go directly to `main` when allowed.
- For substantial code changes, run one relevant final validation on the final head; do not rerun CI after every intermediate edit. Trivial/docs-only changes may skip CI.
- Resolve actionable review threads when a review was actually requested. Prefer squash.
- Keep PR descriptions, comments and changelogs brief.

## Persistence

Resolve ambiguity from repository context and continue. Ask only when progress is genuinely blocked or the next step would be materially unsafe or destructive.
