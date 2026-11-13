# Kanarek Review

[![GitHub Apps CI](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/gh-apps-ci.yml) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white&style=flat-square)](https://developers.cloudflare.com/workers/)

> **Agent entry:** Private review provider Worker; only Companion calls it through a Service Binding.
> **Validate:** `cd gh-apps/kanarek-review && npm ci && npm run check`.
> **Boundary:** owns routing/model ordering and cooldowns, **not** GitHub review publication (Companion owns that).

`kanarek-review` is the private review-provider Worker used by the shared
`kanarek-companion` runtime. It owns provider credentials, routing, cooldowns,
and model fallback. The normal pool is free-first, including Gemini Standard when
the project is unbilled, with optional paid DeepSeek reserves. It does **not** own
GitHub webhook handling, PR context collection, review publication, status
comments, or quip-bank semantics.

Keeping this boundary separate means the provider credential set and deploy
cadence can evolve without turning the shared automation Worker into a bag of
provider secrets.

## Who owns what

| Concern | Owner | Main knobs |
| --- | --- | --- |
| PR status quips | `kanarek-companion` | `../kanarek-companion/wrangler.jsonc` |
| PR review policy/context | `kanarek-companion` | `KANAREK_WEBHOOK_REVIEW_*` |
| Free/paid model routing | `kanarek-review` | this `wrangler.jsonc` |
| Shitpost generation contract | Shitpost Reactor Action | `../shitpost-reactor/limits.mjs` |
| Shitpost provider choice | `kanarek-shitpost-free` task policy | this Worker |

Quips, reviews, and shitposts are clients of one routing layer rather than
separate provider stacks. Quips can also use their direct provider slots; the
shared `free-router` slot, PR reviews, and Shitpost Reactor all converge on
`kanarek-review`. Paid reserves are available only to the review/work synthetic
contracts, never to `kanarek-review-free`.

Gemini uses Google's native stable `v1/interactions` endpoint with explicit
thinking level. The unbilled Standard route is in the free pool; Flex is an optional
paid mode only when `KANAREK_REVIEW_GEMINI_SERVICE_TIER=flex`. The router translates its existing
OpenAI-compatible text/tool contract to Interactions steps and converts Gemini
model output/function-call steps back to the same OpenAI-compatible response
shape, so callers do not need a second protocol. Gemini requests are stateless
(`store: false`) and send the API key through `x-goog-api-key`. Tool-call
responses carry private Kanarek replay metadata so subsequent Gemini turns can
resend model-generated thought/signature steps exactly as required; that metadata
is stripped before requests reach any other provider. Gemini Interactions is
intentionally non-streaming: a streaming request skips it rather than receiving
a fake or incompatible stream.

## Grok paid-review settings

`wrangler.jsonc` owns the paid Grok provider's `KANAREK_REVIEW_XAI_MODEL`
(default `grok-4.7`) and `KANAREK_REVIEW_XAI_REASONING_EFFORT`
(`low`, `medium`, `high`, or `xhigh`; default `high`).

Paid review requests get their initial output budget from
`../kanarek-companion/wrangler.jsonc` via
`KANAREK_WEBHOOK_REVIEW_PAID_MAX_OUTPUT_TOKENS` (currently `65536`,
accepted 512–65536). Grok uses that requested budget directly, bounded by
its adapter's 8192-token floor and 131072-token ceiling.
Other paid providers may override the request: DeepSeek uses
`KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS` (currently `131072`).

The independent Grok Actions reviewer was retired. The existing
`KANAREK_XAI_MAX_OUTPUT_TOKENS` on the companion config is for **quip**
generation, not review. The API key stays bound to the automation Worker;
the router invokes its private `XAI_REVIEW_RPC` service binding.
The model is selected by the private router. The automation RPC is not
an HTTP endpoint; it accepts the validated Grok model name from that trusted
binding, without mirroring another provider-model allowlist.

## How it is called

The public GitHub webhook lands in `kanarek-companion`. Review-eligible PRs are
debounced and contextualized by `../kanarek-companion/src/companion/webhook-review.ts`,
then sent to this Worker through the same-account `KANAREK_REVIEW_SERVICE`
Service Binding.

The shared runtime also uses the same private router as the first free slot for
quip generation. Review and quips share only provider routing/cooldowns. Their
prompts, validation, persistence, and retry semantics remain separate.

The internal OpenAI-compatible surface is:

- `POST /review-router/v1/chat/completions`
- `POST /review-router/v1/systemone` for the private rotating System One L2 pool
- `GET /review-router/v1/models`
- `GET` or `HEAD /health`

It exposes task contracts over one shared provider inventory. The legacy
`kanarek-review-free` stays as the backward-compatible general free lane for
Telegram, lightweight Pet Dispatcher work, and other existing callers.
`kanarek-quip-free`, `kanarek-code-review-free`, `kanarek-judge-free`, and
`kanarek-shitpost-free` reuse those same credentials and cooldowns but choose
different provider/model order and reasoning settings. `kanarek-review`
preserves the combined free-first review contract, `kanarek-review-paid` is the
paid-only review escalation path, and `kanarek-work-paid` is the paid
agent-work contract used by Pet Dispatcher for explicit multi-step work.

`x-kanarek-review-exclude-provider` takes one provider id or a comma-separated
list. The companion uses it to sweep the free pool one provider at a time when a
provider answers with unusable review output, and escalates to
`kanarek-review-paid` only after that sweep is exhausted.

Non-streaming free, combined, paid-review and paid-work calls reject HTTP 200 responses
that contain no assistant text, refusal, or tool call. This prevents a paid
DeepSeek JSON-mode whitespace response from being treated as successful and
allows the next eligible provider to run. Valid tool calls with null content
remain accepted only with valid function-call shapes; streamed calls preserve their existing pass-through behavior.

Free PR reviews request up to 65,536 output tokens by default. This is an
upstream generation budget, not a post-generation length filter; known model
output/context ceilings still take precedence, and Groq's separate free TPM
allowance requires a smaller, sometimes partial review. Paid review headroom
stays independent. Invalid free completions log `finishReason` and token usage
metadata (never response text), making token exhaustion distinguishable from
wrong-language or malformed JSON. Clean reviews (`no_findings`) are recorded
without posting a GitHub comment; absence of a comment is not a provider failure.

`workers_dev` and preview URLs are disabled. The shared Worker adds an internal
trust header/bearer before invoking the service binding; callers do not receive
provider credentials.

## Provider chain

Production provider and model order is maintained **only** in
[`wrangler.jsonc`](wrangler.jsonc), under the `KANAREK_REVIEW_ROUTING`
JSON binding. The code defines supported provider IDs, API adapters, and
per-model safety limits, but no second queue or model catalog to append.

- `providerOrders.general` is the general free lane; `quip`, `review`,
  `judge` and `shitpost` override it for their respective tasks.
- `taskModels.<provider>.<task>` contains the exact models to try for that
  task. A missing task entry inherits `taskModels.<provider>.general`.
- `decisionModels` is a separate, free decision-only System One pool.
- `KANAREK_REVIEW_PAID_PROVIDER_ORDER` controls the paid review queue,
  which runs only after the free review phase or when explicitly requested.

The router tries providers and models in listed order. Omitting a provider or
model means **do not try it**. No hidden defaults, extra providers, or model
pools are appended. Duplicates and unknown provider IDs are ignored.
Legacy model/order env variables are accepted only for callers without a
corresponding structured task/general list; production no longer sets
duplicated global model lists.

Provider and individual model cooldowns can skip unavailable entries without
reordering other entries. The API key for each provider is a Worker secret.
The optional `workers-ai` entry follows the same explicit ordering if enabled.
Production keeps Workers AI disabled to preserve the shared account's neuron
budget for SpaceMolt; no Workers AI route is present in production queues.

The private System One routeThe private System One route is intentionally separate from the OpenAI-compatible
chat router. It forwards at most 16 typed `choice` / `noul` / `score`
questions through a rotating decision-only pool:

1. AIHubMix `decision-model-preview`, then `mammoth-1-free` (27B) and `elephant-1-free` (9B), both with 16K context
2. OpenRouter Decisions: `inception/mercury-decide:free`, then free fallbacks `baseten/mammoth-1:free` (27B, 16K context), `baseten/elephant-1:free` (9B), `respan/span-01-lite:free`
3. QwenCloud `decision-model-preview`
4. Vercel AI Gateway `convaiinnovations/laya-free` through its TypeSafe-compatible System One API

The primary provider is rotated deterministically from the review state so all
four access paths receive real traffic while they are free; the remaining
configured providers are fallbacks. AIHubMix uses `/v1/systemone`; its decision
models never enter the chat pool.
OpenRouter uses its native `/api/alpha/decisions` runtime and tries Mercury,
Mammoth, Elephant, then Span-01 Lite before abandoning OpenRouter.
Answers must match each requested question type and criteria, with finite
probabilities in `0..1`. Free model IDs may resolve to versioned response IDs.
Vercel uses the promotional `laya-free` model ID so the
route stops serving when the free promotion ends instead of silently becoming
billable. Each decision provider keeps an independent short-lived cooldown. The experimental decision pool has its own 25-second total budget so
it cannot consume the normal generative judge's time. If the entire decision
pool fails, Kanarek Companion still gives the existing generative L2 judge its
normal pass; if that judge also fails, verified L1 findings are published
unchanged. Paid review skips L2 because its larger context can exceed the
decision runtimes' input windows.

Latency is task policy too. Quips keep short deadlines; judges get 60 s per
provider. Free code review uses one rule for every provider: a 180-second
provider budget, and a 120-second cap per model while another model of that
provider remains (the last model gets the rest). Review sends **one request per
configured model**, never a hidden upstream `models` chain. Paid review
providers (Grok, DeepSeek) get 300 s each. Kanarek Companion bounds the whole
free sweep, the paid pass and L2 by its 15-minute alarm wall time.

Free first, then paid: Companion sweeps the free queue (each provider excluded
after an unusable answer; a clean verdict needs two free providers), and only
an exhausted free sweep or rejected findings escalate to `kanarek-review-paid`.
The paid pass makes one router call: the paid queue fails over on HTTP errors,
but anything billed is final and never retried — an unusable answer
(`invalid_output`/`invalid_findings`, also when the router discarded it or the
provider timed out mid-generation; the router names it in
`x-kanarek-review-billed-provider`) or a failed GitHub publication
(`publish_failed`). Only a paid pass where no provider answered retries with
backoff.

The router moves to the next listed model/provider on unusable responses,
request rejections, quota exhaustion, authentication failures, or upstream
unavailability. It never tries an omitted provider. The live `/health`
payload lists the effective general and task queues in
`providerPool.freeOrder` and `providerPool.taskOrders`, but its readiness
signal reflects configuration/cooldowns rather than a guaranteed successful
inference. Paid providers follow their own explicitly configured order.

Vercel AI Gateway is intentionally classifiedVercel AI Gateway is intentionally classified as `monthly-free-credit`. The
account-level $5/month spend cap is the guardrail, so both zero-price models and
models consuming that included monthly allowance are part of the free budget.
The cap stays enforced at Vercel instead of being duplicated here.

Reasoning is capability-aware rather than provider-wide. Review, judge, and
shitpost lanes give known reasoning-capable Vercel and OpenRouter models high
reasoning with at least 16K completion-token headroom. Heterogeneous OpenRouter
fallback chains do not inherit that optional field.
Groq task lanes keep their task-specific effort and receive the same floor
whenever reasoning is enabled; large Groq requests are conservatively fitted to
the model context window before dispatch and skipped if the 16K reasoning floor
cannot fit.
AIHubMix and OrcaRouter pinned models carry per-model profiles
(`*_MODEL_PROFILES` in `src/review-router.ts`, from the providers' model
catalogs): context window (oversized payloads skip to the next model), output
ceiling, the 16K floor for models that think by default, and `reasoning_effort`
snapped to the model's accepted levels (low for quips, configured effort for
reasoning lanes). Models without an effort list never get the field; unknown
models pass through unchanged.
Gemini Flex pins high reasoning with the same floor and strips deprecated
sampling, thinking-budget, and candidate-count fields inherited from shared
OpenAI-compatible callers. DeepSeek keeps its separate high-effort 128K contract. The dormant Workers AI fallback is configured for 16K output
headroom, but production keeps it disabled while the account neuron budget belongs to SpaceMolt.

