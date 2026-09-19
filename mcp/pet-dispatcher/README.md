# Pet Dispatcher

Workspace-confined MCP worker for using a trusted development machine without exposing an unrestricted host shell.

Phase 1 provides the local confined worker. Phase 2 adds a replaceable remote transport with a Cloudflare Queues control plane, signed task envelopes, local duplicate suppression, heartbeat/cancellation and outbound-only polling from the Legion.

The broader architecture remains in [`agent-dispatcher-concept.md`](./agent-dispatcher-concept.md). [`interactive-tool-bridge.md`](./interactive-tool-bridge.md) defines the direct ChatGPT/tool-session path intended to replace a parallel Desktop Commander connection.

## What works now

- one writable session per configured repository plus explicitly configured non-Git workspaces,
- independent non-local Git checkouts with private metadata outside the MXC-writable worktree,
- live stale-session reaping plus safe session list/reclaim operations,
- workspace-confined filesystem tools with bounded reads/listings and batched `fs.readMany`, `fs.tree`, and `fs.search`,
- structured host Git status/diff/add/commit/export plus one-call `git.summary`,
- `workspace.exec` through Microsoft MXC / Windows ProcessContainer,
- canonical host-PATH discovery for Git and sandbox commands, with only the discovered tool directory added read-only,
- Windows Job Object process-tree cleanup, memory/process ceilings, timeout/cancellation and bounded process output,
- remote embedded free-model routing through the signed control plane and shared Kanarek Review router, while local/manual mode retains the direct OpenAI-compatible backend registry plus Gemini,
- brokered HTTPS with exact destination validation and MXC/WFP confinement to one ephemeral loopback proxy port,
- direct sandbox sockets denied by default, including unrelated host-loopback ports,
- signed remote tasks bound to one device with nonce + expiry checks,
- durable local remote-task journal with fail-closed `recovery_required`,
- Cloudflare Queue HTTP-pull transport with heartbeat/result callbacks and bounded idle backoff,
- OS-backed singleton lease preventing multiple local Queue consumers for one remote worker identity,
- Cloudflare Worker control plane backed by a SQLite Durable Object,
- authenticated Streamable HTTP MCP facade at `/mcp` for remote ChatGPT/tool clients,
- compact `pet_direct(target, tool, args)` calls validated against the full server-side tool schema,
- auto-opened direct write/exec sessions finalized by one `session.finish` call,
- structured direct results in `result.data` instead of JSON strings nested inside task JSON.

## Security model

The remote transport does not widen the local authority boundary. Every delegated task is converted into an existing Pet Dispatcher session, and provider agents see only the tools allowed by the requested capability profile. Unsupported high-risk profiles fail closed.

`git_export` preserves a session commit under `refs/pet-dispatcher/<session-id>` in the configured source clone. It remains controller-only and is not exposed to provider agents. Host filesystem/Git operations and `workspace.exec` share one per-session activity lease.

Session Git objects are copied through a non-local clone path instead of borrowing the source clone object database. Source-side pruning therefore cannot invalidate an active session. Non-Git workspaces use the same realpath/symlink confinement but never pretend to be repositories.

Host commands are resolved to canonical absolute paths. PATH discovery adds only the executable's canonical tool directory to the MXC read-only policy; Scoop tools grant only their versioned app root so launchers can reach sibling runtime files. Filesystem roots are rejected. On Windows, trusted host tools run with Win32k available because MXC requires it for many normal CLI executables, while workspace-local executables keep Win32k denied; clipboard access and input injection remain denied. `toolRoots` remains available for explicit pinned roots, but normal PATH-visible tools do not need to be duplicated there.

Remote envelopes and worker callbacks use an HMAC secret that stays in Cloudflare secrets and the Legion environment. Cloudflare Queue bearer credentials also remain local to the Legion. Neither belongs in `dispatcher.local.json`, task payloads, logs or Git.

`restricted` direct egress is still fail-closed. Remote tasks may request `none` or a configured `brokered` network profile only.

## Remote control plane

The first transport implementation uses Cloudflare Queues with an HTTP pull consumer. The Legion opens outbound HTTPS connections only. No public listener or router port-forward is required.

The Worker exposes authenticated operator endpoints for delegate/status/cancel, a `/v1/tool` endpoint for confined direct work, and signed worker-only lease/heartbeat/result callbacks. Task state lives in a SQLite-backed Durable Object. Queue delivery is still at-least-once; the local journal is authoritative for duplicate suppression and never automatically replays an interrupted task. Phase 2 caps remote execution at 20 minutes under a minimum 30-minute Queue visibility lease; heartbeat reports liveness/cancellation but does not extend the Queue lease. Direct write/exec calls may auto-open a 30-minute session, return its `sessionId`, and reuse it for later calls. `session.finish` stages all session changes, commits when necessary, exports the resulting commit under `refs/pet-dispatcher/<session-id>`, and closes the session. Explicit sessions remain available and expired sessions discard their isolated scratch checkout. Direct tools use `network=none` by default; `workspace.exec` may request one signed configured network profile together with `network.fetch`, and that profile is fixed for the session. `workspace.exec` requires `process.exec`, uses argv-style MXC execution, enforces Job Object resource limits, and returns structured bounded stdout/stderr with optional head/tail shaping.

