# AGENTS.md

> na spokojnie

Prefer improving an existing home over creating another parallel structure.

## Read `.ai` first

Shared context lives in `.ai/`. Read it in this order; where two layers
disagree, the later one wins:

1. `.ai/private/claude/memory/` — working notes from the author's local store:
   habits, GitHub conventions, CI traps. This is the part a clone cannot get any
   other way, and the part most likely to save a wasted round.
2. `.ai/core/instructions/` and `.ai/core/styles/` — how to communicate. From
   the public core, a pinned submodule of `trvny/.ai`.
3. This file — rules specific to this repository.

Skip the rest of `.ai/core` unless you are changing the core itself. Its
`AGENTS.md` governs maintenance of *that* repository, not work in this one, and
it says outright that its `.claude/` and `.codex/` defaults are not active in
repositories consuming it as a submodule. `.ai/README.md` covers composing the
style profile and which direction a change belongs in.

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
