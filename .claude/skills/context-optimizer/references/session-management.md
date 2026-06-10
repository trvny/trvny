# Session Management Details

Detailed reference for the context-optimizer skill. Read when you need specifics beyond the SKILL.md summary.

## Immediate Actions

| Action | Roughly saves | When |
|--------|---------------|------|
| `/compact` | A large chunk of context (varies with how much was summarizable) | At task boundaries |
| Disable unused MCPs | Per-MCP overhead on every request | When switching domains |
| Delegate to subagents | Keeps the volume out of the main context entirely | Heavy search/read/test tasks |
| `/clear` | Full reset of the window | Starting unrelated work |

Savings are situational; don't promise a fixed percentage. The win from `/compact` depends on how much of the history compresses cleanly.

## Context Budget Planning

Rough per-phase targets for a long task:

| Phase | Target Usage | If Over |
|-------|-------------|---------|
| Planning | < 20% | Keep plans concise |
| Implementation | < 60% | Compact between files |
| Testing | < 80% | Delegate test runs to a subagent |
| Review | < 90% | `/clear` and re-establish only what's needed |

## Auto-Compaction Configuration

Claude Code auto-compacts around ~83% of the window by default. You can lower that trigger with the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` environment variable (value is a percentage, 1-100).

```bash
# Compact earlier, at 50% -- more headroom, more frequent compaction
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50
```

Important caveats (verified against the Claude Code issue tracker as of early 2026):

- **It can only lower the threshold, not raise it.** Values above the ~83% default are silently clamped, so setting it to 95 does nothing. Useful range is below ~83.
- **Setting it via the `env` block of `settings.json` has been reported as unreliable** -- in several versions it's visible to subprocesses but ignored by the compaction logic itself. The more reliable path is exporting it in your shell (`.bashrc`/`.zshrc`) before launching Claude Code.
- **Env-var changes only apply to new sessions.** Restart Claude Code after changing it.
- Very low values (e.g. 10) compact too often and waste tokens re-summarizing. A value in the 50-75 range is a reasonable starting point; verify the behavior in your own setup, since this area has open bugs.

If you do use settings.json despite the above, it goes in `~/.claude/settings.json`:
```json
{ "env": { "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50" } }
```

## MCP Audit

Every enabled MCP server adds tool definitions to every request, so an overloaded toolset taxes the whole session. Keep the active set lean.

```bash
/mcp   # list active servers, then disable what this task doesn't need
```

Rule of thumb: only enable MCPs relevant to the current domain. When you switch domains, prune.

## Subagent Delegation

Push high-output operations into subagents so the bulk never enters the main context:

- Test-suite output
- Large file or codebase exploration
- Documentation generation
- Log analysis

The subagent absorbs the volume and returns only its conclusion; the main session stays clean.

## Prompt Scoping

Tightly scoped prompts read fewer files and produce less rework:

- **Scope it**: "In src/auth/, fix the login bug"
- **Constrain it**: "Don't modify the middleware"
- **Give acceptance criteria**: "Should return 429 after 5 attempts"
- **Avoid the vague**: "Fix the code" forces Claude to read broadly to find the target

## CLAUDE.md Optimization

CLAUDE.md is reloaded at the start of every session in the repo, so size there is a recurring cost:

- Root CLAUDE.md: aim for < 60 lines, < 150 max
- Move package-specific guidance to a package-level CLAUDE.md
- Move personal preferences to CLAUDE.local.md
- Remove obvious or rapidly-changing information that goes stale

## See Also

For output-style and working-discipline rules (verbosity, one-pass coding, tool-call budgets, read-before-write, ASCII-only output), use the **token-efficiency** skill. That skill owns *how Claude responds*; this one owns *the session container*.
