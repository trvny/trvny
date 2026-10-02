# Kanarek Review

`kanarek-review` is the private review-provider Worker used by the shared
`kanarek-companion` runtime. It owns provider credentials, routing, cooldowns,
and model fallback. The normal pool is free-first, with optional paid DeepSeek
and Gemini Flex reserves. It does **not** own GitHub webhook handling, PR context
collection, review publication, status comments, or quip-bank semantics.

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

## How it is called

The public GitHub webhook lands in `kanarek-companion`. Review-eligible PRs are
debounced and contextualized by `../kanarek-companion/src/webhook-review.ts`,
then sent to this Worker through the same-account `KANAREK_REVIEW_SERVICE`
Service Binding.

The shared runtime also uses the same private router as the first free slot for
quip generation. Review and quips share only provider routing/cooldowns. Their
prompts, validation, persistence, and retry semantics remain separate.

The internal OpenAI-compatible surface is:

- `POST /review-router/v1/chat/completions`
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

`workers_dev` and preview URLs are disabled. The shared Worker adds an internal
trust header/bearer before invoking the service binding; callers do not receive
provider credentials.

## Provider chain

The provider inventory and task policy are separate concerns.
`KANAREK_REVIEW_PROVIDER_ORDER` remains the operator-controlled order for the
legacy/general free lane. Quip, code-review, judge, and shitpost lanes use
maintained task-specific preferences while sharing the same keys, cooldowns and
quota state. `/health` exposes the legacy `freeOrder`, all effective
`taskOrders`, and a coarse budget class for each provider.

AIHubMix uses one configured pool rather than one pinned model:
`xiaomi-mimo-v2.6-flash-free`, `coding-kimi-k3-free`,
`dots-3-note-preview-free`, `nemotron-3.5-lightning-free`, `hy3-free`, and
`minimax-m2.7-free`. Code review prefers coding/reasoning models, quips prefer
fast general models, the judge prefers a diverse second opinion, and shitposts
prefer the more general/creative end of the same pool. Retryable model failures
fall through inside AIHubMix before abandoning the provider.

AIHubMix and OrcaRouter use the shorter
`KANAREK_REVIEW_FREE_PROBE_TIMEOUT_MS` (10 seconds by default), so an
unresponsive early free provider cannot hold the whole review queue for the
full 30-second general router timeout. Unknown names and duplicates are ignored,
and omitted known providers are appended in the default order, matching the
quip provider-order behavior. Guarded Workers AI remains the explicit final free fallback because it has its
own daily neuron budget and cooldown policy. `@cf/zai-org/glm-4.7-flash`
remains the default emergency model: it supports reasoning and tool use while
consuming substantially fewer neurons than `@cf/qwen/qwen3.8-27b`, preserving
more of the 10k-neuron daily reserve for actual failures upstream.
The live `/health` payload exposes the effective free queue as
`providerPool.freeOrder`.

The router falls through on request rejection, transient failures, quota
exhaustion, authentication errors, or provider unavailability. Current
families are:

1. AIHubMix
2. OpenRouter
3. Ollama Cloud
4. Groq
5. Vercel AI Gateway
6. OrcaRouter
7. Hugging Face Inference Providers pinned to Public AI
8. DeepSeek V4.1 Flash through the direct DeepSeek API, only for the
   `kanarek-review` PR-review contract when `DEEPSEEK_API_KEY` is configured
9. Gemini 3.8 Flash through the paid Flex tier, only for the `kanarek-review`
   PR-review contract when `GEMINI_API_KEY` is configured
10. guarded Cloudflare Workers AI as the final fallback

Model lists and per-provider settings live in `wrangler.jsonc`. OpenRouter's
official `openrouter/free` model can be used directly and lets OpenRouter choose
a compatible free model automatically. The configured explicit `:free` models
are therefore a quality/order policy rather than a technical requirement;
`openrouter/free` remains the catch-all fallback. OpenRouter may retry its
primary model without a fallback array when the provider rejects the array itself.

