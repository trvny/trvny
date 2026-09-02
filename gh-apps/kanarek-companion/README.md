# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion` and
maintaining the Kanarek PR status comment and free PR review.

## Mental model

A normal delivery follows this path:

1. `index.ts` verifies and routes the GitHub webhook.
2. Normal PR, review, CI, check, and status activity is coalesced into a
   ten-minute per-PR refresh window by `CommentProbeLock`. GPTomek control
   traffic stays immediate.
3. Review-eligible `pull_request` deliveries are independently queued in a
   `WebhookReviewJob` Durable Object keyed by repository and PR. Each new head
   resets a one-minute alarm, so rapid pushes replace stale queued work instead
   of starting parallel reviews.
4. The review job revalidates the exact open, same-repository PR head/base,
   reads a bounded diff plus nearby repository context, then calls the shared
   free review router in-process. The router tries only OpenRouter, OrcaRouter,
   then AIHubMix and keeps exhausted providers behind Durable Object-backed
   cooldowns.
5. Review output must be bounded Simplified-Chinese JSON with high-confidence
   findings anchored to added RIGHT-side lines. The job revalidates the PR
   again immediately before publishing one native GitHub review as the Kanarek
   App. Its prompt allows a light dry Kanarek voice while keeping serious
   findings serious.
6. Separately, `companion.ts` reads the PR, branch, CI, reviews, files, and the
   existing Kanarek status comment. `companion-view.ts` reduces that data to a
   semantic state such as `waiting`, `ready`, or `blocked` and renders the
   single status comment.
7. A 16-character `quipKey` hashes the reusable quip context: status, blocker
   kinds, primary project area, PR size, and language. `stateHash` also includes
   transient PR state and rotates selections without changing that context.
8. For live `ready`/`blocked` states, Kanarek reuses the persistent KV bank,
   optionally asks AI, or falls back to presets. The same semantic quip state
   reuses its current line instead of generating churn.
9. A valid paid AI quip first gets a cheap, short-lived retry receipt. The
   comment is then upserted, maintenance is joined, and the quip is promoted to
   the persistent bank. If the receipt write fails, bank storage is attempted
   before GitHub work so a paid result still has durable protection.

Quips and code review are separate generation flows. The quip bank, adaptive
paid-AI budget, and paid-generation receipts are not reused by free code review.

Add the `no-goblin` label to silence Kanarek on a PR. Removing it restores the
companion and makes later review-eligible PR activity eligible again.

## Endpoints

- `GET` or `HEAD /health` reports webhook, installation auth, companion lock,
  KV bank, and optional AI readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a
  delivery. Accepted PR deliveries can feed both the status companion and the
  independently scoped webhook review queue.
- `POST /review-router/v1/chat/completions` is the private OpenAI-compatible
  transport shared by free PR review. It authenticates with the dedicated
  router bearer and tries only OpenRouter, OrcaRouter, then AIHubMix.
  Paid/direct provider credentials used for quip generation are never consumed
  by the review router. OpenRouter can retry its primary model without the
  fallback array when the array itself is rejected.

`KANAREK_REPOSITORIES` controls status-companion scope.
`KANAREK_REVIEW_REPOSITORIES` controls free-review scope independently, so a
repository can receive reviews without also opting into the persistent status
comment.

PR, review, completed CI/check-suite, and commit-status events refresh the
affected pull request. A per-PR Durable Object serializes overlapping companion
deliveries and deduplicates redeliveries. Free review has its own per-PR
`WebhookReviewJob` with exact-head dedupe and stale-head/base validation.

Safe same-repository PRs may be updated to the base branch automatically when
CI and review are settled. The GitHub App needs `Pull requests: write` and
`Contents: write` for this action. Set `KANAREK_UPDATE_BRANCH=false` to disable
this.

## Quips, bank, and AI budget

The persistent phrase bank lives in Workers KV under
`kanarek:companion:quip-bank:v1` using per-entry keys.

- Up to 256 learned quips are retained per `quipKey` context and 4096 total.
- A live selection reads at most 24 entries from the current context, rotated
  by `stateHash`.
- Learned AI/pool entries must satisfy the 45–110 character contract used for
  new AI output. Presets are intentionally exempt and are never stored.
- Invalid or wrong-language learned entries encountered in a live bank window
  are removed incrementally. Cleanup is best-effort: a failed delete never
  makes already-read valid bank entries unavailable.
- Learned entries have no age TTL. Concurrent, throttled maintenance removes
  legacy expirations, rejects invalid migration candidates, and trims overflow.
- AI-generated quips are stored. Historical pool quips are promoted to KV when
  selected and missing there.
- Legacy `BANK_KEY` entries remain readable; only reusable legacy values count
  toward the current context fullness.
- Per-entry occupancy is deliberately conservative until invalid values are
  encountered and cleaned. A malformed stored key can temporarily make a
  context look fuller, which can only reduce paid AI selection, never increase
  spend.
