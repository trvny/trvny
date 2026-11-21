# External Integrations

## Runtime integrations

| System | Used by | Purpose | Auth / boundary |
| --- | --- | --- | --- |
| Cloudflare Workers | Kanarek Companion, status-mcp, Pet Dispatcher control plane, Telegram assistant | public edge runtime | deployment credentials stay outside source |
| Cloudflare Queues | Pet Dispatcher, Telegram assistant | remote task delivery and durable Telegram processing | Queue API token stays local to the Legion; Worker Queue bindings need no copied token |
| Durable Objects | Kanarek Companion, Pet Dispatcher, Telegram assistant | locks, checkpoints, review jobs, task state, Telegram update idempotency and bounded chat context | Worker bindings |
| Cloudflare KV | Kanarek Companion | learned quip bank | Worker binding `KANAREK_QUIP_KV` |
| GitHub API | Kanarek/GPTomek | repo, PR and release actions | GitHub App credentials |
| GitHub public metadata | status-mcp | read-only Feedseek health data | public reads; no GitHub write credentials |
| Cloudflare API | Kanarek operator actions | guarded account inspection and mutation | account ID + API token secrets |
| AI providers | Kanarek Companion, Pet Dispatcher, Telegram assistant | quips/reviews/operator/delegated agent execution and lightweight assistant replies | provider API keys stay centralized in Kanarek; Telegram assistant uses the private router service binding |
| Microsoft MXC / ProcessContainer | Pet Dispatcher | confined local process execution | local machine only |
| MCP | status-mcp, Pet Dispatcher | remote tool protocol | component-specific authentication/capability checks |
| Remotely Save release assets | patch verification workflow | verify patch anchors against current upstream `main.js` | read-only GitHub release download |

## Pet Dispatcher control plane

`pet-dispatcher-control` uses Queue `pet-dispatcher-tasks`, SQLite Durable Object `TaskStateStore`, `CONTROL_PLANE_TOKEN`, `TASK_SIGNING_SECRET`, and device id `legion`. Private connector URL auth mirrors repository secret `PET_DISPATCHER_MCP_CONNECTOR_TOKEN` into Worker secret `MCP_CONNECTOR_TOKEN` through the shared `.github/scripts/sync-cloudflare-worker-secret.sh` helper; both the deploy workflow and central `Sync Worker credentials` workflow use that same path. The Legion polls outbound; no inbound host listener is required.

The Telegram assistant reuses this control plane for heavyweight Legion/Hermes handoff: manual `/task` delegation and conservative owner-only repo-work auto-routing create ordinary Pet Dispatcher tasks, then Botek watches their durable state and pushes terminal results back to Telegram. Multi-worker Android/Legion routing remains a later extension of Pet Dispatcher worker identity/capability handling rather than a parallel task queue/protocol.

## Telegram assistant

`tg-assistant` is the lightweight always-on Telegram side. Telegram webhook updates are queued through `travny-tg-assistant-updates`; one SQLite Durable Object records `update_id` delivery state, a second stores bounded per-chat conversation context, and exhausted/ambiguous failures go to `travny-tg-assistant-updates-dlq`.

Model calls first use a same-account Service Binding to the private OpenAI-compatible router in `kanarek-companion`. That keeps OpenRouter, OrcaRouter, AIHubMix and provider cooldowns in one maintained place. Workers AI remains disabled in Kanarek Review and SpaceMolt; the local Telegram binding uses the account neuron allocation for voice, vision and emergency fallback.

The assistant needs the existing `KANAREK_REVIEW_ROUTER_TOKEN`, not copies of individual provider keys. `.github/workflows/automation-sync.yml` mirrors that repository-held router bearer into the deployed `tg-assistant` Worker; use the same target after credential rotation or Worker recreation. Telegram bot/webhook/owner secrets remain specific to the assistant Worker.

## status-mcp

The Worker reads TVPI, Weather and Autka through same-account service bindings and Feedseek through public GitHub metadata. Auth supports bearer tokens and a connector-compatible token-in-path form.

## Secrets

