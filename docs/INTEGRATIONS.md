# External Integrations

## Runtime integrations

| System | Used by | Purpose | Auth / boundary |
| --- | --- | --- | --- |
| Cloudflare Workers | Kanarek Companion, status-mcp, Pet Dispatcher control plane | public edge runtime | deployment credentials stay outside source |
| Cloudflare Queues | Pet Dispatcher | remote task delivery to the Legion poller | Queue API token stays local to the Legion |
| Durable Objects | Kanarek Companion, Pet Dispatcher | locks, checkpoints, review jobs and task state | Worker bindings |
| Cloudflare KV | Kanarek Companion | learned quip bank | Worker binding `KANAREK_QUIP_KV` |
| GitHub API | Kanarek/GPTomek | repo, PR and release actions | GitHub App credentials |
| GitHub public metadata | status-mcp | read-only Feedseek health data | public reads; no GitHub write credentials |
| Cloudflare API | Kanarek operator actions | guarded account inspection and mutation | account ID + API token secrets |
| AI providers | Kanarek Companion, Pet Dispatcher | quips/reviews/operator or delegated agent execution | provider API keys in runtime environment |
| Microsoft MXC / ProcessContainer | Pet Dispatcher | confined local process execution | local machine only |
| MCP | status-mcp, Pet Dispatcher | remote tool protocol | component-specific authentication/capability checks |
| Remotely Save release assets | patch verification workflow | verify patch anchors against current upstream `main.js` | read-only GitHub release download |

## Pet Dispatcher control plane

`pet-dispatcher-control` uses Queue `pet-dispatcher-tasks`, SQLite Durable Object `TaskStateStore`, `CONTROL_PLANE_TOKEN`, `TASK_SIGNING_SECRET`, and device id `legion`. The Legion polls outbound; no inbound host listener is required.

## status-mcp

The Worker reads TVPI, Weather and Autka through same-account service bindings and Feedseek through public GitHub metadata. Auth supports bearer tokens and a connector-compatible token-in-path form.

## Secrets

- Never commit Worker secrets, GitHub App private keys, provider API keys, Queue tokens or Pet Dispatcher signing material.
- Config examples contain names and non-secret defaults only.
- Kanarek strips sensitive Cloudflare values from inspection responses and uses guarded mutation checkpoints.
- status-mcp invocation logging remains disabled because its compatibility auth form can place a token in the request path.
