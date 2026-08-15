---
name: claude-md-symlink-trap
description: "A repo whose CLAUDE.md is a git symlink to AGENTS.md loads as nine literal characters on this machine; fixing it needs a two-step, and the second step is the one people miss."
metadata: 
  node_type: memory
  type: reference
  modified: 2026-08-03T10:06:36.690Z
  originSessionId: 67c78982-400c-4a1c-b90e-4bc98007d6d3
---

Every clone here resolves **`core.symlinks=false`**. Re-checked 2026-08-03: it comes from the
system config (`scoop/apps/git/<ver>/etc/gitconfig`) **and** from each repo's own `.git/config`,
written at clone time — both of which outrank the global file. The global config now says
`core.symlinks=true` ([[gitconfig-xdg-location]]), and it is **inert**; do not read it as evidence
that this trap is gone. Verify per repo with `git -C <repo> config --show-origin --get-all
core.symlinks`, where the last line printed wins.

A repo that stores `CLAUDE.md` as a git symlink
(mode `120000`) pointing at `AGENTS.md` materializes here as a **9-byte plain text file containing
the literal string `AGENTS.md`**. Claude Code loads those nine characters as the entire project
instruction set — the real `AGENTS.md` is never read, and nothing warns you. Found 2026-08-02 in
`trvny` (199 lines lost), `wambridge` (62), `ext-apps` (103).

Related: a repo with `AGENTS.md` but **no** `CLAUDE.md` at all loads nothing either — Claude Code
reads `CLAUDE.md`, not `AGENTS.md`. That was `feeds` (45 lines lost).

**Fix, both steps required:**

```bash
printf '@AGENTS.md\n' > CLAUDE.md      # 1. content: an import, not a bare filename
git rm --cached CLAUDE.md              # 2. index: still says 120000 without this
git add CLAUDE.md                      #    → now 100644, status shows T (typechange)
```

**Step 2 is the trap.** After step 1 alone, `git status` shows a clean-looking ` M` and everything
works locally — but the index still holds the entry as a symlink, so committing writes a dangling
link to a nonexistent `@AGENTS.md`, broken on *every* platform including this one after a fresh
clone. Verify with `git ls-files -s CLAUDE.md`; you want `100644`, and `git diff --cached --summary`
should say `mode change 120000 => 100644`.

The `@AGENTS.md` import is what the Claude Code docs recommend for Windows precisely because
creating symlinks there needs Administrator or Developer Mode. It works on every OS, so converting
everywhere is cleaner than keeping the symlink — the cost is that Linux/macOS clones (e.g. cloud
Codex) see a changed file that was never broken for them. Decision on 2026-08-02: accept that cost.

**Fix landed.** Verified 2026-08-03 — `git ls-files -s CLAUDE.md` reports `100644` in `feeds`,
`trvny` and `wambridge`, each alongside a real `AGENTS.md`. `ext-apps` can no longer be checked;
that clone is gone ([[git-folder-layout]]).

See [[git-sync-direction]].
