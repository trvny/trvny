# Pet Dispatcher Local Runtime Design

## Goal
Move Pet Dispatcher's control/runtime state out of `.dc` so disposable model work cannot corrupt the service itself, while keeping `.dc` as the confined scratch/workspace area.

## Layout
`%USERPROFILE%\.local\share\pet-dispatcher` becomes the stable local control root:

- `app/releases/<commit>/` compiled runtime + production dependencies
- `app/current.json` active release pointer and provenance
- `config/dispatcher.json` live dispatcher configuration
- `state/remote-journal.json` durable worker journal
- `secrets/*.dpapi` user-bound encrypted secrets
- `repos/trvny.git` stable bare mirror used as the Git session seed/export target
- `bin/` maintained launcher and secret helper
- `logs/` launcher/worker logs

`.dc/pet-dispatcher-workspace/sessions` remains disposable and writable by Pet sessions. No control/config/secrets/app files live under `.dc` after migration.
## Installation and update
The repository remains the source of code, but no live worker executes from a checkout. `npm run install:local` builds the current Pet Dispatcher, installs a release into the stable root, updates the bare mirror, migrates existing local config/state/secrets when present, and atomically switches `app/current.json`.

Re-running the installer updates the runtime from any clean checkout. The active release records its source commit. Old releases are bounded so updates do not accumulate indefinitely.

## Launcher
The installed PowerShell launcher reads only the stable root, resolves the active release from `app/current.json`, decrypts only the two worker secrets it needs, sets `PET_DISPATCHER_CONFIG` for the child, and starts `node dist/src/index.js remote`. A named mutex prevents duplicate workers. The launcher may register an HKCU logon entry so Windows Update/reboot does not strand the worker offline.

## Git source
`repos/trvny.git` is a bare mirror of the GitHub repository. SessionManager clones temporary detached session worktrees from this mirror and exports finished refs back into it. A checkout such as `.dc/git/trvny-main` is therefore never runtime infrastructure.

## Security and migration
DPAPI blobs are moved, not decrypted/re-encrypted, preserving user-bound encryption. Legacy `.dc/pet-dispatcher`, `.dc/.secrets/pet-dispatcher`, and helper files are removed only after the new install passes doctor/live smoke. The later network/env change will place its policy under `config/` and will keep secrets deny-by-default.