Vercel AI Gateway uses a model chain rather than one fixed model. Hy3
(`tencent/hy3`), Qwen 3.8 Omni, Ling 3.1 Flash, and Laguna S 2.1 receive the
shared reasoning policy when used by a reasoning-heavy task. Hy3 alone keeps
Tencent's recommended `temperature: 0.9` / `top_p: 1.0` sampling overrides.
Qwen 3 Coder does not receive synthetic reasoning fields and its requests are
clamped to its 8K output limit. Known lower per-model output ceilings are applied
before dispatch, while callers asking for a larger supported ceiling keep it.

OrcaRouter calls named free models only (`deepseek/deepseek-v4.1-flash-free`,
`z-ai/glm-5.3-flash-free`, `tencent/hy4-preview-free`, `tencent/hy3-free`); the
`orcarouter/auto` and `orcarouter/free` routes were unreliable and are not used. Per-model cooldowns skip a model that
rotates out until it recovers. Spend limits and routing policy
must remain enforced in OrcaRouter itself.

DeepSeek uses the official OpenAI-compatible endpoint with `deepseek-flash`.
Both paid contracts enable high-effort thinking with a 128K generation ceiling;
paid review allows 300 s per request.
The review contract additionally forces JSON output and uses the expanded
review context profile; the work contract deliberately does not force JSON so
native tool calls remain available and allows a longer model-turn timeout.
Both are kept out of `kanarek-review-free`, so lightweight callers cannot spend
the user's DeepSeek balance. HTTP 402 balance exhaustion enters the normal quota
cooldown/fallback path.

