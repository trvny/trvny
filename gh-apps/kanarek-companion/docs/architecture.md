# Shared automation runtime architecture

This document is the map for the large `src/` tree. The key idea is simple:
physical co-location does not erase subsystem boundaries.

## Composition layers

The request stack is assembled in layers:

1. `index.ts` is the Kanarek/GitHub webhook base worker.
2. `gremlin-router.ts` adds guarded operator routes and the operator OpenAPI.
3. `router.ts` composes Gremlin before the webhook base worker.
4. `entry.ts` adds specialists, capability metadata, MCP adaptation, and the
   private Kanarek Review proxy.
5. `runtime-openapi.ts` adds the larger coding/release/investigation operations
   and curates the final action surface.
6. `runtime-entry.ts` is the deployed runtime entrypoint. It decorates health and
   capabilities, schedules webhook reviews, exports Durable Object classes, and
   exposes the narrow `BotekSpecialistEntrypoint` RPC class.

`entry.ts` and `router.ts` are composition roots. New domain behavior should
live in the owning module and only be wired there.

## Runtime topology

```text
GitHub webhook
    |
    v
runtime-entry.ts
    |
    +--> index.ts --> CommentProbeLock --> companion.ts --> one status comment
    |
    +--> WebhookReviewJob --> bounded PR context
    |                         |
    |                         v
    |                   review-service.ts
    |                         |
    |                    Service Binding
    |                         |
    |                         v
    |                   kanarek-review
    |
    +--> gremlin-router.ts --> guarded GitHub/Cloudflare/operator actions
    |
    +--> specialist adapters --> docs / Context7 / Engram / packages / Feedseek

Botek (same account)
    |
    v
BotekSpecialistEntrypoint RPC
```

Cloudflare Service Bindings are used for Worker-to-Worker private calls, while
`WorkerEntrypoint` exposes the small Botek RPC surface. Durable Objects provide
per-logical-unit coordination for PR refresh/review jobs, provider cooldowns, and
operator checkpoints.

## Kanarek Companion

Primary files:

- `index.ts`: verifies `X-Hub-Signature-256`, limits webhook body size, parses
  metadata, applies repository allowlists, deduplicates deliveries, and routes
  supported events.
- `companion.ts`: orchestration for PR evidence, semantic state, comments,
  reactions, quips, branch updates, and GPTomek control.
- `companion-github.ts`: bounded GitHub reads/writes used by the companion.
- `companion-view.ts`: derives status/blockers/areas/size and renders the single
  comment.
- `companion-bank.ts`: active KV bank, archive, recovery migration, retention,
  pool rotation, and AI-fill capacity.
- `companion-language.ts`: language selection/classification and reusable quip
  rules.
- `companion-paid.ts`: retry receipts for generated quips.
- `companion-reactions.ts`: state-driven reaction synchronization.
- `companion-update.ts`: guarded branch-update eligibility.
- `quip.ts`: presets, prompt building, direct quip providers, sanitization,
  length/language checks, and base AI rollout.

The companion's reusable semantic key (`quipKey`) and exact rendered-state hash
(`stateHash`) are intentionally different. Do not merge them into one concept:
the first controls reusable bank context; the second prevents stale comment or
receipt reuse.

## Webhook review

`webhook-review.ts` is deliberately caller-side rather than part of
`kanarek-review`, because it owns GitHub state, not provider routing.

It is responsible for:

- review-eligible PR actions;
- exact-head debounce/dedupe with `WebhookReviewJob`;
- bounded diff, file, tree, nearby-code, caller, test, and dependency context;
- treating repository content as untrusted data except scoped `AGENTS.md`
  guidance;
- a strict output contract with at most eight findings;
- Simplified-Chinese human-facing review text;
- RIGHT-side added-line anchors only;
- revalidating the PR immediately before publication;
- bounded retry scheduling for provider/normalization/job failures.

`review-service.ts` translates internal router calls into the private
`KANAREK_REVIEW_SERVICE` binding. `review-service-protocol.ts` is the small shared
protocol. Provider credentials and model chains belong in
`../../kanarek-review/`.

