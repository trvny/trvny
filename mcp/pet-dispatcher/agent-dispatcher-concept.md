# Agent Dispatcher MCP — concept

Status: **planning / no runtime yet**

## Goal

A small, provider-agnostic MCP side project that lets a remote assistant delegate bounded development tasks to a trusted worker on the Legion laptop.

The worker should prefer the cheapest available execution path:

1. deterministic local tools (`git`, `gh`, Gradle, ADB, npm, Python, etc.),
2. free/cheap OpenCode providers,
3. Antigravity when installed,
4. Codex when installed,
5. future adapters without changing the MCP surface.

The cloud side coordinates work. Provider credentials and actual code execution stay on the Legion.

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
  |-- direct tools
  |-- OpenCode
  |-- Antigravity (later)
  `-- Codex (later)
        |
        v
isolated task workspace
        |
        v
structured result + diff + tests + commit
```

The transport must be replaceable. Cloudflare, GCP, AWS or another provider can implement the same broker interface.

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
  "repo": "trvny/feedseek",
  "goal": "Diagnose and fix failing tests",
  "budget": "free",
  "capabilities": ["git", "tests"],
  "timeout_minutes": 20,
  "network": "restricted",
  "result": ["summary", "diff", "tests", "commit"]
}
```

The local policy engine converts this into concrete allowed actions. Text from an LLM is never itself authority to expand permissions.

## Local execution model

### Direct tools first

Do not spend an LLM request on deterministic work.

Examples:

- build requested -> run the relevant build command first;
- GitHub metadata requested -> use `gh`;
- Android diagnostics -> Gradle/ADB;
- formatting/lint -> repository-native commands.

Escalate to an agent only when reasoning or code changes are actually needed.

### Resource budget

The Legion currently has limited RAM, so default to:

- concurrency: **1 active agent task**;
- bounded CPU/runtime;
- no resident model processes unless useful;
- no duplicate full clones when a worktree is enough.

### Git workspace lifecycle

Avoid branch/worktree graveyards.

1. create a detached temporary worktree under one worker-owned root;
2. run the task;
3. test;
4. if successful, preserve the commit and optionally publish a short-lived remote branch/PR;
5. remove the worktree immediately;
6. run `git worktree prune`;
7. watchdog removes stale worker-owned workspaces.

The dispatcher may delete **only resources it created under its own workspace root**.

## Provider routing

Adapters implement a common interface:

```text
probe()
run(task)
cancel(task)
collect_result()
```

Initial routing idea:

```text
deterministic tool
    -> OpenCode/free provider
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

Where practical, execute untrusted agent commands in a stronger sandbox (WSL/container/Windows Sandbox). Hardware-dependent tools such as ADB can use narrowly scoped host-side helpers.

### Secrets

- Store secrets locally using Windows Credential Manager/DPAPI or provider-native secure stores.
- Never put long-lived secrets in task payloads, logs, Git history or the cloud queue.
- Prefer GitHub App / short-lived installation tokens over broad PATs.
- Scope every cloud credential to the exact queue/function/resource it needs.
- Redact logs before returning them remotely.

### Egress

Where practical, allow only required destinations for each adapter. A coding agent should not automatically gain arbitrary network access just because it can execute a command.

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
- commands/actions performed,
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
4. worker claims task;
5. worker executes with the minimum capability set;
6. worker publishes structured result;
7. worker cleans its workspace;
8. optionally hibernate after a configurable idle window.

The cloud should not be able to force hibernation or arbitrary power operations except through explicitly defined, local-policy-controlled capabilities.

## Implementation phases

### Phase 0 — design

- keep this document as source of truth;
- settle task/result schemas;
- threat model;
- transport abstraction.

### Phase 1 — local MVP

- worker daemon/CLI;
- direct tool adapter;
- OpenCode adapter;
- one-task concurrency;
- workspace lifecycle + cleanup watchdog;
- structured JSON result.

No remote access yet.

### Phase 2 — remote control plane

- MCP `delegate/status/result/cancel/capabilities`;
- queue transport;
- strong auth;
- signed/replay-protected task envelopes;
- audit log.

### Phase 3 — wake

- test S4 WoL on the Legion;
- choose router/relay;
- implement restricted `wake` path;
- worker auto-resume/check-in.

### Phase 4 — more agents

- Antigravity adapter;
- Codex/App Server adapter;
- optional additional OpenCode providers.

### Phase 5 — smarter routing

- quota awareness;
- task/provider success metrics;
- free-tier fallback;
- optional review/repair loop.

## Non-goals

- General remote desktop replacement.
- Public shell access.
- Giving cloud services administrator access to the laptop.
- Keeping many permanent clones/worktrees around.
- Allowing one provider to become the source of truth for task policy.
- Reverse-engineering private Codex Cloud APIs.

## Design principle

> The cloud may request work; the Legion decides what authority that request receives.

That boundary should remain true even if an MCP client, cloud account, provider agent, or task prompt is compromised.
