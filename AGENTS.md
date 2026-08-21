# AGENTS.md

Prefer improving an existing home over creating a parallel structure. Inspect local conventions first and preserve them unless the task is to change them.

## Repo map

- `codebench/` — QR/barcode/scanner tools.
- `streambench/` — IPTV/radio/HLS/M3U/XMLTV tools.
- `weather-feed/` — weather and IMGW feeds.
- `mcp/status-mcp/` — service health/status MCP.
- `gh-apps/` — GitHub Apps, Kanarek Companion, GPTomek and GPT Actions.
- `.ai/private/openai/` — private Gremlin policy/profile/operator material.
- `.ai/private/claude/` — private Claude notes and memory.
- `stuff/` — small configs, feeds, playlists and miscellaneous assets.

Use the nearest `AGENTS.md` for the files being changed; deeper instructions override broader ones.

## Workflow

- Check the target branch, open PRs and recent changes when work may overlap.
- Detect the local stack from project files; this repository is mixed.
- Keep one maintained source of truth per concern.
- Use GPTomek for bot-authored writes when available; keep PR creation as `trvny` when required by review automation.
- Keep one logical change per PR. Trivial low-risk fixes may go directly to `main` when allowed.
- Merge only with relevant final-head checks green and actionable review threads resolved. Prefer squash.
- Keep PR descriptions, comments and changelogs brief.

## Persistence

Resolve ambiguity from repository context and continue. Ask only when progress is genuinely blocked or the next step would be materially unsafe or destructive.