Vercel AI Gateway is intentionally classified as `monthly-free-credit`. The
account-level $5/month spend cap is the guardrail, so both zero-price models and
models consuming that included monthly allowance are part of the free budget.
The cap stays enforced at Vercel instead of being duplicated here.

Vercel AI Gateway uses a model chain rather than one fixed model. Hy3 (`tencent/hy3`)
is tried first with high reasoning, Tencent's recommended `temperature: 0.9` /
`top_p: 1.0`, and an 8192-token minimum generation ceiling so reasoning does not
starve short-capped callers. A caller that already asks for more keeps its larger
ceiling. The previous `alibaba/qwen3-coder-30b-a3b` route remains the model fallback,
without inheriting Hy3-specific reasoning or sampling fields.

OrcaRouter is configured through the workspace-owned `orcarouter/auto` route
rather than pinned model aliases. The OrcaRouter workspace is the maintained
source of truth for which current free models that route should prefer, so model
rotation does not require a repository change. Spend limits and routing policy
must remain enforced in OrcaRouter itself.

DeepSeek uses the official OpenAI-compatible endpoint with `deepseek-flash`.
Both paid contracts enable max-effort thinking with a 128K generation ceiling.
The review contract additionally forces JSON output and uses the expanded
review context profile; the work contract deliberately does not force JSON so
native tool calls remain available and allows a longer model-turn timeout.
Both are kept out of `kanarek-review-free`, so lightweight callers cannot spend
the user's DeepSeek balance. HTTP 402 balance exhaustion enters the normal quota
cooldown/fallback path.

Gemini uses the OpenAI-compatible Gemini endpoint with
`service_tier: "flex"`. Flex is a paid, lower-cost, sheddable tier: 429/503
responses enter the same cooldown/fallback path as other transient provider
failures. It is deliberately excluded from `kanarek-review-free`, so shared
free-router consumers cannot spend the Gemini reserve.

Quota-limited providers use `KANAREK_REVIEW_COOLDOWNS`, a Durable Object hosted
by the shared `kanarek-companion` Worker. Cooldowns survive separate Worker
invocations, so a temporarily exhausted free provider is not hammered again on
every PR event.

The Workers AI fallback also uses a guarded daily-neuron budget. Provider health
is exposed in `/health` without leaking upstream response bodies or credentials.

## Review contract versus provider routing

This Worker does not decide whether a PR should be reviewed or whether a finding
is publishable.

`../kanarek-companion/src/webhook-review.ts` owns:

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
Workers AI binding, cooldown binding, and observability.

Important variables include:

- `KANAREK_REVIEW_ROUTER_TIMEOUT_MS`
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
- `KANAREK_REVIEW_VERCEL_HY3_MIN_MAX_TOKENS`
- `KANAREK_REVIEW_VERCEL_HY3_REASONING_EFFORT`
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
- `KANAREK_REVIEW_WORK_TIMEOUT_MS`

The shared runtime independently controls whether webhook review is enabled,
which repositories are eligible, debounce/context/output limits, and whether its
calls may use Workers AI.

## Secrets

Provider credentials belong here:

- `AIHUBMIX_API_KEY`
- `OPENROUTER_API_KEY`
- `OLLAMA_API_KEY`
- `GROQ_API_KEY`
- `AI_GATEWAY_API_KEY`
- `ORCAROUTER_API_KEY`
- `HUGGINGFACE_API_KEY`
- `DEEPSEEK_API_KEY` (optional direct paid PR-review reserve)
- `GEMINI_API_KEY` (optional paid Flex reserve)

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
- `../kanarek-companion/src/review-service.ts`: caller-side Service Binding
  adapter.
- `../kanarek-companion/src/review-service-protocol.ts`: internal paths,
  trust headers, and health types.
- `../kanarek-companion/src/review-cooldown-store.ts`: shared Durable Object
  implementation used by this Worker.

## Build

From this directory:

```sh
npm run check
npm run deploy
```

Workers Builds should use `gh-apps/kanarek-review` as the root directory.
