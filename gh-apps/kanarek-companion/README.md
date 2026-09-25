# Shared automation Worker

`kanarek-companion` is the deployment/package slug for the shared Cloudflare
Worker runtime. It hosts several related subsystems so they can reuse GitHub
authentication, policy, Durable Objects, bounded network plumbing, and one
deployment without pretending every feature belongs to Kanarek.

## Runtime boundaries

Use these names in code, docs, PRs, and logs:

| Subsystem | Owns | Details |
| --- | --- | --- |
| **Kanarek Companion** | GitHub webhook handling, PR status comment, quips/reactions, review queueing/context, and review publication | This README |
| **Kanarek Review** | Private free-provider router behind `KANAREK_REVIEW_SERVICE` | [`../kanarek-review/README.md`](../kanarek-review/README.md) |
| **GPTomek Bridge** | `gptomek[bot]` identity, installation auth, control transport, and bot-authored GitHub writes | [`../gptomek/README.md`](../gptomek/README.md) |
| **Gremlin Operator** | Guarded GPT Actions, coding, maintenance, workflow, release, Cloudflare operations, and policy | [`../gremlin-operator/README.md`](../gremlin-operator/README.md) |
| **Specialist Intelligence** | Bounded package, docs, Engram, Context7, Feedseek, and similar domain lookups | [`docs/architecture.md`](docs/architecture.md) |
| **Shared runtime core** | Common auth, transport, OpenAPI, safety helpers, health/capability metadata, and Durable Object plumbing | [`docs/architecture.md`](docs/architecture.md) |

The physical Worker keeps the `kanarek-companion` slug for compatibility. When
describing the deployment as a whole, call it the **shared automation Worker** or
**shared Worker runtime**. Reserve Kanarek for the companion/review behavior,
GPTomek for bot identity/transport, and Gremlin for guarded operator behavior.

## PR flow

A normal pull-request delivery is split into two independent paths:

1. `src/index.ts` verifies the GitHub webhook signature, bounds the request body,
   applies repository scope, and routes supported events.
2. Companion activity is coalesced per PR by `CommentProbeLock` so bursts of
   review/CI/status events produce one refreshed status comment instead of
   duplicate work. GPTomek control traffic stays immediate.
3. `src/companion.ts` reads the PR, branch, checks, reviews, files, and existing
   Kanarek comment. `src/companion-view.ts` reduces that evidence to the rendered
   semantic state.
4. Review-eligible `pull_request` deliveries are queued separately in
   `WebhookReviewJob`. Each new head resets the short debounce window so stale
   queued work is replaced rather than reviewed in parallel.
5. The review job revalidates the exact open PR head/base, assembles bounded diff
   and repository context, then calls the private Kanarek Review Worker through
   the service binding.
6. Provider output is accepted only after the review contract and line anchors
   validate. The PR is revalidated again immediately before one native GitHub
   review is published.
7. Quip generation is separate from code review. It may reuse the same private
   free-provider router, but its bank, receipts, validation, and fallback policy
   remain independent.

Add the `no-goblin` label to silence Kanarek on a PR. Removing it restores the
companion and makes later review-eligible activity eligible again.

For the full routing/source map, see [`docs/architecture.md`](docs/architecture.md).
For state, replay, and mutation invariants, see
[`docs/state-and-safety.md`](docs/state-and-safety.md).

## Companion state and quips

The active phrase bank uses Workers KV under
`kanarek:companion:quip-bank:v2`.

- One active bank is scoped by normalized repository plus semantic `quipKey`.
  The complete transient PR state lives in `stateHash`; it is not a second bank
  namespace.
- Up to 256 learned quips are retained per `quipKey` and 4096 total.
- A live selection reads at most 24 entries from the current context.
- Learned entries must pass the 45-110 character and language contract. Presets
  are intentionally exempt and are not persisted.
- Every valid AI-generated quip is also copied to the append-only
  `kanarek:companion:quip-archive:v1:` namespace before GitHub mutation.
- Recovery/archive data is backup/audit data only. It becomes selectable only
  after safe migration into normal v2 bank entries.
- Retry receipts are keyed by repository, PR, semantic state, and exact head SHA
  so a GitHub failure after generation can reuse the same result instead of
  paying for another generation.

`KANAREK_AI_PERCENT` is a ceiling, not a permanent spend rate. The effective AI
percentage decreases as the current context fills what it can actually retain.
With the default ceiling of 25% and no global-cap pressure, the rough curve is
25% at 0/256 entries, 13% at 128/256, and 0% at 256/256. If the persistent bank
cannot be measured, AI generation is skipped.

