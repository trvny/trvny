import { configuredOpenRouterModels } from './openrouter-models.ts';

export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';
export const REVIEW_ROUTER_MODELS_PATH = '/review-router/v1/models';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 30_000;
const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 30 * 60_000;
const SOFT_FAILURE_PREVIEW_BYTES = 8_192;
const DEFAULT_REVIEW_OPENROUTER_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-s-2.1:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-m.1:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
] as const;
const AIHUBMIX_RETRYABLE_MESSAGES = [
  'to prevent abuse of free resources',
  'accounts that have not been recharged can only try',
  'increase the free quota after recharging',
] as const;

export interface ReviewRouterEnv {
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  AIHUBMIX_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ORCAROUTER_API_KEY?: string;
  KANAREK_REVIEW_ROUTER_TIMEOUT_MS?: string;
  KANAREK_REVIEW_COOLDOWNS?: DurableObjectNamespace;
  KANAREK_REVIEW_QUOTA_COOLDOWN_MS?: string;
  KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS?: string;
  KANAREK_REVIEW_OPENROUTER_MODELS?: string;
  KANAREK_OPENROUTER_MODELS?: string;
}

type JsonObject = Record<string, unknown>;

type ReviewProviderId = 'aihubmix' | 'openrouter' | 'orcarouter';

type ReviewProvider = {
  id: ReviewProviderId;
  url: string;
  model: string;
  fallbackModels?: readonly string[];
  apiKey: (env: ReviewRouterEnv) => string | undefined;
  headers?: Record<string, string>;
};

type ProviderCooldown = {
  until: number;
  category: string;
};

const COOLDOWN_STORAGE_KEY = 'cooldown';
const COOLDOWN_INTERNAL_ORIGIN = 'https://review-cooldown.internal';

function validProviderCooldown(value: unknown): value is ProviderCooldown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cooldown = value as Partial<ProviderCooldown>;
  return (
    typeof cooldown.until === 'number' &&
    Number.isFinite(cooldown.until) &&
    typeof cooldown.category === 'string' &&
    cooldown.category.length > 0 &&
    cooldown.category.length <= 64
  );
}

function cooldownJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export class ReviewProviderCooldownStore {
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.handle(request));
  }

  async alarm(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (validProviderCooldown(current) && current.until > Date.now()) {
        await this.state.storage.setAlarm(current.until);
        return;
      }
      await this.state.storage.deleteAll();
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/active' && request.method === 'GET') {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (!validProviderCooldown(current) || current.until <= Date.now()) {
        if (current !== undefined) {
          await this.state.storage.delete(COOLDOWN_STORAGE_KEY);
          await this.state.storage.deleteAlarm();
        }
        return cooldownJson({ active: false });
      }
      return cooldownJson({ active: true, ...current });
    }

    if (pathname === '/extend' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }
      const input = body as { category?: unknown; durationMs?: unknown };
      if (
        typeof input.category !== 'string' ||
        !input.category ||
        input.category.length > 64 ||
        typeof input.durationMs !== 'number' ||
        !Number.isInteger(input.durationMs) ||
        input.durationMs < MIN_COOLDOWN_MS ||
        input.durationMs > MAX_COOLDOWN_MS
      ) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }

      const candidate: ProviderCooldown = {
        until: Date.now() + input.durationMs,
        category: input.category,
      };
      const raw = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      const current = validProviderCooldown(raw) ? raw : null;
      const next = current && current.until >= candidate.until ? current : candidate;
      if (next === candidate) {
        await this.state.storage.put(COOLDOWN_STORAGE_KEY, candidate);
        await this.state.storage.setAlarm(candidate.until);
      }
      return cooldownJson({ ok: true, ...next });
    }

    return cooldownJson({ error: 'not_found' }, 404);
  }
}

function providers(env: ReviewRouterEnv): readonly ReviewProvider[] {
  const reviewOpenRouterModels = env.KANAREK_REVIEW_OPENROUTER_MODELS?.trim();
  const sharedOpenRouterModels = env.KANAREK_OPENROUTER_MODELS?.trim();
  const openRouterModels = reviewOpenRouterModels
    ? configuredOpenRouterModels(reviewOpenRouterModels)
    : sharedOpenRouterModels
      ? configuredOpenRouterModels(sharedOpenRouterModels)
      : [...DEFAULT_REVIEW_OPENROUTER_MODELS];
  return [
    {
      id: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: openRouterModels[0],
      fallbackModels: openRouterModels.slice(1),
      apiKey: (providerEnv) => providerEnv.OPENROUTER_API_KEY,
      headers: { 'X-Title': 'Kanarek free review' },
    },
    {
      id: 'orcarouter',
      url: 'https://api.orcarouter.ai/v1/chat/completions',
      model: 'deepseek/deepseek-v4-flash-free',
      apiKey: (providerEnv) => providerEnv.ORCAROUTER_API_KEY,
    },
    {
      id: 'aihubmix',
      url: 'https://aihubmix.com/v1/chat/completions',
      model: 'coding-glm-5.3-free',
      apiKey: (providerEnv) => providerEnv.AIHUBMIX_API_KEY,
    },
  ];
}