- When AI is not selected, the order is bank/comment pool, then preset.
- When AI is selected but fails validation, Kanarek falls back to the
  bank/comment pool before presets.

`KANAREK_AI_PERCENT` is the maximum AI rollout, not a permanent spend rate.
The effective percentage decreases linearly as the current `quipKey` fills the
space it can actually retain. A missing value keeps the default `25`; an
explicit value must be a decimal integer percentage. Malformed or empty values
fail closed to `0` rather than restoring a paid default accidentally. The same
gate applies to free router fallbacks for quips: they are transport fallbacks
for selected AI attempts, not an unlimited generation path.

While the global cap is not binding, that space is 256 entries:

- 0 / 256 entries with the default `25` ceiling: 25%
- 128 / 256: 13%
- about 99% full: 1%
- 256 / 256: 0%

If many mature contexts compete for the 4096-entry global cap, the denominator
shrinks to the quota the deterministic round-robin retention would actually
keep for that context. This prevents paid AI from generating lines that pruning
would immediately reject or replace. The final partial retention pass is
ordered by `quipKey`, so quotas can differ by one slot at the boundary and an
extremely crowded bank can leave a late-sorting new context with no retainable
slot until the distribution changes.

If the persistent KV bank cannot be measured, paid AI is skipped because the
generated line could not be safely retained.

`KANAREK_PROVIDER_ORDER` reorders enabled quip providers; it does not enable or
disable them. The configured production order is Gemini, OpenAI, xAI, the
OpenAI fallback, Anthropic, then OrcaRouter and OpenRouter. The free routers are
deliberately last so request, quota, or credit failures from direct providers
can fall through to them. Provider enable switches, model names, output
ceilings, reasoning/thinking settings, the xAI prompt-cache key, and the shared
provider timeout are all visible beside it in `wrangler.jsonc`. Without
provider secrets Kanarek uses the shared pool and presets.

OpenRouter uses native ordered `models` fallback lists. Companion quips keep the
shared free model list, where MiniMax M3 remains a lightweight first choice.
Kanarek Review has a separate `KANAREK_REVIEW_OPENROUTER_MODELS` chain and a
bounded one-shot review context assembled by `webhook-review.ts`; it does not
need the former per-repository gh-aw/Copilot agent. Review prefers Nemotron 3
Ultra, Laguna S 2.1, North Mini Code, Laguna M.1, and Nemotron 3 Super before
`openrouter/free`. Quota-limited review providers stay behind a Durable
Object-backed circuit breaker so separate Worker invocations do not repeatedly
burn the same exhausted free quota. Rapid PR updates reset a one-minute Durable
Object alarm, and only the newest exact head is reviewed after the quiet window.
OrcaRouter uses `orcarouter/auto`; its allowed/default models remain controlled
by the OrcaRouter workspace, so the workspace allowlist is the source of truth.

Quip providers currently use 1024-token ceilings. Webhook review has its own
4096-token maximum because it returns a bounded structured finding set. OpenAI
reasoning for quips is configured as `auto`, preserving the model-aware
`none`/`low` heuristic; Gemini Flash-Lite uses `medium`, and xAI uses `low`.
Provider usage logs should be checked before tightening a ceiling.

Quip provider responses are accepted only after a normal completion and the
learned 45–110 character/language validation. Explicit token-limit and other
incomplete stops never enter the bank. Review output is separately validated as
JSON, Simplified Chinese, and exact diff-line anchors before GitHub mutation.

A quip request/network/HTTP failure may fall through to the next configured
provider. Once a provider returns a parsed successful HTTP response, however,
that quip AI attempt never calls another provider: unusable output falls back to
the bank/presets instead. This preserves the one-response budget boundary while
allowing request-level failover. The free review router has its own failure and
cooldown categories and may fall through the free-only provider chain.

A valid paid quip is temporarily cached by repository, pull request, semantic
`stateHash`, and exact head SHA for up to seven days. If GitHub work fails after
generation, a retry reuses that receipt instead of paying AI again. Once the
visible update and persistent-bank retention succeed, the receipt is removed.
These receipts are idempotency data and do not count toward the 256/4096
learned-bank limits.

Each real quip provider response emits a compact `kanarek_ai_generation` log
with finish reason, provider-reported output and reasoning token counts, and
final character count, but never the generated text or raw provider error
bodies. Paid persistence emits separate receipt/bank diagnostics. Use complete
response samples before tightening a ceiling.

A quip provider can be disabled without removing its secret by setting the
matching `KANAREK_OPENROUTER_ENABLED`, `KANAREK_ORCAROUTER_ENABLED`,
`KANAREK_OPENAI_ENABLED`, `KANAREK_ANTHROPIC_ENABLED`,
`KANAREK_GEMINI_ENABLED`, or `KANAREK_XAI_ENABLED` variable to a common false
value (`false`, `0`, `no`, or `off`, case-insensitive). The same false values
apply to `KANAREK_AI_ENABLED`. Webhook review has the separate
`KANAREK_WEBHOOK_REVIEW_ENABLED` switch.

