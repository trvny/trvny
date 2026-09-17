# Interactive tool bridge

Status: **The workspace-confined bridge is live. The target is broader: Pet Dispatcher should become the managed local orchestration layer for the Legion, with workspace isolation as the safe default rather than the ceiling of its authority.**

This note is the maintained source of truth for interactive/local authority. Older design notes that describe host access as typed-adapter-only apply to untrusted delegated agents, not to the maximum capability of the dispatcher itself.

## Goal

Pet Dispatcher should replace Desktop Commander as the normal local connection for remote assistants while fixing the things that make an unrestricted desktop bridge messy or fragile.

The target is not "less access". It is **broad capability with explicit ownership, lifecycle and policy**:

> The dispatcher may reach the workspace, host, devices and LAN when the current identity and task are allowed to do so. Every resource and side effect must still have an owner, purpose and cleanup/recovery path.

That includes normal development work plus awkward real-world cases such as ADB, Foobar, Wambridge, DLNA/UPnP, local services, logs, installed CLIs, non-repository files and Windows diagnostics.

## Core principles

1. **Sandbox by default, not by definition.** A normal coding task starts confined. Host access can be granted when the task genuinely needs it.
2. **Authority depends on who is acting.** A trusted interactive ChatGPT session may receive much broader authority than a spawned free-tier model.
3. **Capability escalation is explicit and temporary.** A session can gain another filesystem root, host execution, device/LAN access or elevation without rebuilding the whole tool surface.
4. **Universal primitives must exist.** Typed adapters improve safety and ergonomics, but they must not be the only way to use a new CLI, Windows feature or attached device.
5. **Everything has an owner and lifetime.** Processes, worktrees, temp files, downloads, ports, logs and child agents belong to a session/task and are reconciled when it ends.
6. **Cleanup is part of success.** `exit 0` is not enough if the task leaves clones, scripts, processes or temporary state behind.
7. **Recovery beats amnesia.** A transport/model crash should leave a journaled session that can be resumed, inspected or cleaned deterministically.
8. **One policy engine.** Interactive calls, deterministic local tools and delegated provider agents all pass through the same local authority/lifecycle layer.

## Trust and identity

Do not use one global permission set for every caller.

The local policy decision should consider at least:

- caller/client identity;
- execution identity (direct assistant vs delegated provider/model);
- selected device;
- task/session purpose;
- requested capability profile;
- current repository/workspace;
- requested lifetime and persistence;
- risk of the requested action.

Example profiles:

```text
operator-interactive
  trusted remote assistant
  workspace + scoped host access
  dynamic capability escalation
  publication when explicitly requested

trusted-delegate
  known coding agent/provider
  isolated workspace
  normal build/test network profiles
  no automatic host-wide authority

untrusted-delegate
  unknown/free provider model
  isolated scratch/worktree only
  minimal secrets and egress
  no host shell, arbitrary LAN or credential access
```

A provider agent can request more authority, but it cannot grant it to itself.

## Session modes

The dispatcher should support authority levels through one session model rather than separate products.

### Workspace mode

Default for repository work and delegated agents.

- workspace-relative filesystem;
- `workspace.exec`;
- structured Git operations;
- bounded build/test networking;
- session-owned process tree and temporary state.

### Host mode

For trusted interactive work that needs the actual Windows machine.

Examples:

- files outside the repo;
- PowerShell/CMD or installed host CLIs;
- process/service inspection and control;
- ADB and attached hardware;
- Foobar/Wambridge/local media stack;
- LAN discovery such as DLNA/UPnP;
- local application logs/configuration;
- package/tool diagnostics.

Host mode is still session-scoped and audited. It is not synonymous with elevation.

### Elevated mode

Administrative authority stays separate. Use it only for operations that actually require elevation, with a narrow lifetime and an explicit policy/approval step.

Examples include system-wide installation, protected registry/service changes or security configuration.

## Dynamic authority

A session should not be forced to predict every path and tool before work starts.

It may begin with:

```text
workspace: travnie/wambridge
profile: code
```

and later request:

```text
+ host.exec
+ host.fs:C:\Users\travn\.local\share
+ lan.local
+ device.adb
```

The dispatcher records the requested expansion, policy decision, lifetime and resulting capability lease. Expiry/revocation removes the extra authority without destroying unrelated session state.

