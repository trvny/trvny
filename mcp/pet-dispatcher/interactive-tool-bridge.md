# Interactive tool bridge

Status: **Phase 3a in progress: remote read-only direct tools implemented**

This note defines how Pet Dispatcher can become the normal local-tool connection for remote assistants such as ChatGPT, instead of requiring Desktop Commander to run in parallel.

The goal is broad local capability with a narrow, enforceable authority boundary:

> The assistant may use many tools, but every local action is confined to the workdir and capability lease assigned by the dispatcher.

## Why

Desktop Commander is useful as a general desktop bridge, but Pet Dispatcher should eventually cover the development workflow directly:

- repository filesystem access;
- command/process execution;
- Git and GitHub CLI;
- Gradle, ADB, npm, Python, ffmpeg and other installed developer tools;
- structured file edits and patches;
- builds, tests and diagnostics;
- optional provider agents such as OpenCode/Codex behind the same boundary.

A remote assistant should not need a second local MCP connection merely because the task changes from "delegate this coding problem" to "run Gradle", "inspect this file" or "use adb".

Desktop Commander may remain an emergency/manual adapter, but it is not the intended primary transport once the bridge is mature.

## Two execution modes, one policy engine

Pet Dispatcher should expose two modes through the same worker and policy engine.

### Delegated task

Longer autonomous task with journaled lifecycle, provider routing, timeout, result collection and cleanup.

```text
delegate -> isolated task workspace -> direct tools / agent -> result
```

### Interactive tool session

Short-lived tool calls initiated directly by the remote assistant during an active conversation.

```text
open_session
   -> assigned workdir + capability lease
   -> fs.read / fs.write / workspace.exec / git / adb / ...
   -> close_session
```

The interactive mode is **not** a bypass around delegated-task security. Both modes pass through the same path canonicalization, process isolation, network rules, audit log and secret policy.

## Session contract

The remote side never supplies an arbitrary host path as authority.

It asks for a logical workspace, for example:

```json
{
  "repo": "trvny/wambridge",
  "ref": "main",
  "mode": "interactive",
  "capabilities": [
    "workspace.read",
    "workspace.write",
    "process.exec",
    "git.local",
    "adb.inspect"
  ],
  "ttl_minutes": 60
}
```

The worker resolves that request to an internal session:

```json
{
  "session_id": "...",
  "workspace_id": "...",
  "root": "<worker-owned canonical path>",
  "capabilities": ["..."],
  "expires_at": "..."
}
```

`root` is informational to the remote client. The client does not gain authority by sending that path back in later requests.

Every subsequent tool call references `session_id` and uses paths relative to the assigned workspace root.

## Filesystem confinement

Filesystem confinement must be enforced locally, independently of prompts or client behavior.

For every path-bearing operation:

1. accept only a workspace-relative path from the remote side;
2. join it to the canonical session root;
3. resolve `.` / `..`, symlinks, junctions and Windows reparse points;
4. reject the operation unless the final resolved target remains inside an allowed root;
5. repeat the check on the parent/final target immediately before a write, rename or delete to reduce TOCTOU escape opportunities.

Absolute paths, UNC paths, drive-qualified paths and device paths are rejected unless a separate narrowly scoped host capability explicitly supports them.

The default session has exactly one writable root: its assigned worktree/workdir.

Optional read-only mounts can be granted explicitly, for example a Gradle cache or Android SDK. They remain read-only even if a process inside the session asks otherwise.

## `workspace.exec`, not an unrestricted host shell

Interactive work needs real command execution. Hiding every executable behind a bespoke MCP method would recreate Desktop Commander's limitations with more YAML.

Pet Dispatcher should therefore expose a general execution primitive, but its authority is the **session**, not the command string.

Preferred request shape:

```json
{
  "session_id": "...",
  "argv": ["./gradlew", "test"],
  "cwd": ".",
  "timeout_seconds": 900,
  "env_profile": "build"
}
```

Rules:

- `cwd` is workspace-relative and cannot escape the session root;
- prefer argv execution without an intermediate shell;
- shell execution is a separate capability and disabled by default;
- the process runs as the worker's non-admin identity;
- the whole process tree belongs to a per-call/per-session job boundary and can be terminated;
- inherited environment is minimal;
- secrets are injected only by named local profiles;
- executable lookup follows local policy, not caller-provided absolute host paths;
- stdout/stderr are bounded and streamed/returned with secret redaction;
- direct sockets are denied for `none` and `brokered`; brokered HTTPS goes through the dispatcher allowlist, while direct `restricted` egress requires a separately proven host boundary;
- child processes inherit the same containment boundary.

