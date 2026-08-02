---
name: context-optimizer
description: Diagnose and reduce context pressure in a Claude Code session using the commands and capabilities available in the installed version. Use when a long session becomes repetitive, forgetful, slow, or overloaded with tools and instructions. Avoid fixed percentage thresholds and undocumented environment variables.
---

# Context optimizer

This skill is for Claude Code session mechanics. Commands and compaction behavior
can change between versions, so inspect the current `/help`, `/context`, or
settings documentation before relying on an exact threshold or environment
variable.

## Diagnose

Use `/context` when the installed version provides it. Look for:

- a large conversation history,
- oversized repository instructions,
- many enabled MCP servers or tool definitions,
- repeated logs or file contents,
- signs that the model is forgetting constraints or repeating work.

Do not wait for a memorized percentage. The useful trigger is declining answer
quality or insufficient room for the remaining task.

## Recover

- Use `/compact` to summarize the current session while preserving the work's
  thread when that command is available.
- Use `/clear` for a genuinely unrelated task or when the current session is no
  longer trustworthy. File changes remain a separate concern; verify them after
  clearing.
- Use resume or continue commands to reopen previous work, not as a way to free
  context.
- If subagents are available, delegate independent high-output investigation
  and request a compact result. Do not delegate a tightly coupled edit merely
  to save tokens.
- Disable unrelated MCP servers or tools for the current task, but keep the
  capabilities needed to finish and verify it.

## Prevent recurring pressure

- Keep root `CLAUDE.md` and imported repository instructions short and stable.
  Move path-specific facts closer to the files they govern.
- Keep optional skills and long references opt-in rather than importing them
  into every session.
- Scope the task and acceptance criteria clearly enough that the agent does not
  need to inspect the whole repository.
- Avoid pasting full logs repeatedly. Preserve the decisive error, command, and
  surrounding context.
- Start a fresh session between unrelated projects rather than carrying a long
  transcript as accidental state.

## Verify after recovery

After compaction or clearing, restate or re-read the few constraints that matter:
current task, target branch, changed files, validation state, and unresolved
review findings. Do not assume a summary preserved every exact identifier or
measurement.

Read `references/session-management.md` for a compact checklist. Treat any
version-specific command or setting there as something to verify against the
installed Claude Code version.
