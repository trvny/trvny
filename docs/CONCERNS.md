# Codebase Concerns

## Current risks

| Severity | Concern | Evidence | Safe handling |
| --- | --- | --- | --- |
| high | Kanarek/GPTomek can perform privileged GitHub and Cloudflare actions | `gh-apps/kanarek-companion/src/` | keep guards, expected-state checks and focused tests with every capability change |
| high | Pet Dispatcher bridges a public control plane to a trusted development machine | `mcp/pet-dispatcher/` | preserve HMAC auth, device binding, Queue credentials, workspace confinement and fail-closed recovery |
| high | Pet Dispatcher connector compatibility can place an MCP-only secret in the URL path | `mcp/pet-dispatcher/control-plane/mcp-auth.ts` | keep a separate `MCP_CONNECTOR_TOKEN`, keep invocation logs disabled, never reuse the operator token, rotate on exposure |
| medium | status-mcp accepts a token in the URL path for connector compatibility | `mcp/status-mcp/src/entry.ts` | bearer auth remains preferred; invocation logs stay disabled |
| medium | status-mcp aggregates several independent probes and can misstate partial failures if availability is collapsed into empty data | `mcp/status-mcp/src/` | keep verdict semantics covered by focused partial-failure tests |

## Fragile areas

- `gh-apps/kanarek-companion/src/` is the largest and most privileged code area. Prefer narrow changes over broad rewrites.
- `mcp/pet-dispatcher/` combines local Git state, filesystem confinement, process execution, remote delivery and recovery. Preserve the existing capability split and journal semantics.
- README language variants and repository policy files are shared navigation contracts; keep them synchronized.

## Operational gaps

- There is no root build/test command because runnable components are independent.
- Pet Dispatcher has a comprehensive package `check` and is covered by the consolidated `.github/workflows/pet-dispatcher.yml`; keep both aligned.
- There is no repository-wide coverage threshold or credential-rotation policy.
