---
name: github-account-rename
description: "GitHub username was renamed travino -> trvny; old name is unclaimed, so never rely on the redirect."
metadata:
  type: reference
  modified: 2026-08-02T00:00:00.000Z
---

The GitHub account was renamed **`travino` -> `trvny`** (confirmed 2026-07-26). Current handle is
`trvny`; repos live at `github.com/trvny/*`.

**Consequences worth remembering:**

- `github.com/travino` returns **404** — the old username is unclaimed. GitHub's rename redirect
  still resolves old remote URLs, but if anyone registers `travino` the redirect dies and a
  `travino/<repo>` remote could silently point at a stranger's repository. Always write remotes as
  `trvny/*`.
- `gh` broke on this: it had `travino` stored, the browser returned `trvny`, and
  `gh auth refresh` failed with "received credentials for trvny, did you use the correct account".
  Fix is `gh auth logout -u travino` then `gh auth login` — the stale account entry was removed
  2026-07-26, so a plain `gh auth login` is all that's needed.
- Git itself authenticates through **Git Credential Manager**, which is independent of `gh` and was
  working fine — a dead `gh` token does not block clone/fetch/push, including private repos.

Related: [[git-folder-layout]], [[git-sync-direction]].
