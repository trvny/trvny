# External Integrations

## Runtime integrations

| System | Used by | Purpose | Auth / boundary |
| --- | --- | --- | --- |
| Cloudflare Workers | Kanarek Companion, status-mcp, Pet Dispatcher control plane, Telegram assistant | public edge runtime | deployment credentials stay outside source |
| Cloudflare Queues | Pet Dispatcher, Telegram assistant | remote task delivery and durable Telegram processing | Queue API token stays local to the Legion; Worker Queue bindings need no copied token |
| Durable Objects | Kanarek Companion, Pet Dispatcher, Telegram assistant | locks, checkpoints, review jobs, task state and Telegram update idempotency | Worker bindings |
| Cloudflare KV | Kanarek Companion | learned quip bank | Worker binding `KANAREK_QUIP_KV` |
| GitHub API | Kanarek/GPTomek | repo, PR and release actions | GitHub App credentials |
| GitHub public metadata | status-mcp | read-only Feedseek health data | public reads; no GitHub write credentials |
| Cloudflare API | Kanarek operator actions | guarded account inspection and mutation | account ID + API token secrets |
| AI providers | Kanarek Companion, Pet Dispatcher, Telegram assistant | quips/reviews/operator/delegated agent execution and lightweight assistant replies | provider API keys stay centralized in Kanarek; Telegram assistant uses the private router service binding |
| Microsoft MXC / ProcessContainer | Pet Dispatcher | confined local process execution | local machine only |
| MCP | status-mcp, Pet Dispatcher | remote tool protocol | component-specific authentication/capability checks |
| Remotely Save release assets | patch verification workflow | verify patch anchors against current upstream `main.js` | read-only GitHub release download |

## Pet Dispatcher control plane

`pet-dispatcher-control` uses Queue `pet-dispatcher-tasks`, SQLite Durable Object `TaskStateStore`, `CONTROL_PLANE_TOKEN`, `TASK_SIGNING_SECRET`, and device id `legion`. The Legion polls outbound; no inbound host listener is required.

The Telegram assistant should reuse this control plane for future heavyweight Hermes handoff. Multi-worker Android/Legion routing should extend Pet Dispatcher worker identity/capability handling rather than introduce a parallel task queue/protocol.

## Telegram assistant

`travny-tg-assistant` is the lightweight always-on Telegram side. Telegram webhook updates are queued through `travny-tg-assistant-updates`; a SQLite Durable Object records `update_id` delivery state, and exhausted/ambiguous failures go to `travny-tg-assistant-updates-dlq`.

Model calls first use a same-account Service Binding to the private OpenAI-compatible router in `kanarek-companion`. That keeps OpenRouter, OrcaRouter, AIHubMix, provider cooldowns and the Workers AI provider pool in one maintained place. The assistant retains its own Workers AI binding only as an emergency fallback when the shared router is unavailable.

The assistant needs the existing `KANAREK_REVIEW_ROUTER_TOKEN`, not copies of individual provider keys. After the Worker exists, `.github/workflows/automation-sync.yml` can copy that repository-held router bearer into the assistant Worker. Telegram bot/webhook/owner secrets remain specific to the assistant Worker.

## status-mcp

The Worker reads TVPI, Weather and Autka through same-account service bindings and Feedseek through public GitHub metadata. Auth supports bearer tokens and a connector-compatible token-in-path form.

## Secrets

- Never commit Worker secrets, GitHub App private keys, provider API keys, Queue tokens or Pet Dispatcher signing material.
- Config examples contain names and non-secret defaults only.
- Kanarek strips sensitive Cloudflare values from inspection responses and uses guarded mutation checkpoints.
- status-mcp invocation logging remains disabled because its compatibility auth form can place a token in the request path.
- The Telegram assistant reuses the Kanarek router bearer instead of duplicating OpenRouter/OrcaRouter/AIHubMix credentials.