## GPTomek Bridge

Primary files:

- `github-app.ts`: App JWT signing, installation tokens, and shared GitHub I/O.
- `gptomek.ts`: typed bot operations, checkpointed command execution, branch
  protection, and result envelopes.
- `gptomek-issue.ts`: Issue #203 control-mailbox transport and wake handling.
- `gpt-actions.ts`: scoped GitHub API surface used by operator actions.

The maintained transport documentation is in `../../gptomek/README.md`.

## Gremlin Operator

The deployable `../gremlin-operator` package imports the core from this tree.
That makes these modules the canonical implementation:

- `gremlin-router.ts`: operator route composition, OAuth wiring, OpenAPI
  assembly, and low-level route restrictions.
- `operator-actions.ts`: composed PR inspection/finalization.
- `autopilot-actions.ts` and `autopilot-checkpoint.ts`: multi-step operator
  execution and resumability.
- `policy-actions.ts`, `policy-enforcement.ts`, `policy-merge-release.ts`:
  policy model and enforcement.
- `change-actions.ts`, `code-change-orchestration.ts`, `code-history.ts`,
  `focused-code-review.ts`, `bug-investigation.ts`,
  `symbol-investigation.ts`, `dependency-graph.ts`, `test-discovery.ts`:
  bounded coding/investigation support.
- `maintenance-actions.ts`, `maintenance-account.ts`,
  `maintenance-autofix.ts`, `workflow-actions.ts`,
  `workflow-diagnosis-enhanced.ts`, `issue-actions.ts`,
  `lifecycle-actions.ts`: repository/account operations.
- `release-actions.ts`, `release-orchestration.ts`, `release-entry-action.ts`,
  `release-replace-action.ts`, `zip-entry.ts`: guarded release pipeline.
- `cloudflare-actions.ts`: bounded Cloudflare inspection and narrow mutations.

The maintained operator overview is
`../../gremlin-operator/README.md`.

## Specialist Intelligence

Specialists are intentionally narrow adapters, not arbitrary network proxies:

- `package-intelligence.ts` and `package-registry.ts`: package metadata,
  advisories, release/upstream evidence, and registry adapters.
- `docs-actions.ts`: bounded documentation lookup.
- `context7-actions.ts`: Context7 bridge.
- `engram-actions.ts`: Engram memory bridge.
- `feedseek-actions.ts`: bounded Feedseek access.
- `agents-guidance*.ts`: repository instruction/guidance lookup.
- `account-attention.ts`: bounded attention summaries.
- `mcp-adapter.ts`: curated MCP surface for specialists.
- `botek-specialists.ts`: same-account RPC adapter exposing only the Botek
  operations that are intentionally shared.

New artifact/feed/web inspection should start here if it is primarily a bounded
read/intelligence feature. Split into another Worker only when permissions,
secrets, resource limits, deploy cadence, or independent consumers materially
justify it.

## Shared core

Files with intentionally cross-subsystem responsibility include:

- `action-context.ts`: request-local GitHub transport and caching.
- `conflict-response.ts`: normalized stale/conflict evidence.
- `git-tree.ts`: common tree helpers.
- `review-thread-pagination.ts`: shared review-thread traversal.
- `runtime-entry.ts`: deployed composition and exported runtime classes.
- `runtime-openapi.ts`: final action-surface assembly.
- `auth.ts`: small auth helpers.

Avoid adding product-specific behavior here merely because several subsystems
need access to it.

## Adding a feature

Choose the owner first:

- PR presentation, quips, webhook state: Companion.
- free model routing/cooldowns: Kanarek Review.
- bot identity/transport: GPTomek.
- repository/workflow/release/Cloudflare mutation: Gremlin.
- bounded package/docs/memory/feed lookup: Specialist Intelligence.

Then:

1. put domain logic in that boundary;
2. reuse shared transport/safety helpers instead of creating a parallel client;
3. wire the route/export in the nearest composition root;
4. add regression tests near the owning behavior;
5. keep secrets in the narrowest Worker that actually needs them;
6. update the owning README/doc, not every README that happens to mention the
   subsystem.