The quip provider order is configured in `wrangler.jsonc`. The first slot can
delegate to the private free router; direct Gemini/OpenAI/xAI/Anthropic routes
remain request-level fallbacks for quips only. Free-provider details and secrets
live in [`../kanarek-review/README.md`](../kanarek-review/README.md).

## HTTP and runtime surface

The shared runtime exposes:

- `GET` or `HEAD /health` for deployment, companion, review, and gateway health.
- `POST /webhooks/github` for verified GitHub App deliveries.
- `GET /gpt-actions/openapi.json` for the curated operator/specialist action
  surface.
- `GET /gpt-actions/operator/capabilities` for the exact live capability
  manifest and version metadata.
- `POST /gpt-actions/operator/smoke` for a harmless authenticated end-to-end
  operator smoke test.

The OpenAI-compatible review router itself belongs to
[`kanarek-review`](../kanarek-review/README.md). The shared Worker only proxies it
through the private `KANAREK_REVIEW_SERVICE` binding.

`KANAREK_REPOSITORIES` controls status-companion scope.
`KANAREK_REVIEW_REPOSITORIES` controls review scope independently.

Safe same-repository PRs may be updated to the base branch when CI and review are
settled. The GitHub App needs `Pull requests: write` and `Contents: write`.
Set `KANAREK_UPDATE_BRANCH=false` to disable this.

## GPTomek

The shared Worker also hosts the separate
[`gptomek`](../gptomek/) GitHub App bridge for bot-authored commits, comments,
review replies, and reactions. Use the maintained Issue `trvny/trvny#203` as the
normal control mailbox. Closed PR `#176` and `gptomek/control` remain the
independent fallback transport documented in the GPTomek README.

Normal pull requests stay opened as `trvny` so external automatic review still
triggers. Do not bypass the GPTomek checkpoint/result-envelope contract or
casually clean up its fallback PR/ref.

## Where to look

### Kanarek Companion

- `src/index.ts`: webhook verification, event routing, delivery dedupe, and
  companion coalescing.
- `src/companion.ts`: companion orchestration and quip lifecycle.
- `src/companion-bank.ts`: active bank, archive, migration, retention, and AI
  fill calculations.
- `src/companion-view.ts`: semantic PR state and the single rendered status
  comment.
- `src/webhook-review.ts`: review debounce/dedupe, bounded context, stale-head
  validation, retry policy, and native review publication.
- `src/quip.ts`: presets, direct quip providers, prompt/validation contract, and
  base AI rollout.

### GPTomek Bridge

- `src/github-app.ts`: GitHub App signing and installation auth.
- `src/gptomek.ts` and `src/gptomek-issue.ts`: control mailbox parsing,
  checkpoints, and bot-authored operations.
- `src/gpt-actions.ts`: scoped GitHub read/bot gateways shared with guarded
  operator actions.

### Shared runtime and specialists

- `src/router.ts`, `src/entry.ts`, `src/runtime-entry.ts`: composition roots.
- `src/runtime-openapi.ts`: curated live OpenAPI assembly.
- `src/action-context.ts`: request-local GitHub transport/caching.
- `src/docs-actions.ts`, `src/context7-actions.ts`, `src/engram-actions.ts`,
  `src/feedseek-actions.ts`, `src/package-intelligence.ts`: bounded specialist
  adapters.
- `src/botek-specialists.ts`: narrow RPC surface for same-account Botek.
- `test/`: regression coverage across subsystem boundaries.

Gremlin source remains physically imported from this package, but its maintained
operator documentation is in
[`../gremlin-operator/README.md`](../gremlin-operator/README.md). Kanarek
Review's provider implementation and configuration are documented in
[`../kanarek-review/README.md`](../kanarek-review/README.md).

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `gh-apps/kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets and configuration

Required shared-Worker secrets:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GPTOMEK_PRIVATE_KEY` for GPTomek operations
- `KANAREK_REVIEW_ROUTER_TOKEN` for the private review-service proxy

Optional direct quip secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

Free-review provider credentials belong to the private `kanarek-review` Worker
and are listed in
[`../kanarek-review/README.md`](../kanarek-review/README.md). Gremlin-specific
deployment and operator notes live in
[`../gremlin-operator/README.md`](../gremlin-operator/README.md).

GitHub App metadata, companion/review repository scopes, quip provider controls,
AI percentage ceiling, review debounce/context limits, Durable Object bindings,
service bindings, and KV bindings are defined in `wrangler.jsonc`.
