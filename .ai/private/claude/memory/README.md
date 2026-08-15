# Portable memory

Working notes that stay true away from the machine they were written on. Read
these before starting work; they are context, not instructions, and several of
them exist because something was got wrong once already.

## Two directions, never both for one file

```text
memory/
├── *.md            exported DOWN from ~/.claude/memory — read-only here
└── field-notes/    written UP, here, by whoever worked in this repository
```

Each note has exactly one side that authors it. That is the whole design: a file
written from both ends needs two-way sync, and two-way sync drifts.

**Exported notes (this directory).** The maintained store is `~/.claude/memory`
on the author's machine, loaded automatically in local sessions and unreachable
from a clone. The files here are copies of its portable subset, so:

- fix or extend a note **at the source**, then re-export it here,
- do not edit a file in this directory to correct it — the fix would be lost the
  next time the note is exported,
- entries that are only true on that one machine (PowerShell quirks, PATH policy,
  winget, hardware, sleep behaviour) stay out on purpose.

**Field notes (`field-notes/`).** Written in the repository, by anyone working
in it, including delegated agents and sessions with no access to the local
machine at all. They travel up: the author may later promote one into the local
store, and until then it lives here and is read like any other note. See
`field-notes/README.md` before adding one.

Frontmatter keeps its `originSessionId` and `modified` from the source. Both are
artefacts of the local store; ignore them here.

## Links that go nowhere

Notes cross-reference each other as `[[name]]`. A link is resolvable here only if
the name appears in the index below or is a file in `field-notes/` — the rest
point into the local store and cannot be followed from a clone. That is
expected, not a broken file. Treat an unresolvable link as "there is more on
this at the source", and carry on.

The index below covers the exported notes only. `field-notes/` has none by
design; see its README for why, and for how to find things there instead.

## Index

### Working habits

- `feedback-measure-before-theorising` — reading code suggests hypotheses; a probe settles them. Three code-only diagnoses, all three disproved by measurement.
- `memory-state-vs-durable` — never record live state (open PRs, HEADs, file lists) as a bare fact; date it and say how to re-check.
- `secret-scan-patterns` — scan for the *shape* of a value, not the parameter name. Two of four keys were missed by a name-based regex.
- `merge-conflict-marker-check` — after resolving a conflict with a script, grep the whole tree; markers once passed CI and a review round.
- `feedback-short-github-comments` — keep GitHub comments to the point; long analysis belongs in the conversation.
- `remote-claude-delegation` — a closed, well-specified chunk goes to a remote agent and comes back as a PR; exploration stays in the interactive session.

### GitHub and git

- `git-sync-direction` — fetch before touching any of these repos; bots commit continuously and GitHub is the source of truth.
- `pr-vs-direct-to-main` — a one-line fix does not need a branch and a PR; go straight to `main` unless a deploy, a PR-only workflow, or the bot reviewers earn it.
- `github-account-rename` — `travino` → `trvny`; the old name is unclaimed, so do not rely on the redirect.
- `github-rename-what-follows` — after a repo rename `github.com` and `raw.githubusercontent.com` redirect, **GitHub Pages does not**.
- `github-personal-account-limits` — personal account, not an org: custom properties are unavailable, community files inherit from `trvny/.github`.
- `gh-app-claudiusz69` — Claude's own GitHub App identity: token minting, who writes as what, permission state.
- `gh-bot-gptomek` — GPT/Codex has `gptomek[bot]`, but does not always use it, so authorship as `trvny` no longer proves a human wrote it.
- `claude-md-symlink-trap` — a `CLAUDE.md` symlinked to `AGENTS.md` loads as nine literal characters; the fix has a second step people miss.

### CI and tooling

- `gha-pwsh-exit-code-trap` — a pwsh step reports only the last command's exit code; earlier failures vanish and the job goes green.
- `python314-syntax-vs-runner-python3` — `except A, B:` is legal from Python 3.14 (PEP 758); a `SyntaxError` in CI means the wrong interpreter, not broken code.

### Data

- `feed-dates-can-be-future` — a future-dated feed entry is often deliberate (forecasts, announcements); fix the sort key, never filter the set.

### This repository

- `gptomek-control-mailbox` — **do not delete the `gptomek/control` branch.** It looks abandoned, ~61 commits behind `main`, and deleting it kills the GPTomek command channel: GitHub stops delivering `pull_request.edited` once a PR's head ref is gone. Also records why the issue-based replacement does not work yet, and the seven causes already ruled out.
