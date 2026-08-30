export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export interface ReviewRouterEnv {
  AIHUBMIX_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ORCAROUTER_API_KEY?: string;
  KANAREK_REVIEW_ROUTER_TIMEOUT_MS?: string;
}

type JsonObject = Record<string, unknown>;

type ReviewProvider = {
  id: 'aihubmix' | 'openrouter' | 'orcarouter';
  url: string;
  model: string;
  apiKey: (env: ReviewRouterEnv) => string | undefined;
  headers?: Record<string, string>;
};

const PROVIDERS: readonly ReviewProvider[] = [
  {
    id: 'aihubmix',
    url: 'https://aihubmix.com/v1/chat/completions',
    model: 'coding-glm-5.3-free',
    apiKey: (env) => env.AIHUBMIX_API_KEY,
  },
  {
    id: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/free',
    apiKey: (env) => env.OPENROUTER_API_KEY,
    headers: { 'X-Title': 'Kanarek free review' },
  },
  {
    id: 'orcarouter',
    url: 'https://api.orcarouter.ai/v1/chat/completions',
    model: 'deepseek/deepseek-v4-flash-free',
    apiKey: (env) => env.ORCAROUTER_API_KEY,
  },
];

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
  const expected = env.OPENROUTER_API_KEY?.trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && timingSafeEqual(match[1].trim(), expected));
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
    status === 400 ||
    status === 402 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
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

export async function handleReviewRouterRequest(
  request: Request,
  env: ReviewRouterEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
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
  for (const provider of PROVIDERS) {
    const apiKey = provider.apiKey(env)?.trim();
    if (!apiKey) continue;
    configured += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs(env));
    try {
      const response = await fetcher(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...provider.headers,
        },
        body: JSON.stringify({ ...input, model: provider.model }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        console.info(JSON.stringify({ kanarekReviewRouter: 'selected', provider: provider.id }));
        return upstreamResponse(response, provider);
      }

      const status = response.status;
      await discard(response);
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
  return jsonError('Review providers unavailable', 'review_router_exhausted', 502);
}
