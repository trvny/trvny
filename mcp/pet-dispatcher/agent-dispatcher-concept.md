# Agent Dispatcher MCP — concept

Status: **planning; local MVP is the next implementation step**

## Goal

A small, provider-agnostic MCP side project that lets a remote assistant delegate bounded development tasks to a trusted worker on the Legion laptop.

The worker should prefer the cheapest available execution path:

1. deterministic local tools (`git`, `gh`, Gradle, ADB, npm, Python, etc.),
2. OpenCode with free/cheap providers,
3. Antigravity when installed,
4. Codex when installed,
5. future adapters without changing the MCP surface.

The cloud side coordinates work. Provider credentials and actual code execution stay on the Legion.

The dispatcher is **not another agent framework**. It owns policy, routing, isolation, task lifecycle and normalized results. Provider-native harnesses own their own model loop behind a narrow adapter.

## Architecture decisions — 2026-08-31 harness review

Current OpenCode, Claude Agent SDK and Codex capabilities make a few boundaries clearer:

- **Outer isolation is authoritative.** Provider permission systems are useful defense in depth, but they are not the worker's security boundary.
- **Do not parse TUIs.** Use structured CLI/API/SDK surfaces. OpenCode can emit JSON events and attach runs to a headless server; Codex provides `exec`, an SDK and `app-server`; Claude provides an Agent SDK.
- **Do not build a second agent loop.** Let OpenCode, Codex, Claude or another provider manage their own reasoning loop. The dispatcher wraps them with policy and lifecycle controls.
- **Fail closed when isolation is expected but unavailable.** A warning followed by unsandboxed execution is unacceptable for remote delegated work.
- **Provider agents receive less authority than the worker.** They cannot widen filesystem, network, credential, publication or process privileges.
- **The first agent adapter remains OpenCode.** It is provider-agnostic and can route to local/free providers such as configured OpenRouter/OrcaRouter-compatible routes without changing the dispatcher contract.

## High-level architecture

```text
ChatGPT / MCP client
        |
        v
Remote MCP control plane
        |
        v
Task broker / transport adapter
        |
        |  outbound pull only
        v
Legion worker
  |
  |-- task journal / lease state
  |-- local policy engine
  |-- workspace manager
  |-- process + network boundary
  |       |
  |       |-- direct tools
  |       |-- OpenCode
  |       |-- Antigravity (later)
  |       |-- Codex (later)
  |       `-- other adapters
  |
  `--> normalized events + result
          |
          v
 structured result + diff + tests + commit
```

The transport must be replaceable. Cloudflare, GCP, AWS or another provider can implement the same broker interface.

The local policy engine sits **outside** every provider adapter. A provider can request an action; only the worker can authorize and execute it.

## MCP surface

Keep the remote MCP deliberately small:

- `delegate` — enqueue a bounded task.
- `status` — get task/worker status.
- `result` — retrieve the structured result and artifact references.
- `cancel` — request cancellation.
- `capabilities` — report installed tools/providers and current availability.
- `wake` — request a wake-up through a separate restricted wake relay.

Do **not** expose a generic remote `shell(command)` tool.

## Task contract

A task should contain only explicit fields such as:

```json
{
  "task_id": "0198...",
  "repo": "trvny/feedseek",
  "base_ref": "main",
  "goal": "Diagnose and fix failing tests",
  "budget": "free",
  "capabilities": ["git.read", "workspace.write", "tests.run"],
  "timeout_minutes": 20,
  "network": {
    "mode": "brokered",
    "profile": "github-npm-read"
  },
  "publish": "none",
  "result": ["summary", "diff", "tests", "commit"]
}
```

The local policy engine converts this into concrete allowed actions. Text from an LLM is never itself authority to expand permissions.

Remote input must not contain arbitrary local paths, raw credentials or shell commands. Repository names, refs, capabilities and publication policy are validated against local configuration.

## Local execution model

### Direct tools first

Do not spend an LLM request on deterministic work.

Examples:

- build requested -> run the relevant build command first;
- GitHub metadata requested -> use `gh`;
- Android diagnostics -> Gradle/ADB;
- formatting/lint -> repository-native commands.

Escalate to an agent only when reasoning or code changes are actually needed.

### Outer execution boundary

Treat every agent runtime as potentially able to issue arbitrary commands unless an OS-level boundary proves otherwise.

The worker must therefore own the real boundary:

