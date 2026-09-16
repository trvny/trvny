# Delegating to a subagent

A task-prompt checklist. Keep prompts short; this is standing context, only the
task differs.

The first real run (2026-08-15) produced five findings and three lessons: the
numbered rules below.

## What this has to survive

Today delegated agents run from the author's machine, where missing context can
be handed over. Design for a cold `claude.ai/code` session from a phone, laptop off:
*"CI has failed ten times in a row, help"*.

That session gets only the repository. Commit everything it needs here.
`field-notes/` lets it leave findings when it cannot write to the local store.

## What the agent already has

It gets a full checkout in its own git worktree at `.claude/worktrees/agent-<id>/`
and `AGENTS.md`, which points to `.ai/private/claude/memory/` and the core.
`SessionStart` syncs `.ai/core` there. Linked worktrees get their own submodule
gitdir, leaving the main checkout undisturbed (measured on git 2.55).

Do **not** repeat guidance locations, repository context, `trvny` conventions,
or exported memory in the prompt. Naming those files also prevents testing
whether the pointers work alone.

## 1. Scope by paths, not by commit range

The first run used `3ae924f..HEAD`: "six commits of documentation and a hook".
It also held 18 copied memory notes and 53 renames, causing roughly a thousand
unwanted lines of review. Agents cannot ask; they take ranges literally.

Give an explicit file list. Use a commit range only when it *is* the subject
and you have checked its contents.

## 2. Demand measurement, and let it say "nothing wrong"

The only disproved finding came from config reasoning without execution.
Correctly flagged as untested, it still cost a round to disprove. Require each
claim to say: measured, or reasoned with why it was not measured.

Explicitly prefer short, correct reviews over padded ones. Say "I found nothing
in this category" is acceptable and useful, lest agents invent findings to fill
the request.

## 3. State the write boundary in the prompt

For reviews: "Do not fix anything. Do not commit, push, or open a pull request."
Otherwise agents start editing, hidden in the worktree until merged back.
For code changes, state allowed paths and whether to commit.

## Ask for an environment report when the plumbing is what you are testing

Three questions, phrased without naming `.ai`:

1. Which files did you consult for guidance, and how did you find them? In the
   order you read them.
2. Did any guidance point at something missing, empty, or unreadable? Name it
   and say what you saw.
3. Did a session-start hook run? Say how you know, or say you cannot tell.

This caught the hook that never ran on Windows. Ask only when testing the
mechanism; omit it on ordinary tasks.

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
