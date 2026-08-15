---
name: git-sync-direction
description: "Always fetch these repos fresh before touching them — CI bots commit continuously; GitHub is the source of truth, never push local drift up."
metadata:
  type: feedback
  modified: 2026-08-02T00:00:00.000Z
---

**Always `git fetch` before doing anything with the repos under `C:\Users\travn\git`** — reading
them, reasoning about them, or changing them. Automated jobs ("outworld jobs") run against these
repos and commit on their own schedule, so a local clone goes stale the moment you stop looking at
it. Never report or reason about their state from an earlier fetch, from this file, or from memory
of a previous session.

Sync direction is **remote → local**. GitHub is the source of truth. Do not commit and push local
working-tree state as a way of "catching up".

**Why:** Both rules stated on 2026-07-26. First: "git things should be all synced from the remote
GitHub, not the opposite." Then: "always sync fetch fresh gits because there is outworld jobs
ongoing." Observed directly — `feeds` was **1946** commits behind and `tvpi` **958**, both 0 ahead;
and within minutes of resetting them to remote HEAD each was already 1 commit behind again from
`github-actions[bot]` (`chore: refresh streams [...UTC]`, `Update feeds`). The bots author most of
the commit volume in these repos.

**How to apply:** `git fetch` first, every time. Then `git pull --ff-only` or
`git reset --hard @{u}`. Local drift is disposable garbage, not unpushed work — don't agonize over
preserving it, but do list what a destructive command would remove before running it. Never assume
dirty tree == work to publish. See [[git-folder-layout]] and [[github-account-rename]].
