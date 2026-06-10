---
name: context-optimizer
description: Manage the Claude Code session itself -- diagnose and recover context-window pressure with compaction, MCP/tool pruning, CLAUDE.md sizing, and subagent delegation. Use whenever a Claude Code session is slowing down or degrading, /context shows high usage, a long task is filling the window, or you're configuring a project to stay lean. Claude Code only (these are slash commands and settings.json, not chat/API features). For how Claude should write and act to save tokens, see the token-efficiency skill.
---

# Context Optimizer

> **Claude Code / Cowork only.** Everything here — `/context`, `/compact`, `settings.json`, MCP pruning, subagents — is a Claude Code session mechanism. If you're in claude.ai chat, none of these exist: there are no slash commands or settings files, and you can't inspect or compact the window. The chat equivalent is to start a fresh conversation and carry forward a short summary, or use Projects for persistent context — see the **chat-context** skill instead.

Manage the context window and token budget of a **Claude Code** session. This skill is about the session container; for output-style and working discipline (verbosity, one-pass coding, read-before-write), use the **token-efficiency** skill instead.

Keep this file lean on purpose: a skill that loads to *save* context shouldn't itself be the thing that fills it. The detail lives in `references/session-management.md` -- read it only when you need the specifics.

## Quick Diagnosis

1. Run `/context` to see current usage and what's consuming it.
2. **> 70%**: compact at the next task boundary, before quality degrades.
3. **> ~85%**: you're near the danger zone where responses get generic and forgetful -- compact now. (Claude Code auto-compacts around ~83% by default; don't wait for it.)

## The Two Commands That Matter Most

Know the difference -- confusing them is the most common mistake:

| Command | What it does | Use when |
|---------|--------------|----------|
| `/compact` | Replaces history with a compressed summary; keeps the thread of what happened (file edits stay on disk). | You want to free space but keep working on the same task. |
| `/clear` | Empties the context window entirely -- no memory of the session (file edits still stay on disk). | You're switching to unrelated work and want a clean slate. |

Note: `/resume` (and `/continue`) does **not** reset anything -- it reopens an *earlier* session, loading its history back in. It's for picking up where you left off, not for clearing pressure. To start fresh, use `/clear`. To roll back a session that went off the rails, `/rewind` (or Esc Esc) reverts code and/or conversation to an earlier checkpoint.

## Highest-Leverage Moves

In rough order of impact:

1. **Compact early, not at the limit.** Waiting until you're nearly full means a lossy summary of an already-degraded session. Compact at task boundaries while the context is still clean.
2. **Delegate heavy, high-output work to subagents** (large file exploration, test-suite runs, log analysis). The volume lands in the subagent; your main session stays clean.
3. **Scope prompts tightly.** "In src/auth/, fix the login bug; don't touch the middleware; should return 429 after 5 attempts" reads a handful of files. "Fix the code" forces Claude to read everything.
4. **Prune MCPs and tools** when switching domains -- every enabled MCP adds overhead to every request. Aim to keep the active set small.
5. **Keep CLAUDE.md tight.** It's reloaded every session in the repo, so bloat there is a recurring tax.

## When Context Is Already Degraded

Signs: Claude repeats itself, forgets earlier context, gives generic answers, or tool calls start failing for reasons that worked before.

Fix, in order:
1. `/compact` (optionally steer it: `/compact focus on the auth module and current test failures`).
2. If still bad, `/clear` and re-establish only the context you need.
3. For recurring degradation, shrink CLAUDE.md and prune MCPs so sessions start leaner.

## More Detail

Read `references/session-management.md` for the full tables: per-phase context budget targets, the MCP audit procedure, the auto-compaction config env var (and its known caveats), CLAUDE.md structuring, and subagent delegation patterns.
