# AGENTS.md

Prefer improving an existing home over creating another parallel structure.

Working motto:

> na spokojnie

## Repository conventions

- `.ai/core/` is the public `trvny/.ai` submodule and the maintained source for
  reusable AI profiles, schemas, tools, templates, styles, instructions, and
  public skills. Apply `.ai/profile.yaml` as the private profile overlay after
  the public base.
- Keep public reusable material in `.ai/core/`; keep private or project-specific
  material and backups under `.ai/private/` rather than duplicating the public
  core.
- Files under `.ai/private/`, templates, examples, backups, and reference
  directories are inputs or reference material unless the current task or tool
  explicitly loads them.
- When work could overlap ongoing changes, check the target branch, open pull
  requests, and recent commits first.
- Detect the local stack from project files; this repository intentionally mixes
  several kinds of projects.
- Prefer a normal file or function over a new framework, abstraction layer,
  skill, or subagent unless the extra structure earns its complexity.
- Keep one maintained source of truth per concern; provider adapters should
  point to it rather than copy it.
- Treat generated output as generated: make fixes in the maintained source and
  regenerate when practical.

## Provider entry points

- `CLAUDE.md` and `GEMINI.md` are thin imports of this file.
- `.github/copilot-instructions.md` contains Copilot-specific adaptation;
  path-specific Copilot rules live in `.github/instructions/`.
- `.ai/core/.claude/settings.json` and `.ai/core/.codex/config.toml` are reusable
  reference defaults from the public core. Because the core is a nested
  submodule, providers do not discover them automatically as repository-root
  configuration.
- Public opt-in skills live in `.ai/core/skills/`; private or project-specific
  skill backups live in `.ai/private/skills/`. They become active only when the
  current tool or task loads them.
- Provider-neutral reusable material lives in `.ai/core/`; private profile
  behavior lives in `.ai/profile.yaml`.

## GitHub workflow

- When available, use the GPTomek GitHub App (`gptomek[bot]`) for commits,
  comments, review replies, and reactions. Open pull requests as `trvny`, which
  is the identity that triggers external automatic reviews. GPTomek lives under
  `gh-apps/` and reuses the existing `kanarek-companion` Worker; current control
  transport is `trvny/trvny#176`, so prefer that path over per-command Actions
  workflows or another Worker.
- Prefer one logical change per pull request. Truly trivial, low-risk fixes can
  go directly to `main` when branch protection allows it.
- Avoid token-driven GitHub Actions whose main purpose is editing another branch
  or repository or triggering more automation, especially when they would waste
  private Actions minutes. Purpose-built external services, Workers, and GitHub
  Apps may use scoped tokens when that is the appropriate runtime.
- Let automatic Codex review handle review when available; treat its findings as
  advisory and apply the useful ones directly.
- Merge after relevant checks are green on the final head commit and actionable
  review threads are resolved. Prefer squash merge.
- Keep pull-request descriptions, comments, and changelogs brief.

## Validation

For configuration and documentation changes, verify syntax, paths, discovery
names, and referenced files. Use existing tests, lint, or builds when the
change can affect executable behavior.
