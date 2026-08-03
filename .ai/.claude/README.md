# Claude Code adapter for `trvny/trvny`

Claude Code uses the shared repository contract through the root `CLAUDE.md`
import. Provider-specific files stay deliberately small.

## Files

- `/AGENTS.md` is the maintained repository contract.
- `/CLAUDE.md` imports `/AGENTS.md`; it is a text import, not a symlink.
- `.claude/settings.json` defines conservative shared defaults.
- `.claude/agents/trvny-reviewer.md` is an opt-in review-only subagent.
- `.claude/skills/` contains opt-in skills that apply only when invoked.

Personal paths, permissions, and machine-specific settings belong in an
uncommitted `.claude/settings.local.json`.

Keep API keys and tokens in environment variables, platform login, or a secret
manager. Never place real values in these files.