`/mcp` is a stateless Streamable HTTP MCP endpoint. Operator clients may keep using `Authorization: Bearer <CONTROL_PLANE_TOKEN>`. Custom-connector UIs that offer a URL but no arbitrary header can instead use `https://<worker>/mcp/<MCP_CONNECTOR_TOKEN>` with connector auth set to **None**. `MCP_CONNECTOR_TOKEN` is a separate secret accepted only on the MCP route, never on `/v1/*`; do not reuse `CONTROL_PLANE_TOKEN` in the URL. Invocation logs are disabled so the secret path is not persisted by Worker logging.

The MCP endpoint exposes `pet_meta`, `pet_delegate`, `pet_direct`, `pet_task_get` and `pet_task_cancel`. The normal direct shape is `pet_direct(target, tool, args)`; the server reconstructs and validates the full discriminated tool call internally. For read-heavy reconnaissance, `workspace.inspect` composes the existing bounded tree, optional text search and compact Git summary into one direct call; `include`, path/search limits and byte budgets keep the response small, and non-Git workspaces return `git: null` rather than pretending to be repositories. For state-changing filesystem and exec tools, MCP defaults `autoSession` to true when no `sessionId` is supplied. The returned `sessionId` can be reused, then finalized with `session.finish`. Completed task payloads live in structured content only, while MCP text stays short. Task timestamps, heartbeat state and similar transport metadata are omitted by default and available with `debug: true`. `pet_meta` is an optional compact capability dashboard, not a required preflight round trip.

MCP `initialize` advertises the display title **Pet Dispatcher**, a concise description, the repository URL and the public `https://pet-dispatcher-control.travny.workers.dev/icon.png` icon. `assets/pet-dispatcher.svg` is the maintained icon source; `npm run build:icon` regenerates both `assets/pet-dispatcher.png` and the inlined Worker module.

HTTP pull must be enabled separately after the queue exists:

```powershell
npx wrangler queues consumer http add pet-dispatcher-tasks
```

The pull client requires a Cloudflare API token scoped to Queues read+write because acknowledgements mutate queue state. Empty/error polls back off exponentially from `pollIntervalMs` to `pollMaxIntervalMs`; handling a task resets the interval immediately. The control plane additionally caps new delegations at **500 per UTC day**. The Queue API token remains local-only and is never stored in the repository.

## Local setup

Development still runs from the repository, but the live remote worker is installed outside disposable checkouts:

```powershell
cd mcp/pet-dispatcher
npm ci
npm run check
npm run install:local
```

The Windows installer publishes an immutable release under `%USERPROFILE%\.local\share\pet-dispatcher\app\releases`, keeps the live config/state/DPAPI secrets and a bare `trvny.git` mirror under the same stable root, and registers the installed launcher for the current user at logon. Re-run `npm run install:local` from any clean checkout to update it; use `npm run install:local -- --no-startup` when startup registration is not wanted.

Remote agent tasks refresh that configured bare mirror from its existing `origin` before opening the disposable session when `remote.syncRepositories` is enabled (default: `true`). The task cannot supply or replace the remote URL, Git credential helpers and prompts remain disabled, and the fetch updates only heads/tags, so exported `refs/pet-dispatcher/*` survive. A failed refresh fails the task closed instead of silently running against stale code.

Only disposable Pet session workspaces remain under `.dc\pet-dispatcher-workspace`. The live worker does not execute from `.dc\git` or any repository worktree. `toolRoots` may stay empty for normal PATH-visible host tools; add explicit roots only when pinning a tool outside PATH or deliberately granting an additional read-only tool directory.

The legacy remote executor id `openrouter` now uses the control plane's signed free-router proxy when running as the remote Legion worker. The proxy holds only `KANAREK_REVIEW_ROUTER_TOKEN` and reaches Kanarek Companion through a same-account Service Binding; raw provider credentials remain centralized in the private `kanarek-review` Worker. Local/manual dispatcher runs still use the direct OpenAI-compatible backend registry. The managed router may choose any healthy free provider for the first model step. Once a tool call executes, Pet Dispatcher pins that underlying provider identity from the router response and fails closed if a later step switches providers, avoiding duplicate or divergent side effects.

For remote polling, configure the `remote` block and set only the transport/signing secrets below. Before the installed remote launcher starts Node, it removes all known direct-provider credential variables inherited from the Windows logon environment; remote model credentials stay centralized behind the managed free-router.

```powershell
$env:PET_DISPATCHER_QUEUE_TOKEN = '<queues read+write token>'
$env:PET_DISPATCHER_SIGNING_SECRET = '<same HMAC secret as Cloudflare>'
npm run remote
```

For the control plane, create the Queue, set `CONTROL_PLANE_TOKEN` and `TASK_SIGNING_SECRET` as Worker secrets, and store the private connector value as repository secret `PET_DISPATCHER_MCP_CONNECTOR_TOKEN`. The shared `.github/scripts/sync-cloudflare-worker-secret.sh` helper mirrors it into Worker secret `MCP_CONNECTOR_TOKEN`. Botek binds to the named `TelegramAssistantEntrypoint` through a same-account Cloudflare Service Binding; that RPC surface cannot access direct tools. `npm run control:check` validates the Worker bundle without deploying it.
