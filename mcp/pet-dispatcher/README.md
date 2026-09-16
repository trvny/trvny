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
- Windows Job Object process-tree cleanup, memory/process ceilings, timeout/cancellation and bounded process output,
- OpenAI-compatible free-tier routing across OpenRouter, OrcaRouter, AIHubMix, Ollama Cloud and Groq, plus Gemini, using capability-filtered tools,
- brokered HTTPS with exact destination validation,
- direct sandbox sockets denied by default,
- signed remote tasks bound to one device with nonce + expiry checks,
- durable local remote-task journal with fail-closed `recovery_required`,
- Cloudflare Queue HTTP-pull transport with heartbeat/result callbacks,
- OS-backed singleton lease preventing multiple local Queue consumers for one remote worker identity,
- Cloudflare Worker control plane backed by a SQLite Durable Object,
- authenticated Streamable HTTP MCP facade at `/mcp` for remote ChatGPT/tool clients,
- compact `pet_direct(target, tool, args)` calls validated against the full server-side tool schema,
- structured direct results in `result.data` instead of JSON strings nested inside task JSON.

## Security model

The remote transport does not widen the local authority boundary. Every delegated task is converted into an existing Pet Dispatcher session, and provider agents see only the tools allowed by the requested capability profile. Unsupported high-risk profiles fail closed.

`git_export` preserves a session commit under `refs/pet-dispatcher/<session-id>` in the configured source clone. It remains controller-only and is not exposed to provider agents. Host filesystem/Git operations and `workspace.exec` share one per-session activity lease.

Session Git objects are copied through a non-local clone path instead of borrowing the source clone object database. Source-side pruning therefore cannot invalidate an active session. Non-Git workspaces use the same realpath/symlink confinement but never pretend to be repositories.

Remote envelopes and worker callbacks use an HMAC secret that stays in Cloudflare secrets and the Legion environment. Cloudflare Queue bearer credentials also remain local to the Legion. Neither belongs in `dispatcher.local.json`, task payloads, logs or Git.

`restricted` direct egress is still fail-closed. Remote tasks may request `none` or a configured `brokered` network profile only.

## Remote control plane

The first transport implementation uses Cloudflare Queues with an HTTP pull consumer. The Legion opens outbound HTTPS connections only. No public listener or router port-forward is required.

The Worker exposes authenticated operator endpoints for delegate/status/cancel, a `/v1/tool` endpoint for confined direct work, and signed worker-only lease/heartbeat/result callbacks. Task state lives in a SQLite-backed Durable Object. Queue delivery is still at-least-once; the local journal is authoritative for duplicate suppression and never automatically replays an interrupted task. Phase 2 caps remote execution at 20 minutes under a minimum 30-minute Queue visibility lease; heartbeat reports liveness/cancellation but does not extend the Queue lease. Direct write sessions default to a 30-minute TTL (maximum 60), force `network=none`, use exact capability sets, cap `fs.write` at 64 KiB UTF-8, and export successful commits under `refs/pet-dispatcher/<session-id>`. `workspace.exec` requires an existing session plus `process.exec`, uses argv-style MXC execution, enforces Job Object resource limits, and returns structured bounded stdout/stderr with optional head/tail shaping. Expired sessions discard their isolated scratch checkout.

`/mcp` is a stateless Streamable HTTP MCP endpoint. Operator clients may keep using `Authorization: Bearer <CONTROL_PLANE_TOKEN>`. Custom-connector UIs that offer a URL but no arbitrary header can instead use `https://<worker>/mcp/<MCP_CONNECTOR_TOKEN>` with connector auth set to **None**. `MCP_CONNECTOR_TOKEN` is a separate secret accepted only on the MCP route, never on `/v1/*`; do not reuse `CONTROL_PLANE_TOKEN` in the URL. Invocation logs are disabled so the secret path is not persisted by Worker logging.

The MCP endpoint exposes `pet_meta`, `pet_delegate`, `pet_direct`, `pet_task_get` and `pet_task_cancel`. The normal direct shape is `pet_direct(target, tool, args)`; the server reconstructs and validates the full discriminated tool call internally. Completed task payloads live in structured content only, while MCP text stays short. Task timestamps, heartbeat state and similar transport metadata are omitted by default and available with `debug: true`. `pet_meta` is an optional compact capability dashboard, not a required preflight round trip.

MCP `initialize` advertises the display title **Pet Dispatcher**, a concise description, the repository URL and the public `https://pet-dispatcher-control.travny.workers.dev/icon.png` icon. `assets/pet-dispatcher.svg` is the maintained icon source; `npm run build:icon` regenerates both `assets/pet-dispatcher.png` and the inlined Worker module.

HTTP pull must be enabled separately after the queue exists:

```powershell
npx wrangler queues consumer http add pet-dispatcher-tasks
```

The pull client requires a Cloudflare API token scoped to Queues read+write because acknowledgements mutate queue state. The control plane additionally caps new delegations at **500 per UTC day**. The Queue API token remains local-only and is never stored in the repository.

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

The legacy remote executor id `openrouter` selects from the OpenAI-compatible backend registry. Only `available` backends enter automatic routing. A provider failure may fall through to the next backend only before any tool call has executed; after a tool side effect, the task fails closed instead of risking duplicate actions.

For remote polling, configure the `remote` block and set only local environment secrets:

```powershell
$env:PET_DISPATCHER_QUEUE_TOKEN = '<queues read+write token>'
$env:PET_DISPATCHER_SIGNING_SECRET = '<same HMAC secret as Cloudflare>'
npm run remote
```

For the control plane, create the Queue, set `CONTROL_PLANE_TOKEN` and `TASK_SIGNING_SECRET` as Worker secrets, and store the private connector value as repository secret `PET_DISPATCHER_MCP_CONNECTOR_TOKEN`. The shared `.github/scripts/sync-cloudflare-worker-secret.sh` helper mirrors it into Worker secret `MCP_CONNECTOR_TOKEN`. Botek binds to the named `TelegramAssistantEntrypoint` through a same-account Cloudflare Service Binding; that RPC surface cannot access direct tools. `npm run control:check` validates the Worker bundle without deploying it.