- dedicated non-admin worker identity;
- canonicalized worker-owned task workspace;
- explicit read/write roots;
- per-task process tree and hard timeout;
- network policy enforced outside the model prompt;
- per-adapter secret injection with the minimum required credentials;
- fail-closed sandbox startup;
- cleanup and credential removal after every run.

Provider-specific permission prompts and deny rules are **additional controls**, not substitutes for this boundary.

On Windows, prefer WSL2 or a container/VM boundary for agent execution where practical. Keep hardware-dependent Windows actions such as ADB or device-specific helpers behind narrow host-side capabilities instead of giving an agent general host shell access.

### Resource budget

The Legion currently has limited RAM, so default to:

- concurrency: **1 active agent task**;
- bounded CPU/runtime;
- no resident model processes unless useful;
- no duplicate object stores; prefer shared ephemeral checkouts with private session metadata.

A warm OpenCode server is acceptable only if measurements show that avoiding repeated MCP/provider startup is worth the idle footprint.

### Git workspace lifecycle

Avoid branch/checkout graveyards.

1. create a detached shared checkout under one worker-owned root;
2. keep its Git metadata in a private sibling directory outside the sandbox-writable worktree;
3. run the task and tests;
4. if successful, preserve the commit and optionally publish a short-lived remote branch/PR;
5. remove the session checkout and private metadata immediately;
6. watchdog removes stale worker-owned workspaces.

The dispatcher may delete **only resources it created under its own workspace root**.

## Adapter contract

Provider adapters implement one maintained interface rather than copying dispatcher policy into each integration:

```text
probe()              -> capabilities + availability
prepare(task, env)   -> run context
run(context)         -> structured event stream
cancel(run_id)       -> best-effort interruption
collect_result(id)   -> normalized result
cleanup(run_id)      -> provider-local cleanup
```

`probe()` should report facts useful to routing, for example:

- installed / authenticated;
- supported task types;
- structured event support;
- resume support;
- isolation mode;
- current model/provider availability;
- cost class (`free`, `cheap`, `paid`).

Adapters do not decide filesystem access, publication rights or destructive authority.

### Normalized events

Avoid scraping prose to infer state. Normalize provider output into a small event vocabulary such as:

```text
started
progress
tool_request
tool_result
approval_required
test_result
artifact
completed
failed
cancelled
```

Raw provider events may be retained locally for debugging, but remote results should expose the normalized form and redact secrets.

## Provider routing

Initial routing remains intentionally boring:

```text
deterministic tool
    -> OpenCode / free provider
    -> Antigravity
    -> Codex
```

Routing can consider:

- task type,
- currently available quota,
- prior success rate,
- latency,
- context size,
- user budget (`free`, `balanced`, `best`).

Provider-specific output is normalized before it reaches the MCP client.

Routing should start as deterministic code, not another LLM. An agentic router is justified only if measured tasks show that fixed rules are inadequate.

## OpenCode adapter — first agent implementation

OpenCode is the best first agent adapter because it is already provider-agnostic and exposes integration surfaces that do not require terminal scraping.

Preferred integration path:

1. optionally start `opencode serve` bound to loopback only;
2. run through the official API/SDK or `opencode run --attach ... --format json`;
3. select models as `provider/model` from local configuration;
4. consume newline-delimited JSON events;
5. normalize events into the dispatcher result contract.

A persistent local server can avoid repeated MCP cold starts, but it is an optimization rather than an architectural requirement.

### OpenCode security rule

OpenCode's own `bash` tool is **not an OS sandbox**: shell commands execute with the host user's filesystem, process and network authority. Its permission rules can allow/ask/deny commands and external directories, but they do not create a containment boundary.

Therefore:

- run OpenCode inside the worker's outer execution boundary;
- default external directories to deny;
- deny destructive command families explicitly;
- never use `--dangerously-skip-permissions` for dispatcher work;
- use `--auto` only inside an already isolated task environment and only with explicit deny rules still in force;
- keep the OpenCode server loopback-only and authenticated if server mode is used.

## Codex adapter — use the harness, do not recreate it

Codex now exposes its agent harness as reusable integration layers. Pick the shallowest layer that satisfies the task:

- **`codex exec`** — preferred first Codex adapter for bounded background jobs;
- **Codex SDK** — use when the dispatcher needs programmatic start/resume/stream behavior;
- **Codex app-server** — use only when persistent threads, rich streamed events, interruption and approval handling justify a long-lived local process.