function diagnostic(provider: ReviewProvider, category: string): string {
  return `${provider.id}:${category}`;
}

function diagnosticMessage(message: string, failures: readonly string[]): string {
  return failures.length ? `${message} (${failures.join(', ')})` : message;
}

function jsonError(message: string, code: string, status: number): Response {
  return Response.json(
    { error: { message, type: 'provider_error', code } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeProviderInput(input: JsonObject): JsonObject {
  if (!Array.isArray(input.messages)) return input;
  let changed = false;
  const messages = input.messages.map((message) => {
    if (!isObject(message) || message.role !== 'assistant' || message.refusal !== null) return message;
    const normalized = { ...message };
    delete normalized.refusal;
    changed = true;
    return normalized;
  });
  return changed ? { ...input, messages } : input;
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function authorized(request: Request, env: ReviewRouterEnv): boolean {
  const expected = env.KANAREK_REVIEW_ROUTER_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return timingSafeEqual(match[1].trim(), expected);
}

function timeoutMs(env: ReviewRouterEnv): number {
  const raw = env.KANAREK_REVIEW_ROUTER_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function boundedCooldownMs(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_COOLDOWN_MS || parsed > MAX_COOLDOWN_MS) {
    return fallback;
  }
  return parsed;
}

function cooldownDurationMs(env: ReviewRouterEnv, category: string): number | null {
  if (category === 'soft_quota' || category === 'http_402' || category === 'http_429') {
    return boundedCooldownMs(env.KANAREK_REVIEW_QUOTA_COOLDOWN_MS, DEFAULT_QUOTA_COOLDOWN_MS);
  }
  if (
    category === 'timeout' ||
    category === 'network' ||
    category === 'preview_timeout' ||
    category === 'http_408' ||
    category === 'http_409' ||
    category === 'http_425' ||
    /^http_5\d\d$/.test(category)
  ) {
    return boundedCooldownMs(
      env.KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS,
      DEFAULT_TRANSIENT_COOLDOWN_MS,
    );
  }
  return null;
}

function providerCooldownStub(
  env: ReviewRouterEnv,
  provider: ReviewProviderId,
): DurableObjectStub | null {
  if (!env.KANAREK_REVIEW_COOLDOWNS) return null;
  const id = env.KANAREK_REVIEW_COOLDOWNS.idFromName(provider);
  return env.KANAREK_REVIEW_COOLDOWNS.get(id);
}

async function activeProviderCooldown(
  env: ReviewRouterEnv,
  provider: ReviewProviderId,
): Promise<ProviderCooldown | null> {
  const stub = providerCooldownStub(env, provider);
  if (!stub) return null;
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/active`);
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as { active?: unknown }).active === true &&
      validProviderCooldown(payload)
    ) {
      return payload;
    }
  } catch {
    console.warn(JSON.stringify({ kanarekReviewRouter: 'cooldown_read_failed', provider }));
  }
  return null;
}

async function rememberProviderCooldown(
  provider: ReviewProviderId,
  category: string,
  env: ReviewRouterEnv,
): Promise<void> {
  const durationMs = cooldownDurationMs(env, category);
  if (durationMs === null) return;
  const stub = providerCooldownStub(env, provider);
  if (!stub) return;
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category, durationMs }),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({
        kanarekReviewRouter: 'cooldown_write_failed', provider, status: response.status,
      }));
    }
  } catch {
    console.warn(JSON.stringify({ kanarekReviewRouter: 'cooldown_write_failed', provider }));
  }
}

function isQuotaFailure(category: string): boolean {
  const normalized = category.startsWith('cooldown_') ? category.slice('cooldown_'.length) : category;
  return normalized === 'soft_quota' || normalized === 'http_402' || normalized === 'http_429';
}

function retryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 413 ||
    status === 422 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function upstreamResponse(response: Response, provider: ReviewProvider): Response {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  headers.delete('www-authenticate');
  headers.set('cache-control', 'no-store');
  headers.set('x-kanarek-review-provider', provider.id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; never expose an upstream error body.
  }
}

function readPreviewChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadlineAt: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, remainingMs);
    const finish = (result: ReadableStreamReadResult<Uint8Array> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    reader.read().then((result) => finish(result), () => finish(null));
  });
}

async function responsePreview(response: Response, deadlineAt: number): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let preview = '';
    while (preview.length < SOFT_FAILURE_PREVIEW_BYTES) {
      const chunk = await readPreviewChunk(reader, deadlineAt);
      if (!chunk) return null;
      const { done, value } = chunk;
      if (done) break;
      preview += decoder.decode(value, { stream: true });
      if (/(?:\r\n|\r|\n){2}/.test(preview)) break;
    }
    return preview.slice(0, SOFT_FAILURE_PREVIEW_BYTES);
  } catch {
    return null;
  } finally {
    reader?.cancel().catch(() => {
      // Best-effort preview cleanup; do not block the original tee branch.
    });
  }
}

function isAIHubMixSoftFailure(preview: string): boolean {
  const normalized = preview.toLowerCase();
  return AIHUBMIX_RETRYABLE_MESSAGES.some((message) => normalized.includes(message));
}

type ProviderAttempt = {
  model: string;
  fallbackModels?: readonly string[];
  label: 'default' | 'model_fallback' | 'fallback_chain' | 'primary_only';
};

function providerAttempts(provider: ReviewProvider): readonly ProviderAttempt[] {
  if (provider.id === 'openrouter' && provider.fallbackModels?.length) {
    return [
      { model: provider.model, fallbackModels: provider.fallbackModels, label: 'fallback_chain' },
      { model: provider.model, label: 'primary_only' },
    ];
  }
  return [{ model: provider.model, label: 'default' }];
}

function shouldTryNextAttempt(
  provider: ReviewProvider,
  status: number,
  attemptIndex: number,
  attemptCount: number,
): boolean {
  if (attemptIndex + 1 >= attemptCount) return false;
  if (provider.id === 'openrouter') return status === 400;
  return false;
}

function badRequestText(preview: string): string {
  try {
    const parsed: unknown = JSON.parse(preview);
    const root: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (isObject(root)) {
      if (isObject(root.error) && typeof root.error.message === 'string') return root.error.message;
      if (typeof root.message === 'string') return root.message;
    }
  } catch {
    // Fall back to the bounded raw preview for non-JSON provider errors.
  }
  return preview;
}

function classifyBadRequest(preview: string | null): string {
  if (preview === null) return 'http_400_unreadable';
  if (!preview) return 'http_400';
  const normalized = badRequestText(preview).toLowerCase();
  if (
    normalized.includes('api key') &&
    (normalized.includes('not valid') || normalized.includes('invalid') ||
      normalized.includes('expired') || normalized.includes('revoked') || normalized.includes('blocked'))
  ) return 'http_400_invalid_api_key';
  if (
    normalized.includes('context length') ||
    normalized.includes('context window') ||
    normalized.includes('too many tokens') ||
    normalized.includes('token limit')
  ) return 'http_400_context_length';
  if (
    normalized.includes('models') &&
    (normalized.includes('invalid') || normalized.includes('unknown') || normalized.includes('not found'))
  ) return 'http_400_fallback_models';
  if (
    normalized.includes('model') &&
    (normalized.includes('invalid') ||
      normalized.includes('not found') ||
      normalized.includes('does not exist') ||
      normalized.includes('unavailable'))
  ) return 'http_400_invalid_model';
  if (
    normalized.includes('unsupported parameter') ||
    normalized.includes('unknown parameter') ||
    normalized.includes('unknown field') ||
    normalized.includes('stream_options')
  ) return 'http_400_unsupported_parameter';
  if (
    normalized.includes('message') &&
    (normalized.includes('invalid') || normalized.includes('required') || normalized.includes('must'))
  ) return 'http_400_invalid_message';
  if (normalized.includes('moderation') || normalized.includes('safety')) {
    return 'http_400_moderation';
  }
  return 'http_400_invalid_request';
}

function isClientBadRequestCategory(category: string): boolean {
  return category === 'http_400' ||
    category === 'http_400_context_length' ||
    category === 'http_400_unsupported_parameter' ||
    category === 'http_400_invalid_message' ||
    category === 'http_400_moderation' ||
    category === 'http_400_invalid_request';
}

export async function handleReviewRouterRequest(
  request: Request,
  env: ReviewRouterEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === REVIEW_ROUTER_MODELS_PATH) {
    if (request.method !== 'GET') return jsonError('Method not allowed', 'method_not_allowed', 405);
    if (!authorized(request, env)) return jsonError('Unauthorized', 'unauthorized', 401);
    return Response.json({
      object: 'list',
      data: [{ id: 'kanarek-review-free', object: 'model', owned_by: 'kanarek' }],
    }, { headers: { 'cache-control': 'no-store' } });
  }
  if (url.pathname !== REVIEW_ROUTER_PATH) return null;
  if (request.method !== 'POST') return jsonError('Method not allowed', 'method_not_allowed', 405);
  if (!authorized(request, env)) return jsonError('Unauthorized', 'unauthorized', 401);

  let input: JsonObject;
  try {
    const value: unknown = await request.json();
    if (!isObject(value)) return jsonError('Invalid request body', 'invalid_request', 400);
    input = normalizeProviderInput(value);
  } catch {
    return jsonError('Invalid JSON body', 'invalid_json', 400);
  }

  let configured = 0;
  let invalidRequests = 0;
  const failures: string[] = [];
  for (const provider of providers(env)) {
    const apiKey = provider.apiKey(env)?.trim();
    if (!apiKey) continue;
    configured += 1;
    const cooldown = await activeProviderCooldown(env, provider.id);
    if (cooldown) {
      const category = `cooldown_${cooldown.category}`;
      failures.push(diagnostic(provider, category));
      console.info(JSON.stringify({
        kanarekReviewRouter: 'provider_cooldown', provider: provider.id, category: cooldown.category,
      }));
      continue;
    }
    const controller = new AbortController();
    const providerTimeoutMs = timeoutMs(env);
    const deadlineAt = Date.now() + providerTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    const attempts = providerAttempts(provider);
    let providerFailureCategory = 'unknown';
    let providerInvalidRequest = true;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        const response = await fetcher(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify({
            ...input,
            model: attempt.model,
            ...(attempt.fallbackModels?.length ? { models: attempt.fallbackModels } : { models: undefined }),
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          if (provider.id === 'aihubmix') {
            const preview = await responsePreview(response, deadlineAt);
            if (preview === null) {
              await discard(response);
              providerFailureCategory = 'preview_timeout';
              providerInvalidRequest = false;
              console.warn(JSON.stringify({
                kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'preview_timeout',
              }));
              break;
            }
            if (isAIHubMixSoftFailure(preview)) {
              await discard(response);
              providerFailureCategory = 'soft_quota';
              providerInvalidRequest = false;
              console.warn(JSON.stringify({
                kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'soft_quota',
              }));
              break;
            }
          }
          clearTimeout(timeout);
          console.info(JSON.stringify({
            kanarekReviewRouter: 'selected', provider: provider.id, attempt: attempt.label, model: attempt.model,
          }));
          return upstreamResponse(response, provider);
        }

        const status = response.status;
        const preview = status === 400 ? await responsePreview(response, deadlineAt) : null;
        providerFailureCategory = status === 400 ? classifyBadRequest(preview) : `http_${status}`;
        if (status !== 400 || !isClientBadRequestCategory(providerFailureCategory)) providerInvalidRequest = false;
        await discard(response);
        console.warn(JSON.stringify({
          kanarekReviewRouter: 'provider_failed',
          provider: provider.id,
          status,
          category: providerFailureCategory,
          attempt: attempt.label,
          model: attempt.model,
        }));

        if (shouldTryNextAttempt(provider, status, attemptIndex, attempts.length)) {
          continue;
        }
        if (status === 400 || retryableStatus(status)) break;
        clearTimeout(timeout);
        failures.push(diagnostic(provider, providerFailureCategory));
        return jsonError(
          diagnosticMessage('Review provider configuration failed', failures),
          'provider_configuration_error',
          502,
        );
      } catch (error) {
        const category = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';
        providerFailureCategory = category;
        providerInvalidRequest = false;
        console.warn(JSON.stringify({
          kanarekReviewRouter: 'provider_failed', provider: provider.id, category,
          attempt: attempt.label, model: attempt.model,
        }));
        break;
      }
    }

    clearTimeout(timeout);
    await rememberProviderCooldown(provider.id, providerFailureCategory, env);
    failures.push(diagnostic(provider, providerFailureCategory));
    if (providerInvalidRequest) invalidRequests += 1;
  }

  if (!configured) {
    return jsonError('Review router is not configured', 'review_router_unconfigured', 503);
  }
  if (invalidRequests === configured) {
    return jsonError(diagnosticMessage('Invalid review request', failures), 'invalid_request', 400);
  }
  return jsonError(
    diagnosticMessage('Review providers unavailable', failures),
    'review_router_exhausted',
    failures.length > 0 && failures.every((failure) => isQuotaFailure(failure.split(':', 2)[1] ?? ''))
      ? 429
      : 502,
  );
}
