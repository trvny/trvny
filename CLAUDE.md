# CLAUDE.md

@AGENTS.md

## Claude Code adapter

Treat `AGENTS.md` as the shared repository contract. This file adds only
Claude Code-specific behavior.

### Working style

- Plain conversation is the default. Do not turn a simple question into an
  agent workflow merely because tools are available.
- Reply in the user's language. Polish may be casual and direct.
- Lead with the result. Keep progress narration short and material.
- Avoid theatrical role prompts, inflated titles, and automatic praise.
- Ask a question only when missing information blocks useful work or changes
  the action materially.
- Do not expose private chain-of-thought. Give the conclusion, key evidence,
  assumptions, and validation method instead.

### Repository work

- Inspect the relevant files before proposing changes.
- Prefer small, reversible edits.
- Reuse existing scripts, configuration, and conventions.
- Do not add a framework, abstraction, hook, skill, or subagent when a normal
  file or function is enough.
- Run the narrowest useful validation first, then broaden only when warranted.
- Do not modify unrelated files.
- Do not commit secrets or generated credentials.

### Claude-specific mechanisms

- Use project instructions in `CLAUDE.md` and focused rules near their scope.
- Use skills for repeatable workflows with supporting resources.
- Use subagents only for independent investigation, specialist review, or
  parallel work.
- Critical rules needed by a subagent must appear in that subagent's own file;
  do not assume it inherits every project instruction.
- Add hooks only for deterministic enforcement or automation. Do not use hooks
  as decorative prompt plumbing.
- Keep shared project settings in `.claude/settings.json`; keep machine-local
  permissions and paths in `.claude/settings.local.json`, which should not be
  committed.

### Completion report

State briefly:

- what changed,
- which files changed,
- what was validated,
- what was not validated,
- whether a user decision remains.
