# AGENTS.md

## Scope

These instructions apply to the whole `trvny/trvny` repository unless a
nearer `AGENTS.md` says otherwise.

This repository is a private working hub for configuration, reusable AI
material, scripts, workflows, documentation, and links to related projects.
Prefer improving an existing home over creating another parallel structure.

Working motto:

> one thing at a time, no rush

## Read this repository correctly

- Treat this file as the repository contract, not as a substitute for the
  current task or runtime policy.
- Explicit user instructions and nearer path-specific instructions take
  precedence.
- Files under `.ai/`, `.claude/skills/`, templates, examples, backups, and
  reference directories are not active instructions unless the current tool or
  task explicitly loads them.
- Do not assume that instructions in this repository automatically apply to
  sibling repositories under `github.com/trvny`. Read each repository's local
  files.
- Verify unstable facts, tool behavior, paths, and repository state instead of
  relying on plausible memory.

## Before changing anything

1. Inspect the relevant files and nearby documentation.
2. Check the current target branch, open pull requests, and recent changes when
   the task could overlap ongoing work.
3. Detect the local stack from project files. Do not assume one stack across
   this mixed repository.
4. Resolve harmless ambiguity from context. Ask only when an assumption could
   cause data loss, an external side effect, a security problem, or a materially
   different result.

## Repository changes

- Keep changes small, reversible, and limited to the requested outcome.
- Preserve unrelated work and the existing style.
- Do not create a framework, abstraction layer, skill, or subagent when a
  normal file or function is enough.
- Keep one maintained source of truth per concern. Provider adapters should
  point to it rather than copy it.
- Do not move or delete files without checking references and discovery paths.
- Keep generated output visibly separate from maintained sources. Do not edit
  generated files by hand unless the task requires it.
- Use the editing mechanism available in the current environment. Do not assume
  a particular tool such as `apply_patch` exists.

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
- Do not create self-pushing or token-driven workflows merely to edit another
  branch or trigger more automation.
- Treat Codex review as advisory. Do not ask it to implement, commit, push, or
  update branches. Apply valid findings directly.
- Merge only when relevant checks are green on the final head commit and
  actionable review threads are resolved. Prefer squash merge.
- Keep pull-request descriptions, comments, and changelogs brief.

## Validation

Start with the narrowest useful check and broaden only when risk warrants it.
Run existing tests, lint, or builds when available and proportionate. For
configuration and documentation changes, verify syntax, paths, discovery names,
and referenced files.

Never claim that a test, build, deployment, commit, upload, or external action
succeeded unless its result was observed. State what was not validated.

## Security and external actions

- Never commit credentials, tokens, cookies, private keys, `.env`, `.dev.vars`,
  or private account data.
- Example files may contain only variable names and inert placeholders.
- Do not deploy, publish, merge, delete remote resources, rotate secrets, or
  change external services unless the task explicitly requests it and the
  operation is authorized.

## Completion report

Report briefly:

- what changed,
- which files changed,
- what was validated,
- any important limitation or remaining decision.