## Universal primitives and typed tools

Typed tools are preferred when they materially improve safety, validation or UX. They are **not a prerequisite for doing useful work**.

The base surface should retain universal escape hatches controlled by policy:

```text
fs.*
workspace.exec
host.fs.*
host.exec
process.*
network/lan capability
session capability request/revoke
```

`host.exec` should prefer argv-style execution where possible, but a shell-capable path may be granted to trusted sessions because Windows administration and odd third-party tools sometimes require it.

Typed helpers such as `adb.install`, `windows.service.restart` or `foobar.play` may be layered on top later. If a new program exposes a CLI/API today, the dispatcher should be able to use it today instead of waiting for a bespoke MCP namespace.

## Real workflow examples

A Wambridge session should be able to:

```text
inspect/edit repo
-> run tests/build
-> launch Wambridge test instance
-> inspect ports/processes/logs
-> discover the speaker on the LAN
-> launch/control Foobar when needed
-> exercise playback/renderer flow
-> stop test-only processes
-> preserve only intentional outputs
```

An Android session should be able to:

```text
build APK
-> adb devices
-> install/reinstall
-> start activity
-> capture logcat/screenshot/UI state
-> reproduce bug
-> edit/build/reinstall
-> clean temporary artifacts and test processes
```

Neither workflow should require a new architectural adapter merely because an unexpected command becomes necessary halfway through.

## Resource ownership

Every resource created or adopted for work should carry session/task metadata where practical:

```text
owner session/task id
purpose
ephemeral | persistent | recovery-retained
created/adopted at
cleanup policy
```

This applies to:

- process trees;
- temporary scripts/files/directories;
- repository checkouts/worktrees;
- downloads/build artifacts;
- logs;
- ports/listeners;
- spawned provider agents;
- device sessions where relevant.

A temporary helper script belongs in session scratch, not randomly beside user files. A process started only for a test dies with the session. A deliberately started persistent service is explicitly marked persistent and is not killed by generic cleanup.

## Repository/workspace lifecycle

Avoid clone and branch graveyards.

- Prefer maintained source clones/mirrors as reusable bases.
- Prefer lightweight isolated worktrees/checkouts for concurrent or risky edits.
- Reuse safe caches/object stores instead of fully rebuilding seventeen copies of the same repository.
- Give every temporary checkout a session owner and TTL.
- Preserve a failed/dirty workspace only when it is useful for recovery; otherwise remove it.
- Never delete unrelated user repositories or state just because cleanup is running.

The final implementation may choose worktrees, independent Git metadata or another strategy per threat model, but the observable contract is the same: isolation where useful without leaving a landfill behind.

## Process lifecycle

Every launched process tree belongs to a call/session unless explicitly promoted to persistent state.

Use Windows Job Objects or an equivalent host boundary so cancellation, timeout and session cleanup can terminate descendants rather than only the first PID.

Track enough metadata to answer:

- who started this process;
- for what purpose;
- whether it should survive the session;
- how to stop/recover it;
- whether cleanup succeeded.

After crashes/reconnects, reconcile recorded processes with live host state instead of assuming either that everything died or that everything should be killed.

## Session finalization

`session.finish` should be a reconciliation operation, not merely a close flag.

A successful finish should account for:

1. requested results/commits/artifacts;
2. running child processes;
3. temporary files and scripts;
4. worktrees/checkouts;
5. open ports/listeners or local servers;
6. injected credentials/secrets;
7. persistent resources intentionally left running;
8. recovery state when cleanup could not be completed safely.

The result should make leftovers visible instead of silently abandoning them.

## Stability and recovery

The dispatcher is supposed to reduce local-tool flakiness, not merely move it behind Cloudflare.

Required properties:

- durable task/session journal;
- idempotent remote delivery where possible;
- reconnectable interactive sessions;
- bounded retries with structured errors;
- process/workspace reconciliation after worker restart;
- cancellation that records cleanup outcome;
- stale-session watchdog;
- no duplicate side effects merely because a queue/control response was lost;
- actionable diagnostics when the local worker, broker or host tool is unavailable.

A dropped MCP connection or crashed model must not automatically become orphaned processes plus mystery directories.

## Filesystem and path policy

Workspace mode keeps canonical path/symlink/junction/reparse-point confinement.

