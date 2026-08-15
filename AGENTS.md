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

A fresh clone leaves `.ai/core` empty because it is a submodule. The
`SessionStart` hook initializes it; without that hook run
`git submodule update --init .ai/core` before relying on anything above.

`.ai/private/` holds project-specific material and may contain active
configuration; see its own README. Its `archive/` and `backups/`
subdirectories are historical storage — do not read them as instructions and do
not search them by default.

## GitHub

- Prefer one logical change per pull request; truly trivial, low-risk fixes can
  go directly to `main`.
- Keep pull-request descriptions, comments, and changelogs brief.