The Codex harness already handles the agent loop, context, tool use, sandbox/approval policies and progress events. The dispatcher should not duplicate those responsibilities.

The worker's outer policy remains authoritative even when Codex also provides sandboxing or approvals.

## Claude adapter — optional, policy-friendly path

Claude Agent SDK is a viable later adapter when an authorized Claude execution route is available. It exposes built-in tools, hooks, MCP, permissions, sessions and non-interactive execution.

For dispatcher use:

- prefer a locked-down permission mode such as `dontAsk` with narrow allow rules;
- use a `PreToolUse` hook for checks that must run on **every** tool request, because calls auto-approved by earlier permission stages can bypass `canUseTool`;
- enable sandboxing with fail-closed behavior;
- do not allow unsandboxed fallback for remote delegated work;
- remember that MCP servers and hooks are separate host processes unless the whole Claude process is placed inside an outer container/VM boundary.

Claude's command sandbox is supported on macOS, Linux and WSL2, **not native Windows**. A sandboxed Claude adapter on the Legion should therefore run in WSL2 or a stronger outer container/VM boundary.

## OpenAI Agents SDK — optional orchestration experiment

The OpenAI Agents SDK can compose MCP tools, approvals, guardrails, tracing and sandbox agents. It may become useful if the dispatcher later needs a genuinely agentic orchestration layer.

Do not make it a Phase 1 dependency:

- routing is simpler and safer as deterministic code initially;
- `SandboxAgent` is currently beta;
- tool guardrails do not cover every hosted or built-in execution tool;
- Codex already exposes the coding harness needed by a Codex adapter.

If adopted later, the SDK must sit **inside** the same worker policy boundary rather than becoming the policy authority itself.

## Antigravity adapter — later

Add Antigravity after the local worker contract is stable and the tool is installed. Prefer a documented non-interactive/API/SDK surface if available at that time; do not couple the dispatcher to terminal rendering.

## Task claiming and idempotency

Assume the remote broker can deliver a task more than once.

The worker should maintain a small durable local journal keyed by `task_id`.

**Phase 1 uses local claim state, not a broker lease:**

- atomically claim a `task_id` in the local journal before any side effect;
- keep local `running/completed/failed/cancelled` state;
- if a claim becomes stale, mark it `recovery_required`; never automatically replay it merely because the previous process tree is gone;
- before each logical external side effect, derive and persist a stable `effect_id` from the task identity, action kind and logical target; the same logical effect must keep the same `effect_id` across retries and recovery;
- persist the effect intent before the call and its receipt afterward; adapters reuse `effect_id` as the remote idempotency key where supported and reconcile/query remote state with that same identity before retrying;
- if an external system cannot provide idempotency, conditional creation or a reliable reconciliation query for that effect, leave the task in `recovery_required` and never replay it automatically;
- resume a stale task only when already-performed side effects are proven idempotent or safely reconciled; otherwise fail closed for manual/recovery-specific handling;
- publish results idempotently;
- deduplicate before any side effect;
- store commit/artifact hashes in the completed record.

**Phase 2 adds the remote broker lease + heartbeat** with bounded expiry. Broker lease expiry makes a task eligible for redelivery, but the local journal remains authoritative for duplicate suppression: the same `task_id` must not execute twice while its original process tree is still alive.

`cancel` is a request, not magic: the worker marks cancellation, terminates the owned process tree, then records whether cleanup completed.

## Remote transport candidates

The core must not depend on one cloud.

### Cloudflare — current default candidate

Good fit for the first remote prototype:

- Workers Free provides a small control endpoint.
- Queues is available on Workers Free and supports HTTP pull consumers.
- Free Queues currently includes 10,000 operations/day with 24-hour retention.
- The Legion can pull work over HTTPS; no inbound port is required.
- Existing project infrastructure already uses Cloudflare.

### Google Cloud

Viable alternative:

- Cloud Run has an always-free usage tier.
- Pub/Sub has a free monthly allowance.
- Cloud Run is private by default and integrates cleanly with IAM.
- Strong identity model, but more setup/IAM surface than the Cloudflare version.

### AWS

Also viable:

- SQS includes 1,000,000 requests/month free for all customers.
- Lambda includes a monthly free request/compute allowance.
- Lambda Function URLs can use AWS IAM/SigV4 and do not require API Gateway.
- Excellent security primitives, but significantly more IAM/configuration overhead for this tiny personal control plane.

### Recommendation

