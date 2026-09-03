# Pet Dispatcher

Workspace-confined MCP worker for using a trusted development machine without exposing an unrestricted host shell.

Phase 1 provides the local confined worker. Phase 2 adds a replaceable remote transport with a Cloudflare Queues control plane, signed task envelopes, local duplicate suppression, heartbeat/cancellation and outbound-only polling from the Legion.

The broader architecture remains in [`agent-dispatcher-concept.md`](./agent-dispatcher-concept.md). [`interactive-tool-bridge.md`](./interactive-tool-bridge.md) defines the direct ChatGPT/tool-session path intended to replace a parallel Desktop Commander connection.

## What works now

- one writable session per configured repository,
- independent non-local Git checkouts with private metadata outside the MXC-writable worktree,
- orphan-session reclamation using per-session owner metadata,
- workspace-confined filesystem tools with bounded reads/listings,
- structured host Git status/diff/add/commit/export,
- `workspace_exec` through Microsoft MXC / Windows ProcessContainer,
- process timeout, cancellation and bounded output,
- OpenRouter and Gemini adapters using capability-filtered tools,
- brokered HTTPS with exact destination validation,
- direct sandbox sockets denied by default,
- signed remote tasks bound to one device with nonce + expiry checks,
- durable local remote-task journal with fail-closed `recovery_required`,
- Cloudflare Queue HTTP-pull transport with heartbeat/result callbacks,
- Cloudflare Worker control plane backed by a SQLite Durable Object.
- direct read-only remote tools (`fs.list`, `fs.stat`, `fs.read`, `git.status`, `git.diff`) without invoking a model.
- short-lived direct write sessions with `fs.write`, `git.add`, `git.commit`, and MXC-confined `workspace.exec`, still without invoking a model.

## Security model

The remote transport does not widen the local authority boundary. Every delegated task is converted into an existing Pet Dispatcher session, and provider agents see only the tools allowed by the requested capability profile. Unsupported high-risk profiles fail closed.

`git_export` preserves a session commit under `refs/pet-dispatcher/<session-id>` in the configured source clone. It remains controller-only and is not exposed to provider agents. Host filesystem/Git operations and `workspace_exec` share one per-session activity lease.

Session Git objects are copied through a non-local clone path instead of borrowing the source clone object database. Source-side pruning therefore cannot invalidate an active session.

Remote envelopes and worker callbacks use an HMAC secret that stays in Cloudflare secrets and the Legion environment. Cloudflare Queue bearer credentials also remain local to the Legion. Neither belongs in `dispatcher.local.json`, task payloads, logs or Git.

`restricted` direct egress is still fail-closed. Remote tasks may request `none` or a configured `brokered` network profile only.

## Remote control plane

The first transport implementation uses Cloudflare Queues with an HTTP pull consumer. The Legion opens outbound HTTPS connections only. No public listener or router port-forward is required.

The Worker exposes authenticated operator endpoints for delegate/status/cancel, a `/v1/tool` endpoint for stateless reads and session-bound direct writes/exec, and signed worker-only lease/heartbeat/result callbacks. Task state lives in a SQLite-backed Durable Object. Queue delivery is still at-least-once; the local journal is authoritative for duplicate suppression and never automatically replays an interrupted task. Phase 2 caps remote execution at 20 minutes under a minimum 30-minute Queue visibility lease; heartbeat reports liveness/cancellation but does not extend the Queue lease. Direct write sessions are opened explicitly, default to a 30-minute TTL (maximum 60), force `network=none`, use exact capability sets, cap `fs.write` at 64 KiB UTF-8, and export successful commits under `refs/pet-dispatcher/<session-id>`. `workspace.exec` requires an existing session plus `process.exec`, uses argv-style MXC execution, caps a call at 15 minutes, and returns bounded stdout/stderr. Expired sessions discard their isolated scratch checkout.

HTTP pull must be enabled separately after the queue exists:

```powershell
npx wrangler queues consumer http add pet-dispatcher-tasks
```

The pull client requires a Cloudflare API token scoped to Queues read+write because acknowledgements mutate queue state. The Free plan includes 10,000 Queue operations/day and 24-hour retention, which is sufficient for the intended personal control-plane workload. The control plane additionally caps new delegations at **500 per UTC day**. Empty HTTP pull polls do not consume Queue message operations; a normal task costs roughly three Queue operations (write, read, delete), leaving substantial headroom below the Free allowance. The Queue API token remains local-only and is never stored in the repository.

## Local setup

```powershell
cd mcp/pet-dispatcher
npm install
Copy-Item dispatcher.config.example.json $env:LOCALAPPDATA\pet-dispatcher.json
$env:PET_DISPATCHER_CONFIG = "$env:LOCALAPPDATA\pet-dispatcher.json"
npm run doctor
npm run check
npm run dev
```

For remote polling, configure the `remote` block and set only local environment secrets:

```powershell
$env:PET_DISPATCHER_QUEUE_TOKEN = '<queues read+write token>'
$env:PET_DISPATCHER_SIGNING_SECRET = '<same HMAC secret as Cloudflare>'
npm run remote
```

For the control plane, create the Queue, set `CONTROL_PLANE_TOKEN` and `TASK_SIGNING_SECRET` as Worker secrets, deploy `control-plane/wrangler.jsonc`, then enable the HTTP pull consumer. `npm run control:check` validates the Worker bundle without deploying it.
