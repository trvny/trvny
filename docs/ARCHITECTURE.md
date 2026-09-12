# Architecture

`trvny/trvny` is a mixed repository of small independent tools and services. There is no shared application runtime at the root.

## Runtime components

```text
GitHub webhook / GPT action
  -> gh-apps/kanarek-companion
  -> guarded GitHub / Cloudflare / AI capabilities

MCP request
  -> mcp/status-mcp
  -> service bindings + public GitHub reads
  -> compact health roll-up

Remote task / direct tool call
  -> mcp/pet-dispatcher/control-plane
  -> Queue + Durable Object task state
  -> outbound-only Legion poller
  -> workspace-confined local session / MXC process sandbox
```

## Boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| `gh-apps/kanarek-companion/` | Kanarek Companion, GPTomek identity, review/operator/release actions | unguarded privileged mutations |
| `mcp/status-mcp/` | authenticated read-only health aggregation | mutations of monitored projects |
| `mcp/pet-dispatcher/src/` | local workspace confinement, Git sessions, provider/tool execution | unrestricted host-shell access |
| `mcp/pet-dispatcher/control-plane/` | authenticated remote task state, Queue delivery, direct tool sessions | local filesystem authority |
| `loopling/` | generated ChatGPT/Codex pet assets and installers | runtime service state |
| `.ai/` | AI configuration core, overlays and reference material | application runtime code |

## Design rules

- Privileged paths fail closed and keep expected-state/idempotency checks close to the mutation.
- Cloudflare Workers own transport, authentication and coordination; local machine authority stays in Pet Dispatcher.
- Remote Pet Dispatcher traffic is outbound-only from the Legion. The public Worker does not expose a host shell.
- Package boundaries are deliberate. Each runnable component owns its manifest, config and validation commands.
- Generated artifacts keep a maintained source nearby: Loopling uses `tools/generate.py`; the Quarto report uses its `.qmd`; status-mcp generates its connector icon from `assets/status-mcp.svg`.