Host filesystem authority is a separate capability. Trusted sessions may be granted configured roots or, when explicitly allowed, broad host filesystem access. Path canonicalization and audit still apply; host mode changes **scope**, not basic correctness checks.

Absolute paths are therefore not universally forbidden. They are forbidden in a workspace-only lease and valid in an appropriate host lease.

## Network and LAN

`network=none` and brokered build traffic remain useful defaults for untrusted/delegated work.

Trusted interactive host sessions may need direct local-network or internet access for real tasks such as DLNA discovery, device control or diagnostics. Represent that authority explicitly instead of pretending every useful network operation fits an HTTPS fetch broker.

Network access should be scoped by profile/lifetime when practical, but lack of a perfect per-process hostname firewall must not force the entire dispatcher to become incapable of trusted local administration.

## Secrets

Keep cloud/provider credentials out of remote task payloads and logs. Inject secrets locally according to identity/profile and remove ephemeral credentials during finalization.

A trusted operator session may legitimately use locally configured credentials. A spawned untrusted model should normally receive none or only the minimum scoped credential required for its isolated task.

## Concurrent clients

Pet Dispatcher is the arbiter when ChatGPT, OpenCode, Codex or another client wants the same machine/repository.

- one writer lease per mutable worktree where needed;
- multiple safe read sessions may coexist;
- delegated providers inherit no more authority than their parent grant;
- host-wide operations are visible to the session journal;
- collisions are reported as structured lease/resource conflicts rather than Git lock-file surprises.

This is one reason the dispatcher should replace parallel ad-hoc local bridges rather than merely sit beside them.

## Security invariant

The invariant is not "powerful tools are forbidden".

It is:

> No caller or delegated model may exceed the authority granted to its current identity/session, and the dispatcher must know what resources that authority created or changed.

For an untrusted provider, that authority may be a tiny sandbox. For a trusted interactive operator, it may deliberately include the host, ADB, LAN and shell access. Those are different policies over the same dispatcher.

## Current state and roadmap — 2026-09-17

Already live:

- [x] Remote MCP direct calls and delegated tasks share the local session/policy engine.
- [x] Repository and configured non-Git workspaces use canonical confinement.
- [x] Bounded filesystem read/write/tree/search/inspect paths.
- [x] `workspace.exec` through MXC with Job Object cleanup/resource limits.
- [x] Direct-session auto-open/finalize lifecycle.
- [x] Brokered build networking while raw sandbox egress stays denied by default.

Next architecture work:

- [ ] Add identity/trust-aware authority profiles instead of one effective permission ceiling.
- [ ] Add managed `host.exec` and host filesystem capabilities for trusted interactive sessions.
- [ ] Add dynamic capability grant/revoke during an existing session.
- [ ] Make ADB, LAN and Windows-host workflows usable through universal host capability first; add typed adapters only where they add value.
- [ ] Strengthen resource ownership/finalization so worktrees, temp files, processes and listeners are reconciled automatically.
- [ ] Add reconnect/recovery paths for interrupted interactive sessions.
- [ ] Add restricted elevation as a distinct high-risk capability, not as the normal host mode.
- [ ] Verify real workflows end to end: Android/ADB and Wambridge/Foobar/DLNA.
- [ ] Continue optimizing round trips/payloads only when measurements show a real win.

## Acceptance target

Desktop Commander becomes optional when a trusted interactive session can complete normal and awkward Legion workflows without a second local bridge, while a delegated untrusted model remains strongly confined.

Acceptance should prove both sides:

1. a low-trust provider cannot escape its workspace, steal host secrets or widen its lease;
2. a trusted interactive session can intentionally gain host/filesystem/shell/device/LAN authority;
3. ADB works without requiring a bespoke adapter for every command;
4. a Wambridge test can control the relevant local/LAN components;
5. cancellation kills session-owned temporary process trees;
6. intentionally persistent processes survive cleanup;
7. temporary scripts/worktrees/downloads are removed or explicitly retained for recovery;
8. reconnect can recover or reconcile an interrupted session;
9. final status reports any leftovers that could not be cleaned safely.

The desired result is not "Desktop Commander with a different API". It is a cleaner superset: broader orchestration, different trust levels, deterministic lifecycle and far less local debris.