## GPTomek

The same Worker hosts the separate [`gptomek`](../gptomek/) GitHub App bridge
for bot-authored commits, comments, review replies, and reactions. Commands use
the private closed `trvny/trvny#176` pull request as a control mailbox.
`gptomek/control` is only its persistent head-ref anchor: it must exist for body
edits to reach the shared webhook path, but its contents and distance behind
`main` do not participate in command handling. Do not sync or merge it.

Normal pull requests remain opened as `trvny` so external automatic review
still triggers. The bridge reuses Kanarek's existing `pull_request` webhook
delivery path, so GPTomek does not need another Worker or webhook endpoint.

## Where to look

- `src/index.ts`: webhook routing, signature validation, delivery dedupe, and
  companion event coalescing.
- `src/webhook-review.ts`: free-review queueing, debounce/dedupe, bounded
  repository context, Kanarek review prompt, stale-head validation, and native
  GitHub review publication.
- `src/review-router.ts`: free-only provider routing and persistent provider
  cooldowns shared by review transport.
- `src/companion.ts`: top-level status-companion orchestration and quip
  selection flow.
- `src/companion-view.ts`: semantic PR state, badges, project areas, and the
  rendered comment.
- `src/companion-github.ts`: GitHub reads and comment upsert operations.
- `src/companion-bank.ts`: persistent quip storage, adaptive AI budget,
  selection, migration, and pruning.
- `src/companion-paid.ts`: short-lived paid-generation retry receipts.
- `src/quip.ts`: presets, quip provider adapters, prompt contract,
  sanitization, and base AI rollout.
- `src/companion-language.ts`: lightweight PL/EN detection and validation.
- `src/companion-reactions.ts`: one semantic Kanarek reaction per PR state.
- `src/companion-update.ts`: guarded same-repository branch update logic.
- `src/gptomek.ts`: mailbox command parser and GPTomek GitHub operations.
- `test/`: regression coverage for each of the above behaviors.

When changing quip behavior, preserve the distinction between `quipKey`
(reusable context) and `stateHash` (specific PR state). When changing webhook
handling, preserve per-PR coalescing for normal companion activity, review's
separate one-minute debounce/dedupe, and immediate GPTomek control traffic.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `gh-apps/kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Gremlin Cloudflare operator

The GPT Actions gateway exposes guarded Cloudflare inventory and inspection for
Workers, Pages projects, zones, deployments, routes, DNS, and Worker
observability. Mutations are intentionally narrow: existing-version rollback,
workers.dev state, and updates to existing routes or DNS records. Mutation
calls require fresh expected IDs, state, or snapshot hashes so stale reads fail
closed. The gateway never returns Worker secret values or Pages build variables.

`automation-sync.yml` keeps Worker credential provisioning centralized. Its
manual dispatch can copy the existing repository Cloudflare credentials, the
dedicated `KANAREK_REVIEW_ROUTER_TOKEN`, the free review credentials
(AIHubMix/OpenRouter/OrcaRouter), and any repository-held direct quip credentials
(Gemini/OpenAI/Anthropic/xAI) into `kanarek-companion`, without printing secret
values. Missing direct-provider provisioning copies are left untouched on the
Worker. Legacy
per-repository review callers and provider secrets were removed during the
webhook cutover and are no longer maintained by a scheduled rollout job.

The review router uses OpenRouter with the review-specific free-model chain,
then OrcaRouter, then AIHubMix. Direct Gemini, OpenAI, Anthropic, and xAI
credentials remain quip-only. An OpenRouter HTTP 400 from the full model chain
is retried once with the primary model only. Provider-specific request
rejection, transient, quota, authentication, and availability failures fall
through to the next free provider. Terminal diagnostics expose only bounded
provider/category codes, never upstream error bodies. The review endpoint
accepts only the dedicated router bearer; provider API keys stay server-side.

## Secrets

Required Worker secrets:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GPTOMEK_PRIVATE_KEY` for GPTomek operations

Review router secret used at runtime only by the Worker:

- `KANAREK_REVIEW_ROUTER_TOKEN`

Optional free-review secrets used at runtime only by the Worker:

- `OPENROUTER_API_KEY`
- `ORCAROUTER_API_KEY`
- `AIHUBMIX_API_KEY`

`trvny/trvny` retains provisioning copies of these values solely so the manual
credential-sync workflow can update the Worker. Target repositories do not keep
review-router or provider secrets.

Optional direct AI secrets for quip generation:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

The manual credential sync copies any matching provisioning secret present in
`trvny/trvny`; an absent direct-provider copy does not delete an existing Worker
secret.

GitHub App metadata, companion/review repository scopes, provider
order/model/generation controls, AI percentage ceiling, review debounce/context
limits, Durable Object bindings, and the KV binding are defined in
`wrangler.jsonc`.
