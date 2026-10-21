# Shared automation runtime architecture

This document is the map for the large `src/` tree. The key idea is simple:
physical co-location does not erase subsystem boundaries.

## Worker identity and staged rename

**Target Cloudflare Worker name:** `automation`. **Current production Worker:** `kanarek-companion`.
The target is an infrastructure name, not a rename of the Kanarek Companion
or GPTomek GitHub Apps. Keep their app IDs, slugs, installation permissions,
identities, and domain-specific storage keys unchanged. The checkout/package
path `gh-apps/kanarek-companion/` remains the maintained source while the
infrastructure name is migrated; do not combine this with a directory move.

### Migration gates (one logical PR and verification per gate)

1. **Inventory and baseline only.** Record live Worker name, deployments,
   secret *names* (never values), GitHub webhook URLs, OAuth/callback users,
   external callers, cron triggers, Service Bindings, KV namespace IDs,
   Durable Object namespace IDs/classes, pending alarms and wake routes.
   Capture a healthy `/health`, capability manifest, GPTomek smoke, PR
   status/review smoke and quip-bank baseline. Confirm `automation` is unused.
2. **Prepare compatibility.** Update naming in documentation and optional
   display metadata without switching the deployed service. Any new
   URL/alias must first coexist with the old endpoint; do not redirect
   signed webhooks or OAuth callbacks blindly. No DO binding changes.
3. **Prove state continuity before any production transfer.** Determine
   the supported identity-rename or cross-Worker transfer mechanism; changing
   Wrangler `name` alone creates another Worker. Preserve all five live SQLite
   namespaces (`CommentProbeLock`, `OperatorCheckpointStore`,
   `ReviewProviderCooldownStore`, `WebhookReviewJob`,
   `AnchorMutationReplayStore`), their IDs, contents and alarms. Before
   cross-Worker transfer, migrate the source's legacy `migrations` to
   `exports` in its own validated deploy; this config transition is one-way.
   In a separately controlled transfer window, follow Cloudflare's order:
   deploy the target with `expecting-transfer` exports but no self-referencing
   DO bindings; then deploy `transferred` tombstones on the source to commit
   namespace ownership. Verify the existing namespace IDs are now owned by
   `automation`. **Before the legacy Worker continues serving callbacks**,
   redeploy its five DO bindings with `script_name: automation` so existing
   routes still reach the transferred state; only after the source rollout,
   deploy target-local DO bindings. Handle brief transfer-time unavailability
   explicitly; do not claim atomic end-to-end routing. Keep source and target
   class exports/rollback constraints consistent with Cloudflare's guide.
   Preserve `KANAREK_QUIP_KV` ID and bank/archive/receipt keys throughout.
   Never create replacement namespaces or delete tombstones as cleanup.
4. **Switch clients only after ownership and both Workers are verified.**
   Repoint Gremlin, Kanarek Review and Pet Dispatcher's service/DO bindings,
   plus any other RPC consumers, **after** the committed namespace transfer,
   source rebinding, target binding and verified state continuity. Update
   GitHub Actions (GPTomek wake and fallback, credential sync, CI/live smoke),
   Worker Builds, service-to-service URLs, direct HTTP callers and GitHub App
   webhook URLs in separately validated changes. Both endpoints must remain
   usable during this compatibility window, including DO-backed operations.
5. **Cut over with a rollback gate.** Make the new endpoint authoritative
   only after complete state/secret/binding verification. Test GPTomek
   issue-command execution + replay guard, Gremlin signer, Kanarek PR
   status and review, provider cooldowns, quips and their saved bank, Botek
   RPC, health and CI. Record exact deployment versions. Roll back code
   or routing only when safe; DO namespace lifecycle changes are *not*
   undone by ordinary Worker version rollback.
6. **Retire compatibility last.** Keep `kanarek-companion` available
   until all known consumers have moved and outstanding callbacks, jobs,
   alarms and checkpoints are accounted for. Remove old endpoints or
   configs in a separate, audited change, never as incidental cleanup.

**Stop condition:** Missing credentials, unknown DO ownership/data continuity,
failed live checks, unverified webhook migration, or no safe rollback plan.
Do not execute the production rename until these gates are explicitly met.