- Never commit Worker secrets, GitHub App private keys, provider API keys, Queue tokens or Pet Dispatcher signing material.
- Config examples contain names and non-secret defaults only.
- Kanarek strips sensitive Cloudflare values from inspection responses and uses guarded mutation checkpoints.
- status-mcp invocation logging remains disabled because its compatibility auth form can place a token in the request path.
- The Telegram assistant reuses the Kanarek router bearer instead of duplicating OpenRouter/OrcaRouter/AIHubMix credentials.
- Pet Dispatcher connector URL auth uses a dedicated MCP-only secret; the operator control-plane bearer is never copied into the connector URL.

## Google Cloud opportunities (proposal, 2026-11-21)

Exploration only; no deployment or migration authorized. Keep Cloudflare as the public
edge and GitHub as the maintained source. Prefer new, bounded workloads over
migrating working Workers/D1/R2. Two existing Google projects: one without billing,
one with billing; inspect exact eligibility, quota and project settings before use.

| Candidate | Purpose | Likely Google components | First experiment |
| --- | --- | --- | --- |
| Search Observatory | SEO/AEO/GEO checks across bartek.lol and subdomains; historical crawl and Search Console index states | Search Console API, URL Inspection API, Cloud Run Jobs, BigQuery | Diagnose rss.bartek.lol vs trvny.github.io/feedseek/ canonical/sitemap/robots conflicts; compare HTTP observations with Google's selected canonical |
| Web Radar | Domain/technology discovery, change detection, new tools/APIs outside RSS | Cloud Run Jobs, Firestore, Pub/Sub | Small allowlisted domain set; bounded fetches; deduplicated changes |
| Media Intelligence Lab | OCR, image metadata, similarity and batch processing as reusable API | Cloud Vision, Cloud Run | Process representative images; benchmark cost and limits |
| Link Inspector | Bounded URL reputation, redirect chains, TLS/headers diagnostics | Web Risk, Cloud Run | Verify URLs against Web Risk; never present checks as guaranteed safety |
| Code Lab | Containerized tests, package compatibility, benchmark runs | Cloud Build, Cloud Run Jobs | Run one isolated benchmark; keep GitHub Actions as default CI |
| Data Observatory | Trends and historical analytics for projects and external signals | BigQuery, Cloud Storage | Import small append-only samples and measure query cost |

### Search Observatory MVP

1. HTTP checks: final URL/status, robots.txt and X-Robots-Tag, HTML robots,
   canonical, sitemap entries, redirects, favicon fetch, structured data.
2. Authorized Google Search Console: URL Inspection index status, Google-selected
   canonical, last crawl and coverage. Requires access to each verified
   Search Console property; the bartek.lol property cannot inspect the separate
   trvny.github.io host. Stored index state is **not** live URL testing;
   distinguish provenance and timestamps.
3. Persist minimal per-URL daily snapshots in Firestore from the first run;
   Cloud Run Jobs have no durable local state between executions. Produce diffs
   with actionable findings (source URL, affected page, maintained repo path).
   No automatic source modification or duplicate site.
4. Start with rss.bartek.lol and its GitHub Pages origin; then bartek.lol and
   selected subdomains. Observe traffic before expanding storage or queues.

### Deployment and cost guardrails

- Billing-enabled project: Cloud Run Jobs with scale-to-zero, bounded concurrency,
  timeouts, retries, CPU/memory limits and per-service spend caps where supported.
  Budget alerts alone are **not** hard caps. Even spend caps may leave in-flight
  or pre-enforcement charges; unsupported services/networking need independent
  limits and monitoring. Measure networking egress separately.
- Billing-free project: only compatible APIs / Firebase options actually available
  without billing; do not equate it with Google's restricted Starter Tier.
- Free quotas vary by region and product. US-only Compute Engine e2-micro and
  Cloud Storage allocations are not substitutes for unlimited EU hosting.
- Use federated or attached identity, least privilege, no exported service-account
  keys in GitHub. Store one canonical configuration; do not duplicate Cloudflare
  data or move feed IDs/URLs casually.
- Reassess after one week of real measurements, not guesses about free capacity.

References: [Cloud Free Tier](https://docs.cloud.google.com/free/docs/free-cloud-features),
[URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect),
[Spend Caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).
