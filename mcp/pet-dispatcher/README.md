# Pet Dispatcher

Workspace-confined MCP worker for using a trusted development machine without exposing an unrestricted host shell.

The Phase 1 local MVP is implemented in this directory. The broader architecture remains documented in [`agent-dispatcher-concept.md`](./agent-dispatcher-concept.md), while [`interactive-tool-bridge.md`](./interactive-tool-bridge.md) defines the direct ChatGPT/tool-session path intended to replace a parallel Desktop Commander connection.

## What works now

- one writable session per configured repository,
- session-owned lightweight Git checkouts with private metadata outside the MXC-writable worktree,
- workspace-confined filesystem tools,
- structured session-bound host Git adapter for status/diff/add/commit/export; source objects and Git config are never exposed to the sandbox,
- `workspace_exec` through Microsoft MXC / Windows ProcessContainer,
- process timeout, cancellation and bounded output,
- OpenRouter and Gemini agent adapters over the same confined tools,
- brokered HTTPS profiles with exact destination validation,
- direct sandbox sockets denied by default,
- path traversal, junction/symlink escape, Git-filter escape, activity-race and sandbox-boundary tests.

`git_export` preserves a session commit under `refs/pet-dispatcher/<session-id>` in the configured source clone, allowing a clean session close without losing committed work. It is intentionally controller-only and is not exposed to OpenRouter/Gemini provider agents. Host filesystem/Git operations and `workspace_exec` share one per-session activity lease, so a sandbox process cannot swap a junction or symlink between host-side validation and mutation.

`restricted` direct egress is intentionally fail-closed on the current Windows backend until there is an enforceable per-session host/network boundary. For the same reason, `open_session(sync=true)` is fail-closed in Phase 1 instead of running an unrestricted host `git fetch`.
## Network model

Sessions choose one of three modes when opened:

- `none` — no direct or brokered network access.
- `brokered` — sandbox sockets remain blocked; `http_fetch` performs GET/HEAD outside the sandbox after validating the configured hostname profile, HTTPS, port, redirects and response size.
- `restricted` — reserved for future direct CLI egress through a host-enforced firewall/proxy boundary. Requests currently fail closed.

Broker profiles are explicit configuration, not authority supplied by the caller. Phase 1 accepts exact DNS hostnames only; wildcard host rules are rejected. Redirect destinations are validated again, URL credentials and IP literals are rejected, and only a small safe response-header set is returned.

OpenRouter/Gemini API keys stay in the dispatcher process. On the current AppContainer + DACL tier, Node/Deno/npm may require the one-time elevated wxc-host-prep prepare-system-drive metadata ACL preparation reported by doctor; the dispatcher does not apply it automatically. They are not passed to `workspace_exec` children. Current Windows ProcessContainer builds also have an upstream issue with caller-supplied environment blocks, so Phase 1 deliberately launches sandboxed commands with a cleared environment and resolves the requested executable to an absolute allowlisted tool-root path first.

## Setup

```powershell
cd mcp/pet-dispatcher
npm install
Copy-Item dispatcher.config.example.json $env:LOCALAPPDATA\pet-dispatcher.json
$env:PET_DISPATCHER_CONFIG = "$env:LOCALAPPDATA\pet-dispatcher.json"
npm run doctor
npm run check
npm run dev
```
