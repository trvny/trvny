# AGENTS.md

This repository is a private working hub for configuration, reusable AI
material, scripts, workflows, documentation, and links to related projects.
Prefer improving an existing home over creating another parallel structure.

Working motto:

> one thing at a time, no rush

## Repository conventions

- `.ai/core/` is the public `trvny/.ai` submodule and the maintained source for
  reusable AI profiles, schemas, tools, templates, styles, instructions, and
  public skills. Apply `.ai/profile.yaml` as the private profile overlay after
  the public base. Keep backups and private/project material under
  `.ai/private/`; do not duplicate public core files here.
- Files under `.ai/private/`, templates, examples, backups, and reference
  directories are not active instructions unless the current tool or task
  explicitly loads them.
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
- `.ai/core/.claude/settings.json` and `.ai/core/.codex/config.toml` are reusable
  reference defaults from the public core. Because the core is a nested
  submodule, providers do not discover them automatically as repository-root
  configuration.
- Public opt-in skills live in `.ai/core/skills/`; private or project-specific
  skill backups live in `.ai/private/skills/`. Neither set is repository-wide
  policy unless explicitly loaded.
- Provider-neutral reusable material lives in `.ai/core/`; private profile
  behavior lives in `.ai/profile.yaml`. Neither is hidden authority unless a
  current tool or task explicitly loads it.

## GitHub workflow

- GitHub bot identity: use the GPTomek GitHub App (`gptomek[bot]`) for commits,
  comments, review replies, and reactions when available. Pull requests should
  still be opened as `trvny`, because external automatic reviews are triggered
  for PRs opened by that account. GPTomek lives under `gh-apps/` and reuses the
  existing `kanarek-companion` Worker; current control transport is
  `trvny/trvny#176`. Do not create per-command GitHub Actions workflows or
  another Worker.
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