References: [Cloudflare Durable Object class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[GPTomek control transport](../../gptomek/docs/REFERENCE.md).


## Composition layers

`runtime.ts` is the single composition root. Requests pass ordered route
segments, outermost first; each route returns a `Response` or `null`
(`route.ts` `firstMatch`), and a segment's `below` reaches only later segments:

1. `runtimeRoutes` (`runtime.ts`): coding/release/investigation operations;
   unmatched requests get health/capability/smoke decoration, webhook review
   scheduling and conflict enrichment on the way out.
2. `gatewayRoutes` (`entry.ts`): specialists, capability metadata, smoke, MCP
   adaptation and the private Kanarek Review proxy.
3. `operatorRoutes` (`gremlin-router.ts`): guarded operator actions and the
   `/gpt-actions/**` catch-all.
4. `index.ts`: Kanarek/GitHub webhook base worker, GPTomek wake, terminal 404.

`runtime-openapi.ts` curates the final action surface. `runtime-entry.ts` is the
deployed entrypoint: it exports Durable Object classes and the narrow
`BotekSpecialistEntrypoint` and `GptomekSignerEntrypoint` RPC classes. The signer
mints GPTomek App JWTs for `gremlin`, so the GPTomek PEM stays in this Worker;
any Worker bound to it holds full GPTomek App authority.

New domain behavior lives in the owning module and is only wired into a route
table; shared ingress paths live in `paths.ts`.

## Source layout

`src/` root holds only composition (`runtime*.ts`, `entry.ts`, `index.ts`,
`route.ts`, `paths.ts`, `custom-gpt-surface.ts`) and the shared core below.
Domain code lives in one folder per owner:

- `companion/`: Kanarek Companion, quips, webhook review.
- `gptomek/`: GPTomek Bridge, GitHub gateway, GPT Actions routes.
- `operator/`: Gremlin operator, policy, change, maintenance, release, Cloudflare.
- `investigation/`: read-only code investigation and review lenses.
- `specialists/`: Specialist Intelligence adapters, MCP, Anchor; `tools/` holds
  the specialist registry plus shared `tools/common.ts`.

`test/import-cycles.test.ts` fails on any runtime import cycle in `src/`.

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

Gremlin (same account)
    |
    v
GptomekSignerEntrypoint RPC (GPTomek App JWT)
```

Cloudflare Service Bindings are used for Worker-to-Worker private calls, while
`WorkerEntrypoint` exposes the small Botek RPC surface. Durable Objects provide
per-logical-unit coordination for PR refresh/review jobs, provider cooldowns, and
operator checkpoints.

## Kanarek Companion

Primary files (`src/companion/`, except root `index.ts`):

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

Files in `src/companion/`.

`webhook-review.ts` is deliberately caller-side rather than part of
`kanarek-review`, because it owns GitHub state, not provider routing. Context
gathering lives in `webhook-review-context.ts` and finding verification/judges in
`webhook-review-judge.ts`; neither imports back from `webhook-review.ts`.

It is responsible for:

- review-eligible PR actions;
- exact-head debounce/dedupe with `WebhookReviewJob`;
- bounded diff, file, tree, nearby-code, caller, test, and dependency context;
- compact free review and expanded paid escalation run in separate Durable Object
  alarm invocations so the heavier pass receives a fresh Cloudflare subrequest
  budget instead of sharing the first pass's GitHub/API calls;
- treating repository content as untrusted data except scoped `AGENTS.md`
  guidance;
- a strict output contract with at most eight findings;
- Simplified-Chinese human-facing review text;
- RIGHT-side added-line anchors only;
- revalidating the PR immediately before publication;
- an L2 precision pass on the free review only: a rotating System One pool (AIHubMix Decision, OpenRouter Decisions with Mercury → Span-01 Lite, QwenCloud Decision, Vercel Laya Free) gets a short experimental total budget for typed validity/duplicate decisions, then the existing generative judge gets its normal independent pass; if both L2 layers fail, verified L1 findings publish unchanged; the paid pass skips L2;
- bounded retry scheduling for provider/job failures; findings that fail
  verification escalate to paid once and are never retried.

`review-service.ts` translates internal router calls into the private
`KANAREK_REVIEW_SERVICE` binding. `../../core/review-service-protocol.ts` is the
small shared protocol. Provider credentials and model chains belong in
`../../kanarek-review/`.

## GPTomek Bridge

Primary files (`src/gptomek/`; `github-app.ts` is `../../core/`):

- `github-app.ts`: App JWT signing, installation tokens, and shared GitHub I/O.
- `gptomek.ts`: typed bot operations, checkpointed command execution, branch
  protection, and result envelopes.
- `gptomek-issue.ts`: Issue #203 control-mailbox transport and wake handling.
- `github-gateway.ts`: scoped GitHub read/bot/GraphQL access; modules call
  `githubGateway`, `gpt-actions.ts` exposes the same policy as HTTP routes.
  Every module needing GitHub (incl. operator auth in `action-auth.ts`, MCP,
  specialist actions, capability/smoke) takes a `GithubGateway` built in
  `runtime.ts`/`entry.ts`; `below` stays only for composing other internal actions.
  Tests adapt route-shaped fixtures via `test/support/loopback-gateway.ts`.

The maintained transport documentation is in `../../gptomek/docs/REFERENCE.md`.

## Gremlin

The deployable `../gremlin` package imports the core from this tree. Operator
modules live in `src/operator/`, investigation helpers in `src/investigation/`.
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
`../../gremlin/README.md`.

## Specialist Intelligence

Specialists (`src/specialists/`) are intentionally narrow adapters, not arbitrary
network proxies:

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

Files with intentionally cross-subsystem responsibility (`src/` root) include:

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
