# AGENTS.md

This repository is a private working hub for configuration, reusable AI
material, scripts, workflows, documentation, and links to related projects.
Prefer improving an existing home over creating another parallel structure.

Working motto:

> one thing at a time, no rush

## Repository conventions

- Files under `.ai/`, `.claude/skills/`, templates, examples, backups, and
  reference directories are not active instructions unless the current tool or
  task explicitly loads them.
- Check the current target branch, open pull requests, and recent changes when
  the task could overlap ongoing work.
- Detect the local stack from project files; do not assume one stack across this
  mixed repository.
- Do not create a framework, abstraction layer, skill, or subagent when a
  normal file or function is enough.
- Keep one maintained source of truth per concern. Provider adapters should
  point to it rather than copy it.
- Keep generated output visibly separate from maintained sources. Do not edit
  generated files by hand unless the task requires it.

## Provider entry points

- `AGENTS.md` is the shared repository contract.
- `CLAUDE.md` and `GEMINI.md` are thin imports of this file.
- `.github/copilot-instructions.md` contains only Copilot-specific adaptation;
  path-specific Copilot rules belong in `.github/instructions/`.
- `.github/agents/` and `.claude/agents/` contain focused opt-in agents, not
  repository-wide policy.
- `.claude/settings.json` contains conservative shared permissions. Personal
  paths and permissions belong in uncommitted local settings.
- `.codex/config.toml` contains project defaults only. Do not pin a model,
  replace the normal `AGENTS.md` instruction chain, or store personal UI
  preferences there.
- Provider-neutral profiles, schemas, templates, and references belong under
  `.ai/`; they are documentation or inputs, not hidden authority.

## GitHub workflow

- Keep one logical change per pull request. Truly trivial, low-risk fixes may go
  directly to `main` when branch protection permits it.
- Avoid token-driven GitHub Actions whose main purpose is editing another branch
  or repository or triggering more automation, especially when they would waste
  private Actions minutes. Purpose-built external services, Workers, and GitHub
  Apps may use scoped tokens when that is the appropriate runtime.
- Treat Codex review as advisory. Do not ask it to implement, commit, push, or
  update branches. Apply valid findings directly.
- Merge only when relevant checks are green on the final head commit and
  actionable review threads are resolved. Prefer squash merge.
- Keep pull-request descriptions, comments, and changelogs brief.

## Validation

For configuration and documentation changes, verify syntax, paths, discovery
names, and referenced files. Use existing tests, lint, or builds when the
change can affect executable behavior.