This gives ChatGPT access to `git`, `gh`, Gradle, ADB, npm, Python, ffmpeg and future tools without adding a new MCP method for every binary.

## Host-tool capabilities

Some useful tools cannot live entirely inside a WSL/container filesystem boundary because they interact with Windows or attached hardware.

Treat these as host adapters with the same session model, for example:

```text
adb.inspect
adb.install
git.credentials
github.auth
windows.process.inspect
```

A host adapter receives:

- the session identity;
- the canonical workdir;
- a typed capability;
- validated structured arguments.

It does not receive a free-form "run PowerShell as host" escape hatch.

For ADB specifically, a session can be allowed to call the host ADB server while still preventing arbitrary host filesystem access.

## Tool surface

A practical interactive MCP surface can remain compact:

```text
open_session
close_session
session_status

fs.list
fs.stat
fs.read
fs.write
fs.patch
fs.mkdir
fs.move
fs.delete

workspace.exec
workspace.cancel

git.status
git.diff
```

`git.*` methods are the authoritative repository operations. Phase 1 deliberately keeps Git metadata outside the MXC-writable worktree, so `workspace.exec ["git", ...]` is not relied on for repository state even when the Git binary itself is allowlisted.

Do not create a separate MCP namespace for every installed CLI unless structured arguments materially improve safety or ergonomics.

## Capability profiles

Avoid prompting for dozens of individual tool permissions on every task. Define locally maintained profiles that expand into concrete capabilities.

Example:

```text
inspect
  workspace.read
  process.exec:read-oriented
  git.read

code
  workspace.read
  workspace.write
  process.exec
  git.local
  tests.run

android
  code
  adb.inspect
  adb.install-to-test-device

publish
  code
  git.commit
  github.pr.create
```

The remote assistant may request a profile, but the worker decides whether it is available for the selected repository/device.

High-risk capabilities such as elevation, credential-store reads, firewall changes, registry writes, arbitrary host filesystem access and force-push remain separate and denied by default.

## Repository/workdir ownership

The dispatcher should prefer an existing maintained clone as the source repository while executing changes in worker-owned temporary checkouts. Phase 1 uses independent `git clone --no-local --no-checkout --separate-git-dir` checkouts: each session owns its reachable Git objects instead of borrowing them through source-repository alternates. The MXC-writable worktree contains only working files, while session Git metadata lives in a private sibling directory that is never granted to the sandbox.

For interactive coding sessions:

1. resolve the configured repository;
2. create or reuse one session-owned isolated checkout under the worker workspace root;
3. make that checkout the only writable filesystem root;
4. keep the session alive while ChatGPT is actively using tools;
5. preserve commits/results as requested;
6. remove the checkout when the session closes or expires, unless explicitly retained for recovery.

This keeps "current repo state" and "assistant scratch state" separate and avoids an expanding zoo of dirty clones.

## Concurrent clients

Pet Dispatcher should be the arbiter when ChatGPT, OpenCode, Codex or another client wants the same repository.

- one writer lease per worktree;
- multiple read-only sessions may coexist where safe;
- provider agents launched inside an interactive/delegated session inherit that session's authority;
- no second local bridge may silently write into the same worktree;
- conflicts are reported as structured lease/session state instead of relying on Git lock-file accidents.

This is the main reason the dispatcher should replace parallel Desktop Commander usage rather than merely sit beside it.

## Security invariant

The critical property is not "the assistant cannot call powerful tools".

The critical property is:

> Even a powerful tool, malformed command, compromised model or prompt-injected agent cannot access resources outside the authority assigned to its dispatcher session.

That means confinement belongs below the MCP/tool layer, ideally at the OS/container/VM/process boundary plus canonical path checks. Tool allowlists alone are insufficient.

## Phase-1 addition

The local MVP should prove the interactive bridge before remote deployment:

1. open a session for a test repository;
2. read/write/patch files only inside its worktree;
3. run arbitrary normal developer CLIs through `workspace.exec`;
4. prove `..`, symlink/junction/reparse-point and absolute-path escapes fail;
5. prove a child process cannot outlive cancellation/timeout;
6. prove a second writer cannot acquire the same worktree;
7. prove host adapters such as ADB receive only their typed capability;
8. close the session and confirm cleanup leaves no stray worktree/process;
9. run the same fixture through the MCP surface used by ChatGPT.

Once this works, a remote assistant can use Pet Dispatcher as its normal Legion tool connection, while Desktop Commander becomes optional rather than a required companion process.
