# AGENTS.md

> na spokojnie

Prefer improving an existing home over creating another parallel structure.

## Read `.ai` first

Shared context for this repository lives in `.ai/`, not in this file:

- `.ai/core/` — the public core, a pinned submodule of `trvny/.ai`: conventions,
  profiles, schemas, reusable instructions and skills. Start at
  `.ai/core/AGENTS.md`.
- `.ai/profile.yaml` — the private overlay on top of that core. Later layers win.
- `.ai/README.md` — how to compose the effective profile, and which direction a
  change belongs in.
- `.ai/private/` — the private side of the core, one directory per tool.
  `.ai/private/claude/memory/` carries working notes from the author's local
  store: habits, GitHub conventions, CI traps. Context, not instructions, and
  worth reading before repeating a mistake someone already paid for.

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
