# CLAUDE.md

@AGENTS.md

## Claude Code adapter

`AGENTS.md` is the shared repository contract. This file contains only the
Claude Code-specific delta.

- Use `CLAUDE.md` for project-level Claude instructions and place narrower
  rules close to the files they govern.
- Use skills only for repeatable workflows that benefit from dedicated
  resources, scripts, or references.
- Use subagents only for independent investigation, specialist review, or
  useful parallel work.
- Put every rule a subagent must follow in that subagent's own definition; do
  not assume full inheritance of project instructions.
- Add hooks only for deterministic enforcement or automation. Do not use hooks
  as decorative prompt plumbing.
- Keep shared settings in `.claude/settings.json`.
- Keep machine-local permissions, paths, and personal overrides in
  `.claude/settings.local.json`, and do not commit that file.
- Keep secrets in environment variables or a secret manager, never in Claude
  settings, prompts, hooks, or repository files.
