# Pet Dispatcher Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Install and run Pet Dispatcher from a stable user-local control root independent of `.dc` checkouts.

**Architecture:** Keep source code in GitHub/repository checkouts, publish compiled immutable releases to `%USERPROFILE%\.local\share\pet-dispatcher`, use a stable bare Git mirror there, and keep only disposable session workspaces in `.dc`. An installed launcher owns DPAPI secret loading and worker restart/autostart.

**Tech Stack:** Node.js/TypeScript, PowerShell, Git, Windows DPAPI, MXC.

**Spec:** `docs/superpowers/specs/2026-09-16-pet-dispatcher-local-runtime-design.md`

**Status (2026-09-21):** Completed and merged. The stable installed runtime is live; this file is retained as implementation history rather than an active backlog.

## Global Constraints
- No live runtime dependency on a repository checkout or worktree.
- `.dc` contains disposable session/workspace data only after migration.
- DPAPI secrets never become plaintext files.
- Local session confinement and existing resource limits remain unchanged.
- Runtime relocation stayed one logical change. Brokered build networking was implemented separately afterward.

---
### Task 1: Stable repository seed
**Files:** modify `tests/workspace-session.test.ts` only if production changes are unnecessary.

- [x] Add a failing regression that creates a bare mirror and opens/exports a Pet session from it.
- [x] Run the targeted test and confirm the current implementation either already passes or exposes a real compatibility gap.
- [x] If needed, minimally adjust SessionManager/HostGit, then rerun targeted + portable tests.

### Task 2: Runtime layout and config migration
**Files:** create `mcp/pet-dispatcher/src/local-runtime.ts`, `mcp/pet-dispatcher/tests/local-runtime.test.ts`.

- [x] Test deterministic stable paths and migration of legacy config to stable config/state/mirror paths.
- [x] Implement pure layout/config migration helpers with bounded release retention metadata.
- [x] Run targeted tests and typecheck.

### Task 3: Installer, launcher and secret helper
**Files:** create `mcp/pet-dispatcher/scripts/install-local-runtime.ts`, `scripts/pet-dispatcher-launch.ps1`, `scripts/pet-dispatcher-secrets.ps1`; modify `package.json` and README.

- [x] Add tests for generated/installable layout where practical and preserve fail-closed behavior.
- [x] Installer builds a release, runs production dependency install, updates the bare mirror, migrates config/state/DPAPI blobs, writes `current.json`, and optionally registers HKCU startup.
- [x] Launcher uses a mutex, stable config, scoped DPAPI secrets and the active release only.
- [x] Update docs and local setup commands.

### Task 4: Legion migration and verification
- [x] Run installer from the feature branch into `C:\Users\travn\.local\share\pet-dispatcher`.
- [x] Verify `doctor`, remote worker startup, bare mirror session open/export/close, and zero leaked processes/sessions.
- [x] Remove legacy Pet control/state/secrets under `.dc` only after successful verification; keep `.dc\pet-dispatcher-workspace` as disposable session storage.
- [x] Run full relevant checks, push with GPTomek, open PR, resolve review/CI, squash merge, then delete the temporary migration branch/worktree state.
