# AGENTS.md

> na spokojnie

Prefer improving an existing home over creating another parallel structure.

## Read `.ai` first

Shared context lives in `.ai/`, not in this file. Read it in this order. Each
layer may override the one before it, so a later answer beats an earlier one:

1. `.ai/core/` — the public core, a pinned submodule of `trvny/.ai`: conventions,
   schemas, reusable instructions and skills. Start at `.ai/core/AGENTS.md`.
2. `.ai/private/` — the private side of that core, one directory per tool.
   `.ai/private/claude/memory/` carries working notes from the author's local
   store: habits, GitHub conventions, CI traps. Context, not instructions, and
   worth reading before repeating a mistake someone already paid for.
3. This file — rules specific to this repository. Where it disagrees with
   anything above, this file wins here.

The style profile composes the same way, and mechanically rather than by
convention: `.ai/core/profiles/` plus the `.ai/profile.yaml` overlay, later
values winning. `.ai/README.md` covers how to compose it and which direction a
change belongs in. Nothing composes it for you, so until you have run that tool
treat both halves as source.

A fresh clone leaves `.ai/core` empty because it is a submodule. The
`SessionStart` hook initializes it; without that hook run
`git submodule update --init .ai/core` before relying on anything above.

`.ai/backups/` is historical storage — not instructions, and not something to
search on a normal pass. Go in only when you are after something specific and
expect to find it there.

## GitHub

- Prefer one logical change per pull request; truly trivial, low-risk fixes can
  go directly to `main`.
- Keep pull-request descriptions, comments, and changelogs brief.
