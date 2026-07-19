# Codex + Claude Code adapters for `trvny/trvny`

Small provider-specific adapters for the shared `AGENTS.md` contract.

## Files

- `CLAUDE.md` imports and extends `AGENTS.md` for Claude Code.
- `.claude/settings.json` defines conservative shared permissions.
- `.claude/agents/trvny-reviewer.md` is a read-only review subagent.
- `.codex/trvny.instructions.md` contains Codex-specific behavior.
- `.codex/personal.config.toml` is a conservative Codex profile.

## Placement

Copy these files to the repository root while preserving paths.

Keep local permissions and private paths in uncommitted files such as:

```text
.claude/settings.local.json
```

Keep API keys and tokens in environment variables, platform login, or a secret
manager. Never place real values in these files.

## Notes

The adapters intentionally do not duplicate the complete `AGENTS.md`. Shared
rules should have one source of truth; provider files only translate the parts
that differ between runtimes.
