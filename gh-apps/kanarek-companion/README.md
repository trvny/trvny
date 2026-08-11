# Kanarek companion Worker

Cloudflare Worker receiving GitHub App webhooks for `kanarek-companion` and
maintaining the Kanarek PR status comment.

## Mental model

A normal delivery follows this path:

1. `index.ts` verifies and routes the GitHub webhook.
2. Noisy CI/check/status events are coalesced per PR by `CommentProbeLock`.
   Direct PR/review changes stay immediate.
3. `companion.ts` reads the PR, branch, CI, review, files, and existing Kanarek
   comment.
4. `companion-view.ts` reduces that data to a semantic state such as `waiting`,
   `ready`, or `blocked`, then renders the single status comment.
5. A 16-character `quipKey` hashes the reusable quip context: status, blocker
   kinds, primary project area, PR size, and language. `stateHash` also includes
   transient PR state and rotates selections without changing that context.
6. For live `ready`/`blocked` states, Kanarek reuses the persistent KV bank,
   optionally asks AI, or falls back to presets. The same semantic quip state
   reuses its current line instead of generating churn.
7. The comment is upserted and the PR reaction is synchronized. New reusable
   AI/pool quips are persisted after the visible update.

Add the `no-goblin` label to silence Kanarek on a PR. Removing it restores the
companion.

## Endpoints

- `GET` or `HEAD /health` reports webhook, installation auth, companion lock,
  KV bank, and optional AI readiness.
- `POST /webhooks/github` verifies `X-Hub-Signature-256` before accepting a
  delivery.

PR, review, completed CI/check-suite, and commit-status events refresh the
affected pull request. A per-PR Durable Object serializes overlapping
deliveries and deduplicates redeliveries.

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
- Learned entries have no age TTL. Incremental maintenance removes legacy
  expirations and trims overflow.
- AI-generated quips are stored. Historical pool quips are promoted to KV when
  selected and missing there. Presets are never stored.
- Legacy `BANK_KEY` entries remain readable and count toward bank fullness.
- When AI is not selected, the order is bank/comment pool, then preset.
- When AI is selected but fails or returns the wrong language, Kanarek falls
  back to the bank/comment pool before presets.

`KANAREK_AI_PERCENT` is the maximum AI rollout, not a permanent spend rate.
The effective percentage decreases linearly as the current `quipKey` fills the
space it can actually retain.

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

Provider order and defaults are OpenAI (`gpt-5.6-luna`, then
`gpt-5.4-nano`), Anthropic, Gemini, and xAI. Without provider secrets Kanarek
uses the shared pool and presets.

Output ceilings intentionally stay generous: 128 tokens for the default
non-reasoning OpenAI models and Anthropic, and 256 for Gemini, reasoning
OpenAI models, and xAI. Gemini Flash-Lite is pinned to `minimal` thinking.
Provider responses are accepted only after a normal
completion; explicit token-limit or other incomplete stops are discarded and
never enter the bank. Each real provider response emits a compact
`kanarek_ai_generation` log with finish reason, provider-reported output and
reasoning token counts, and final character count, but never the generated
text. Use those complete-response samples before tightening a ceiling.

A provider can be disabled without removing its secret by setting the matching
`KANAREK_OPENAI_ENABLED`, `KANAREK_ANTHROPIC_ENABLED`,
`KANAREK_GEMINI_ENABLED`, or `KANAREK_XAI_ENABLED` variable to `false`.

## GPTomek

The same Worker hosts the separate [`gptomek`](../gptomek/) GitHub App bridge
for bot-authored commits, comments, review replies, and reactions. Commands use
the private `trvny/trvny#176` pull request as a branchless control mailbox.
Edits to that PR are handled even after it is closed or merged. Normal pull
requests remain opened as `trvny` so external automatic review still triggers.

The bridge reuses Kanarek's existing `pull_request` webhook delivery path, so
GPTomek does not need another Worker or webhook endpoint.

## Where to look

- `src/index.ts`: webhook routing, delivery dedupe, and CI coalescing.
- `src/companion.ts`: top-level orchestration and quip selection flow.
- `src/companion-view.ts`: semantic PR state, badges, project areas, and the
  rendered comment.
- `src/companion-github.ts`: GitHub reads and comment upsert operations.
- `src/companion-bank.ts`: persistent quip storage, adaptive AI budget,
  selection, migration, and pruning.
- `src/quip.ts`: presets, provider adapters, prompt contract, sanitization, and
  base AI rollout.
- `src/companion-language.ts`: lightweight PL/EN detection and validation.
- `src/companion-reactions.ts`: one semantic Kanarek reaction per PR state.
- `src/companion-update.ts`: guarded same-repository branch update logic.
- `src/gptomek.ts`: mailbox command parser and GPTomek GitHub operations.
- `test/`: regression coverage for each of the above behaviors.

When changing quip behavior, preserve the distinction between `quipKey`
(reusable context) and `stateHash` (specific PR state). When changing webhook
handling, keep noisy CI events coalesced and direct PR/review events immediate.

## Cloudflare Workers Builds

Connect `trvny/trvny` with:

- production branch: `main`
- root directory: `gh-apps/kanarek-companion`
- build command: `npm run check`
- deploy command: `npm run deploy`

GitHub Actions validates the project but does not deploy it.

## Secrets

Required Worker secrets:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GPTOMEK_PRIVATE_KEY` for GPTomek operations

Optional AI secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

GitHub App metadata, model defaults, AI percentage ceiling, and the KV binding
are defined in `wrangler.jsonc`.