Prototype the transport behind a tiny interface and start with **Cloudflare Queues + HTTP pull** unless testing shows a concrete drawback.

Do not use API Gateway merely because it exists. For this workload it adds complexity and its promotional free allowance is less attractive than SQS/Lambda Function URLs.

## Security model

Security is part of the architecture, not a later hardening pass.

### Network boundary

- **No public listener on the Legion.**
- No router port forwarding to Windows.
- Worker initiates outbound TLS connections only.
- Any local agent/API server binds to loopback or a private task namespace only.
- Remote MCP/control plane never receives OpenCode, Gemini, Codex, GitHub or local Windows credentials.
- Separate wake relay from execution worker.

### Authentication and task integrity

- MCP endpoint: OAuth/OIDC or equivalent strong identity.
- Per-device worker identity.
- Short-lived credentials where possible.
- Signed task envelopes.
- Nonce + timestamp + short TTL to prevent replay.
- Monotonic task IDs / deduplication.
- Rotate/revoke device keys independently.
- Never trust caller-provided filesystem paths without canonicalization.

### Capability-based local policy

The worker accepts typed capabilities, not arbitrary commands.

Examples:

```text
git.read
git.commit
github.pr.create
gradle.build
adb.inspect
workspace.write
tests.run
```

High-risk capabilities are denied by default:

```text
system.admin
filesystem.outside_workspace
git.force_push
credentials.read
firewall.modify
registry.modify
arbitrary_shell
```

Provider agents cannot grant themselves additional capabilities.

### Windows isolation

Run the worker:

- as a dedicated non-admin Windows account/service identity;
- with access only to configured repository/workspace roots;
- with per-task process tree termination (Windows Job Object or equivalent);
- with explicit time/resource limits;
- without elevation prompts.

Where practical, execute agent runtimes in WSL2/container/VM isolation. Hardware-dependent tools such as ADB can use narrowly scoped host-side helpers.

### Secrets

- Store secrets locally using Windows Credential Manager/DPAPI or provider-native secure stores.
- Never put long-lived secrets in task payloads, logs, Git history or the cloud queue.
- Prefer GitHub App / short-lived installation tokens over broad PATs.
- Scope every cloud credential to the exact queue/function/resource it needs.
- Inject only the secrets required by the selected adapter/task.
- Redact logs before returning them remotely.

### Egress

Use locally maintained network profiles; remote callers may request a profile name but cannot supply a new host allowlist. A coding agent does not automatically gain arbitrary network access just because it can execute a command.

- `none` is the default and grants no network authority.
- `brokered` keeps sandbox sockets blocked and routes bounded HTTPS GET/HEAD requests through the dispatcher, which validates scheme, port, hostname profile, redirects and response size.
- `restricted` is reserved for direct CLI egress only when the host can prove per-session enforcement. If that boundary is unavailable, the session fails closed rather than degrading to open outbound access.

On current Windows ProcessContainer builds, do not treat `allowedHosts` as an enforceable hostname firewall. The local worker must use the broker or another independently enforced host boundary.

### Destructive operations

Hard-deny or require a separate human approval for:

- deleting outside the worker-owned scratch/worktree root;
- force-pushing protected branches;
- modifying OS security configuration;
- installing system-wide software;
- reading credential stores;
- arbitrary PowerShell/CMD execution requested directly from remote input.

### Audit

Record a compact append-only local audit trail:

- task identity,
- requested capabilities,
- policy decision,
- adapter/tool chosen,
- normalized action/tool events,
- commands/actions performed by trusted host helpers,
- exit status,
- resulting commit/diff hashes.

Never log secret values.

## Remote wake-up

Wake-on-LAN can wake Windows from **S4 hibernation** when the NIC and firmware support it.

The preferred flow is:

```text
ChatGPT
   |
   v
remote MCP -> wake request
   |
   v
trusted always-on LAN relay
   |
   | magic packet, fixed target MAC
   v
Legion wakes
   |
   v
worker starts/checks in outbound
   |
   v
worker pulls queued task
```

The cloud service itself cannot directly emit a LAN broadcast into the home network. Something already inside the LAN must send the magic packet.

### Wake relay options

Preferred order:

1. existing router, if it supports authenticated WoL/VPN/API;
2. tiny always-on device (Pi, NAS, low-power home server);
3. minimal dedicated relay such as an ESP32 if no general-purpose always-on machine exists.