Gemini uses the native Interactions endpoint. When
`KANAREK_REVIEW_GEMINI_SERVICE_TIER=standard`, the request omits `service_tier`
(Standard is Google's default), joins the free pool and caps output at 8K tokens.
The `gemini-flex` paid fallback is omitted in this mode to avoid retrying the
same unbilled key after free attempts.
Reactor candidates use `thinking_level: medium` with the existing 8K free-tier output ceiling; judges and review tasks keep their configured reasoning level. Provider keys stay in the shared private router. Switching this setting back to `flex`
restores the old paid reserve instead; neither mode overrides the project's
actual Google billing status. Quota 429s continue through shared cooldowns.

Quota-limited providers use `KANAREK_REVIEW_COOLDOWNS`, a Durable Object hosted
by the shared `automation` Worker. A cooldown is intentionally not a
health verdict: free quota, capacity, authentication, and transient failures are
expected operational states and only suppress repeated calls for a bounded
period. Deterministic request-shape/context incompatibilities are handled by
admission/fallback policy instead of long-lived provider state.

Cooldowns escalate: a failure after the previous cooldown expired doubles the
base (quota 10 min, out-of-credit `http_402`/`http_403_billing_cap` 30 min,
transient 30 s) up to 6 h; failures during an active cooldown count once. A
success clears the strikes; they also age out after 12 h without failures.
Multi-model providers (OpenRouter, AIHubMix, Vercel) keep the same per-model
state (`<provider>#<model>`): a model that fails while its provider moves on is
skipped next time, so one dead or flaky model never cools down the provider.
Fallback-chain attempts blame no single model.

When enabled, the Workers AI fallback uses a guarded daily-neuron budget. It is currently
disabled in production so SpaceMolt has exclusive use of the account allocation. Provider
health is exposed in `/health` without leaking upstream response bodies or credentials.

## Review contract versus provider routing

This Worker does not decide whether a PR should be reviewed or whether a finding
is publishable.

`../kanarek-companion/src/companion/webhook-review.ts` owns:

- repository and PR eligibility;
- one-minute-by-default debounce and exact-head dedupe;
- bounded diff/repository/dependency context;
- stale head/base revalidation;
- the Simplified-Chinese JSON review contract;
- finding count, path, and RIGHT-side line-anchor validation;
- final PR revalidation and native GitHub review publication;
- bounded retry scheduling when providers fail or output cannot be normalized.

Provider routing here returns a completion plus provider metadata. The caller
remains responsible for deciding whether that completion can mutate GitHub.

## Configuration

`wrangler.jsonc` defines the Worker, version metadata, provider model defaults,
the dormant Workers AI settings, cooldown binding, and observability. The Worker has no
Workers AI binding while that allocation is reserved for SpaceMolt.

Important variables include:

- `KANAREK_REVIEW_ROUTER_TIMEOUT_MS`
- `KANAREK_REVIEW_DECISION_TIMEOUT_MS`
- `KANAREK_REVIEW_QUOTA_COOLDOWN_MS`
- `KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS`
- `KANAREK_REVIEW_WORKERS_AI_ENABLED`
- `KANAREK_REVIEW_WORKERS_AI_DAILY_NEURONS`
- `KANAREK_REVIEW_WORKERS_AI_MODEL`
- `KANAREK_REVIEW_WORKERS_AI_MAX_OUTPUT_TOKENS`
- `KANAREK_REVIEW_AIHUBMIX_MODELS`
- `KANAREK_REVIEW_OPENROUTER_MODELS`
- `KANAREK_REVIEW_ORCAROUTER_MODELS`
- `KANAREK_REVIEW_OLLAMA_MODELS`
- `KANAREK_REVIEW_GROQ_MODEL`
- `KANAREK_REVIEW_GROQ_REASONING_EFFORT`
- `KANAREK_REVIEW_VERCEL_MODELS`
- `KANAREK_REVIEW_REASONING_MIN_MAX_TOKENS`
- `KANAREK_REVIEW_REASONING_EFFORT`
- `KANAREK_REVIEW_VERCEL_HY3_TEMPERATURE`
- `KANAREK_REVIEW_VERCEL_HY3_TOP_P`
- `KANAREK_REVIEW_HUGGINGFACE_MODEL`
- `KANAREK_REVIEW_PAID_PROVIDER_ORDER`
- `KANAREK_REVIEW_DEEPSEEK_MODEL`
- `KANAREK_REVIEW_DEEPSEEK_THINKING`
- `KANAREK_REVIEW_DEEPSEEK_REASONING_EFFORT`
- `KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS`
- `KANAREK_REVIEW_GEMINI_MODEL`
- `KANAREK_REVIEW_GEMINI_SERVICE_TIER`
- `KANAREK_REVIEW_GEMINI_THINKING_LEVEL`
- `KANAREK_REVIEW_WORK_TIMEOUT_MS`

The shared runtime independently controls whether webhook review is enabled,
which repositories are eligible, debounce/context/output limits, and whether its
calls may use Workers AI.

## Secrets

Provider credentials belong here:

- `AIHUBMIX_API_KEY`
- `OPENROUTER_API_KEY`
- `QWEN_API_KEY` (optional QwenCloud Decision path)
- `OLLAMA_API_KEY`
- `GROQ_API_KEY`
- `AI_GATEWAY_API_KEY`
- `ORCAROUTER_API_KEY`
- `HUGGINGFACE_API_KEY`
- `DEEPSEEK_API_KEY` (optional direct paid PR-review reserve)
- `GEMINI_API_KEY` (free Standard if billing is disabled; paid Flex only when explicitly configured)

The shared runtime keeps only `KANAREK_REVIEW_ROUTER_TOKEN` for its private
proxy contract. The Gemini key is centralized in this private router as well as
being available to the companion's direct quip route; OpenAI/Anthropic/xAI
credentials remain quip-only.

Repository copies of provider secrets, when present, exist only for the manual
credential-sync workflow. Target repositories do not need provider credentials.

## Source map

- `src/index.ts`: health surface and trusted service-binding request adaptation.
- `src/review-router.ts`: provider definitions, model chains, error
  categorization, cooldown handling, health, and completion routing.
- `test/`: provider routing, fallback, cooldown, and protocol regression tests.
- `../kanarek-companion/src/companion/review-service.ts`: caller-side Service Binding
  adapter.
- `../core/review-service-protocol.ts`: internal paths, trust headers, and
  health types.
- `../core/review-cooldown-store.ts`: shared Durable Object implementation used
  by this Worker.
- `../core/auth.ts`: shared bearer check.

## Build

From this directory:

```sh
npm run check
npm run deploy
```

Workers Builds should use `gh-apps/kanarek-review` as the root directory and
watch `gh-apps/kanarek-review/**` plus `gh-apps/core/**`.

## Operator routing settings

Edit [`wrangler.jsonc`](wrangler.jsonc). The single
`KANAREK_REVIEW_ROUTING` binding holds all free queues:

- `providerOrders`: `general`, `quip`, `review`, `judge`, `shitpost`.
  Each list is exact and ordered. Missing task lists inherit `general`.
- `taskModels`: per-provider `general` model list and exact task-specific
  lists for providers that vary by task. Missing tasks inherit `general`.
- `decisionModels`: independent decision model queue per provider.

Omitted entries are **not** automatically appended. To add a provider/model
to a task, put it in that task's list. Keep Workers AI absent unless deliberately
enabled with its binding, model and neuron budget. Provider API credentials
are secrets, never routing variables.

`KANAREK_REVIEW_PAID_PROVIDER_ORDER` stays a separate top-level setting
for the paid escalation queue. Other top-level variables configure timeouts,
cooldowns, reasoning and provider-specific API behavior, **not duplicate
model-order lists**. For legacy callers with no structured route, the router
accepts the old env settings without modifying the production configuration.

The grouped JSON object counts as one Worker binding and leaves room for
provider secrets under Workers Free plan limits. Tests validate the actual
Wrangler values rather than duplicating their inventories in TypeScript.
