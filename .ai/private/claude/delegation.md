# Delegating to a subagent

A checklist for whoever writes the task prompt, so the prompt itself can stay
short. Everything here is standing context; only the task differs.

Written after the first real run (2026-08-15), which produced five findings and
three lessons. The lessons are the numbered rules below.

## What the agent already has

It gets its own git worktree under `.claude/worktrees/agent-<id>/`, a full
checkout of this repository, and `AGENTS.md` — which points it at
`.ai/private/claude/memory/` and the core. The `SessionStart` hook syncs
`.ai/core` there; a linked worktree gets its own submodule gitdir, so this does
not disturb the main checkout (measured on git 2.55, not assumed).

So do **not** spend prompt on: where the guidance lives, what the repository is,
the `trvny` conventions, or anything already in the memory export. Naming those
files in the prompt also destroys any chance of testing whether the pointers
work on their own.

## 1. Scope by paths, not by commit range

The first run was scoped `3ae924f..HEAD` and described as "six commits of
documentation and a hook". The range also contained 18 copied memory notes and
53 renames, so the agent reviewed roughly a thousand lines nobody wanted
reviewed. It cannot ask, so it takes the range literally.

Give an explicit file list. Use a commit range only when the range *is* the
subject and you have checked what is actually in it.

## 2. Demand measurement, and let it say "nothing wrong"

The one finding that did not survive was the one reasoned from a config file
rather than executed. The agent flagged it honestly as untested — good — but it
still cost a round to disprove. Ask for a verdict per claim: measured, or
reasoned and why it was not measured.

Say plainly that a short correct review beats a padded one, and that "I found
nothing in this category" is an acceptable and useful answer. Without that,
findings get invented to fill the shape of the request.

## 3. State the write boundary in the prompt

"Do not fix anything. Do not commit, push, or open a pull request." A
review-only agent will otherwise start editing, and a worktree makes that
invisible until it is merged back. When the task *is* to change code, say which
paths it may touch and whether it should commit.

## Ask for an environment report when the plumbing is what you are testing

Three questions, phrased without naming `.ai`:

1. Which files did you consult for guidance, and how did you find them? In the
   order you read them.
2. Did any guidance point at something missing, empty, or unreadable? Name it
   and say what you saw.
3. Did a session-start hook run? Say how you know, or say you cannot tell.

This is what caught the hook that never ran on Windows. Ask for it only when
testing the mechanism — it is wasted tokens on an ordinary task.

## Known-good prompt shape

```text
You are working in the repository trvny/trvny.

TASK — <one line>.

<Explicit file list, or a diff scoped to named paths.>

Report concrete, verifiable problems only. For each finding: file, line, what is
wrong, and how it would actually bite someone. Mark each finding as measured or
reasoned; if reasoned, say why you did not run it.

If a category is clean, say so plainly rather than inventing a finding. A short
correct review beats a padded one.

Do not fix anything. Do not commit, push, or open a pull request.
```
