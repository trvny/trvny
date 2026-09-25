# State, replay, and mutation invariants

The shared runtime performs remote side effects, so most of its complexity is
there to avoid duplicate work, stale-state writes, accidental spend, and
cross-subsystem privilege creep. These invariants are more important than any
single route name.

## Webhooks and PR coordination

`index.ts` and its Durable Objects must preserve:

- HMAC verification before a GitHub delivery is accepted;
- bounded request bodies;
- repository allowlists;
- supported event/action filtering;
- delivery dedupe;
- per-PR companion coalescing for normal review/CI/status churn;
- immediate GPTomek control handling.

Companion coalescing and code-review scheduling are separate mechanisms.
Changing one must not silently change the timing or dedupe behavior of the
other.

## Review job invariants

`WebhookReviewJob` treats the queued PR head/base as evidence, not a promise.

Before provider work and again before publication, the job re-checks that the
PR is still open and still refers to the expected repository/head/base. New
pushes replace stale queued work by resetting the debounce alarm.

Context is intentionally bounded. A missing caller, dependency, test, or file
outside the supplied context is unknown, not proof of absence.

Review text can mutate GitHub only after:

- provider completion is parseable;
- output matches the expected JSON shape;
- finding count stays within the hard limit;
- every finding references an allowed changed path;
- every finding anchors to an added RIGHT-side line;
- the PR still matches the expected target immediately before submit.

This is why provider routing lives separately from review publication.

## Quip bank invariants

The active learned bank is
`kanarek:companion:quip-bank:v2`.

Keep these concepts separate:

- `quipKey`: reusable semantic context, repository-scoped;
- `stateHash`: exact transient PR/comment state;
- archive: append-only recovery/audit copy;
- receipt: short-lived idempotency record for an AI result;
- preset: built-in fallback that is never stored.

A generated quip is archived before GitHub mutation. If receipt persistence
fails, active-bank persistence is attempted before GitHub work so a paid result
still has durable protection.

Do not reset the system by bumping/clearing the active bank namespace. Schema
changes must preserve or explicitly migrate learned data.

AI selection is capped by `KANAREK_AI_PERCENT` and decays as the retainable
context fills. If bank occupancy cannot be measured, generation fails closed and
the companion falls back to retained/preset text. Archive occupancy never
changes the AI percentage.

## Provider boundaries

Kanarek Review owns free-provider credentials and cooldowns. The shared Worker
talks to it over `KANAREK_REVIEW_SERVICE`.

Review and quip requests may share the provider pool, but they must not share:

- prompt contracts;
- output validators;
- quip bank/archive/receipts;
- review line-anchor validation;
- review publication state.

Direct Gemini/OpenAI/xAI/Anthropic credentials are quip-only fallbacks. They are
not a hidden reserve for free PR review.

Provider error diagnostics must remain bounded and must not log secret values or
raw upstream bodies that may contain sensitive data.

## GPTomek command replay

GPTomek commands carry caller-supplied IDs. The command input is hashed and
checkpointed.

Required behavior:

- same ID + same input can be safely replayed;
- same ID + different input is rejected;
- comments/review replies carry hidden command markers so replay checks can
  verify bot-authored side effects;
- expected head SHA is required where branch state can move;
- ambiguous remote outcomes fail closed as `command_outcome_uncertain` instead
  of blindly repeating a mutation;
- Issue #203 is the maintained primary mailbox;
- closed PR #176 and `gptomek/control` remain the documented fallback until an
  explicit retirement change removes them.

Do not bypass GPTomek's typed command/checkpoint/result-envelope path with a
parallel bot-write mechanism.

## Operator checkpoints

`OperatorCheckpointStore` backs resumable Gremlin operations.

A checkpoint records:

- `operationId`;
- stable input hash;
- `running`, `paused`, `complete`, or `uncertain` state;
- lease expiry;
- bounded progress;
- bounded final result.

A live lease returns an in-progress response rather than starting another copy.
A completed operation returns the stored result. A stale/incomplete lease can
enter controlled recovery. Input-hash mismatch is rejected.

The store has bounded result/progress sizes and seven-day retention. Keep
operation IDs stable across retries/failover for the same logical operation.

## Guarded GitHub mutations

Low-level GitHub access exists to support the operator, not to provide a general
admin tunnel.

`gpt-actions.ts` and `gremlin-router.ts` enforce repository/path/method
allowlists and route sensitive families toward guarded high-level operations.

Examples:

- file/ref writes should use commit/branch helpers rather than arbitrary raw
  REST requests;
- workflow control should use the workflow operation;
- release writes should use release orchestration;
- protected/default branches and `gptomek/control` cannot be casually deleted;
- PR finalization re-inspects CI, review state, unresolved threads, and expected
  head/base evidence.

Where GitHub lacks an atomic expected-SHA precondition, narrow races still exist.
The code should reduce that window and fail closed when evidence moves rather
than pretend the mutation is transactional.

## Policy and maintenance budgets

Gremlin maintenance is policy-driven and bounded.

Hard repository/action ceilings remain defense-in-depth even when a repository
policy asks for more. Autofix, workflow retries, cache cleanup, and lifecycle
actions should route through `policy-enforcement.ts` rather than duplicating
policy logic in each caller.

A policy file can narrow behavior. It must not expand a hard-coded security
boundary beyond what the runtime allows.

## Cloudflare mutations

`cloudflare-actions.ts` is an operator adapter, not an unrestricted Cloudflare
API proxy.

Reads may cover inventory and observability needed for diagnosis. Mutations are
narrow and should require fresh expected identifiers/state/snapshot hashes.
Existing-version rollback, workers.dev state changes, route changes, and DNS
updates must fail closed on stale evidence.

Never return Worker secret values or Pages build variables.

## Composition and privilege

`entry.ts`, `router.ts`, and `runtime-entry.ts` should remain mostly wiring.
Putting domain mutation logic directly into a composition root makes it too easy
to bypass the guard that the owning subsystem already maintains.

When two subsystems need the same helper, extract transport/evidence code only.
Do not merge their policy or state machines just because they share a Worker.

A subsystem should become a separate Worker when it needs materially different
secrets/permissions, exposure, resource limits, deploy cadence, or independent
consumers. `kanarek-review` is the current example: it owns provider credentials
while the shared runtime keeps GitHub state and publication.