Tailscale can secure access to an always-on relay, but Tailscale itself does not transport Layer-2 WoL magic packets; the relay must send the packet locally.

### Wake relay permissions

The wake relay should be intentionally stupid:

- fixed allowlisted MAC address(es);
- only `wake(device)` capability;
- no shell;
- no filesystem;
- rate limiting;
- authenticated request;
- audit timestamp;
- cannot talk to the Legion execution service after wake.

This sharply limits damage even if the wake path is compromised.

### Legion verification later

Before enabling it, verify on the actual 82AU:

```powershell
powercfg /a
powercfg /devicequery wake_from_any
powercfg /devicequery wake_armed
Get-NetAdapter
Get-NetAdapterPowerManagement
```

Then inspect the Ethernet adapter's advanced properties and BIOS/UEFI for Wake-on-LAN support.

Configure wake from **Magic Packet only**, not generic network pattern matching.

## Lifecycle

A remote task should be able to use this sequence:

1. enqueue task;
2. if worker offline, optionally request wake;
3. wait for authenticated worker check-in;
4. worker atomically claims the task in its local journal; Phase 2 remote execution additionally acquires and renews the broker lease;
5. worker validates task + capabilities and creates an isolated workspace;
6. worker chooses the cheapest suitable execution path;
7. worker executes with the minimum capability set;
8. worker publishes structured result idempotently;
9. worker cleans its workspace and provider state;
10. optionally hibernate after a configurable idle window.

The cloud should not be able to force hibernation or arbitrary power operations except through explicitly defined, local-policy-controlled capabilities.

## Implementation phases

### Phase 0 — design

- keep this document as source of truth;
- settle task/result/event schemas;
- threat model;
- transport abstraction;
- adapter contract;
- decide the Phase 1 outer isolation mechanism on the Legion.

### Phase 1 — local MVP

- worker daemon/CLI;
- durable task journal;
- direct tool adapter;
- OpenCode adapter using structured JSON/API output;
- one-task concurrency;
- workspace lifecycle + cleanup watchdog;
- process-tree timeout/cancel;
- explicit local capability policy;
- structured JSON result + normalized event stream.

No remote access yet.

Phase 1 is successful when a local fixture can prove all of these:

1. deterministic task runs without an LLM;
2. OpenCode task runs in a temporary worktree and produces structured events;
3. denied capability remains denied even if the provider requests it;
4. timeout/cancel kills the whole owned process tree;
5. duplicate `task_id` cannot repeat side effects;
6. a local fixture that simulates an external write succeeding and then crashes before task completion is recorded recovers/reconciles to exactly one logical effect;
7. cleanup leaves no stale worktree/provider process;
8. result contains summary, validation evidence and artifact/commit hashes.

### Phase 2 — remote control plane

- MCP `delegate/status/result/cancel/capabilities`;
- queue transport;
- strong auth;
- signed/replay-protected task envelopes;
- leases + heartbeat;
- audit log.

### Phase 3 — wake

- test S4 WoL on the Legion;
- choose router/relay;
- implement restricted `wake` path;
- worker auto-resume/check-in.

### Phase 4 — more agents

- Antigravity adapter;
- Codex `exec` adapter first, SDK/app-server only if needed;
- optional Claude Agent SDK adapter;
- optional additional OpenCode providers.

### Phase 5 — smarter routing

- quota awareness;
- task/provider success metrics;
- free-tier fallback;
- optional review/repair loop;
- only then consider an agentic router if deterministic rules become a real limitation.

## References checked 2026-08-31

- OpenCode CLI / headless execution: <https://opencode.ai/docs/cli/>
- OpenCode permissions: <https://opencode.ai/docs/permissions/>
- OpenAI — Codex as a platform / open agent harness: <https://developers.openai.com/blog/codex-as-a-platform>
- OpenAI Agents SDK — MCP: <https://openai.github.io/openai-agents-python/mcp/>
- OpenAI Agents SDK — sandbox agents: <https://openai.github.io/openai-agents-python/sandbox/guide/>
- Claude Agent SDK overview: <https://code.claude.com/docs/en/agent-sdk/overview>
- Claude Agent SDK permissions: <https://code.claude.com/docs/en/agent-sdk/permissions>
- Claude sandboxing / Windows + WSL2: <https://code.claude.com/docs/en/sandboxing>

## Design principle

> The cloud may request work; the Legion decides what authority that request receives.

That boundary should remain true even if an MCP client, cloud account, provider agent, or task prompt is compromised.
