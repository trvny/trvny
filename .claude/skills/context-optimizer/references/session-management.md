# Session management checklist

Detailed reference for the `context-optimizer` skill. Claude Code commands,
settings, and compaction behavior change over time; confirm version-specific
behavior with the installed `/help` output or current Anthropic documentation.

## Immediate actions

| Situation | Action |
|---|---|
| Same task, useful history, shrinking headroom | Use `/compact` when available |
| Unrelated task | Start a fresh session or use `/clear` |
| Too many irrelevant tools | Disable unrelated MCP servers or tool groups |
| Huge independent investigation | Delegate to a subagent when available |
| Repeated logs or file dumps | Keep only the decisive excerpt and location |
| Bloated startup context | Shorten root instructions and move local facts closer to their paths |

Do not promise a fixed percentage saved by any action.

## Context planning

Reserve enough room for implementation, validation, and review. Instead of
fixed phase percentages, ask:

- Is the remaining task larger than the available headroom?
- Is the model still remembering acceptance criteria and constraints?
- Are new tool calls adding evidence or repeating old material?
- Would a compact summary preserve exact identifiers, measurements, and branch
  state well enough to continue safely?

Compact at a clean task boundary when possible. After compaction, verify the
current branch, changed files, failing command, and unresolved review findings.

## Compaction settings

Do not encode undocumented auto-compaction percentages or environment variables
as repository policy. If tuning is needed:

1. inspect the current Claude Code documentation or `/help` output,
2. verify the setting exists in the installed version,
3. keep machine-specific values in user or local settings,
4. test the behavior in a new session,
5. remove the setting when it no longer has a measurable benefit.

## MCP and tool audit

Enabled tools add definitions and may consume attention even when unused.
Periodically inspect the active set and disable unrelated servers for the
current domain. Do not remove a tool that is required for validation or an
explicit external action merely to make the context smaller.

## Subagent delegation

Good candidates are independent and high-output:

- broad codebase discovery,
- isolated log analysis,
- a separate review pass,
- a test matrix whose raw output need not enter the main session.

Keep tightly coupled edits in one context unless the repository has a clear
handoff boundary. Ask subagents for conclusions, evidence, and file locations,
not a transcript dump.

## Prompt scoping

A useful task brief identifies:

- the target area,
- the desired outcome,
- constraints and files that must not change,
- acceptance criteria,
- the narrow validation expected.

Do not over-constrain a debugging task before the evidence identifies the
faulty layer.

## Instruction-file maintenance

Root instruction files are loaded frequently, so keep them short and stable.
Move path-specific commands and architecture rules to nearer instruction files
or opt-in references. Remove facts that can be discovered cheaply and facts
likely to become stale.

For output and working discipline, use the `token-efficiency` skill. This file
covers the session container only.
