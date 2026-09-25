# Kanarek Review

`kanarek-review` is the private free-provider Worker used by the shared
`kanarek-companion` runtime. It owns provider credentials, routing, cooldowns,
and model fallback. It does **not** own GitHub webhook handling, PR context
collection, review publication, status comments, or quip-bank semantics.

Keeping this boundary separate means the free-provider credential set and deploy
cadence can evolve without turning the shared automation Worker into a bag of
provider secrets.

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

`workers_dev` and preview URLs are disabled. The shared Worker adds an internal
trust header/bearer before invoking the service binding; callers do not receive
provider credentials.

## Provider chain

The router prefers the stronger configured free routes first and falls through
on request rejection, transient failures, quota exhaustion, authentication
errors, or provider unavailability. Current families are:

1. AIHubMix
2. OpenRouter
3. Ollama Cloud
4. Groq
5. Vercel AI Gateway
6. OrcaRouter
7. Hugging Face Inference Providers pinned to Public AI
8. guarded Cloudflare Workers AI as the final fallback

Model lists and per-provider settings live in `wrangler.jsonc`. OpenRouter may
retry its primary model without a fallback array when the provider rejects the
array itself.

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
- `KANAREK_REVIEW_OPENROUTER_MODELS`
- `KANAREK_REVIEW_ORCAROUTER_MODELS`
- `KANAREK_REVIEW_OLLAMA_MODELS`
- `KANAREK_REVIEW_GROQ_MODEL`
- `KANAREK_REVIEW_VERCEL_MODEL`
- `KANAREK_REVIEW_HUGGINGFACE_MODEL`

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

The shared runtime keeps only `KANAREK_REVIEW_ROUTER_TOKEN` for its private
proxy contract. Direct Gemini/OpenAI/Anthropic/xAI credentials are quip-only and
must not be consumed by this router.

Repository copies of provider secrets, when present, exist only for the manual
credential-sync workflow. Target repositories do not need provider credentials.

## Source map

- `src/index.ts`: health surface and trusted service-binding request adaptation.
- `src/review-router.ts`: provider definitions, model chains, error
  categorization, cooldown handling, health, and completion routing.
- `src/openrouter-models.ts`: OpenRouter model-list helpers.
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
