import { configuredOpenRouterModels } from './openrouter-models.ts';

export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';
export const REVIEW_ROUTER_MODELS_PATH = '/review-router/v1/models';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const SOFT_FAILURE_PREVIEW_BYTES = 8_192;
const AIHUBMIX_RETRYABLE_MESSAGES = [
  'to prevent abuse of free resources',
  'accounts that have not been recharged can only try',
  'increase the free quota after recharging',
] as const;

export interface ReviewRouterEnv {
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  AIHUBMIX_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ORCAROUTER_API_KEY?: string;
  KANAREK_REVIEW_ROUTER_TIMEOUT_MS?: string;
  KANAREK_REVIEW_GEMINI_MODEL?: string;
  KANAREK_OPENROUTER_MODELS?: string;
}

type JsonObject = Record<string, unknown>;

type ReviewProvider = {
  id: 'gemini' | 'aihubmix' | 'openrouter' | 'orcarouter';
  url: string;
  model: string;
  fallbackModels?: readonly string[];
  apiKey: (env: ReviewRouterEnv) => string | undefined;
  headers?: Record<string, string>;
};

function providers(env: ReviewRouterEnv): readonly ReviewProvider[] {
  const openRouterModels = configuredOpenRouterModels(env.KANAREK_OPENROUTER_MODELS);
  return [
    {
      id: 'gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: env.KANAREK_REVIEW_GEMINI_MODEL?.trim() || 'gemini-3.7-flash',
      apiKey: (providerEnv) => providerEnv.GEMINI_API_KEY,
    },
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

function jsonError(message: string, code: string, status: number): Response {
  return Response.json(
    { error: { message, type: 'provider_error', code } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
    input = value;
  } catch {
    return jsonError('Invalid JSON body', 'invalid_json', 400);
  }

  let configured = 0;
  let invalidRequests = 0;
  for (const provider of providers(env)) {
    const apiKey = provider.apiKey(env)?.trim();
    if (!apiKey) continue;
    configured += 1;
    const controller = new AbortController();
    const providerTimeoutMs = timeoutMs(env);
    const deadlineAt = Date.now() + providerTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
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
          model: provider.model,
          ...(provider.fallbackModels ? { models: provider.fallbackModels } : { models: undefined }),
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        if (provider.id === 'aihubmix') {
          const preview = await responsePreview(response, deadlineAt);
          clearTimeout(timeout);
          if (preview === null) {
            await discard(response);
            console.warn(JSON.stringify({
              kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'preview_timeout',
            }));
            continue;
          }
          if (isAIHubMixSoftFailure(preview)) {
            await discard(response);
            console.warn(JSON.stringify({
              kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'soft_quota',
            }));
            continue;
          }
        } else {
          clearTimeout(timeout);
        }
        console.info(JSON.stringify({ kanarekReviewRouter: 'selected', provider: provider.id }));
        return upstreamResponse(response, provider);
      }

      clearTimeout(timeout);
      const status = response.status;
      await discard(response);
      if (status === 400) {
        invalidRequests += 1;
        console.warn(
          JSON.stringify({ kanarekReviewRouter: 'provider_failed', provider: provider.id, status }),
        );
        continue;
      }
      console.warn(
        JSON.stringify({ kanarekReviewRouter: 'provider_failed', provider: provider.id, status }),
      );
      if (!retryableStatus(status)) {
        return jsonError('Review provider configuration failed', 'provider_configuration_error', 502);
      }
    } catch (error) {
      clearTimeout(timeout);
      const category = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';
      console.warn(
        JSON.stringify({ kanarekReviewRouter: 'provider_failed', provider: provider.id, category }),
      );
    }
  }

  if (!configured) {
    return jsonError('Review router is not configured', 'review_router_unconfigured', 503);
  }
  if (invalidRequests === configured) {
    return jsonError('Invalid review request', 'invalid_request', 400);
  }
  return jsonError('Review providers unavailable', 'review_router_exhausted', 502);
}
