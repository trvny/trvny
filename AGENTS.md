# AGENTS.md

> na spokojnie

Prefer improving an existing home over creating another parallel structure.

## Read `.ai` first

Shared context lives in `.ai/`. Read it in this order — most useful first:

1. `.ai/private/openai/gremlin-policy.json` — private runtime/operator policy for
   Gremlin/GPTomek. For GitHub work, load it before repository mutations and
   treat its deterministic guards, stop conditions, repo filters, maintenance
   limits, merge/release policy, and preferred high-level Actions as the private
   source of truth. Use `githubReadBatch` when practical so policy and repo
   context arrive in one round trip.
2. `.ai/private/claude/memory/` — working notes from the author's local store:
   habits, GitHub conventions, CI traps. This is the part a clone cannot get any
   other way, and the part most likely to save a wasted round. You can add to it:
   `memory/field-notes/` is written here rather than exported, so a finding that
   cost you real work does not have to cost the next session the same.
3. `.ai/core/instructions/` and `.ai/core/styles/` — how to communicate. From
   the public core, a pinned submodule of `trvny/.ai`.
4. `.ai/profile.yaml` — the private profile overlay on the core's base profile.

**Precedence does not follow the reading order above.** When two layers
disagree, the more specific one wins: this file beats anything
in `.ai/`, and everything private (`.ai/private/`, `.ai/profile.yaml`) beats the
public core. The core holds generic defaults; the private layer exists precisely
to pin choices a future change to those defaults must not silently override.

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

## Code review rules

- Do not comment on README-only, documentation-only, changelog, formatting, or cosmetic changes unless they introduce a factual error or break generated/validated content.
