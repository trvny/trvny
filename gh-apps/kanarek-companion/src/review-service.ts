import { bearerAuthorized } from './auth.ts';
import {
  REVIEW_SERVICE_INTERNAL_BEARER,
  REVIEW_SERVICE_TRUST_HEADER,
  REVIEW_SERVICE_TRUST_VALUE,
} from './review-service-protocol.ts';
import {
  handleReviewRouterRequest,
  REVIEW_ROUTER_MODELS_PATH,
  REVIEW_ROUTER_PATH,
  REVIEW_WORKERS_AI_OVERRIDE_HEADER,
  reviewProviderPoolHealth,
  reviewWorkersAiExplicitlyDisabled,
  type ReviewRouterEnv,
} from './review-router.ts';

const REVIEW_HEALTH_PATH = '/health';
const INTERNAL_REVIEW_ORIGIN = 'https://kanarek-review.internal';

export interface ReviewServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ReviewServiceEnv extends ReviewRouterEnv {
  KANAREK_REVIEW_SERVICE?: ReviewServiceBinding;
}

type ProviderPoolHealth = Awaited<ReturnType<typeof reviewProviderPoolHealth>>;

type JsonObject = Record<string, unknown>;

function reviewRouterRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname === REVIEW_ROUTER_PATH || pathname === REVIEW_ROUTER_MODELS_PATH;
}
function serviceRequest(request: Request, env: ReviewServiceEnv): Request {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${REVIEW_SERVICE_INTERNAL_BEARER}`);
  headers.set(REVIEW_SERVICE_TRUST_HEADER, REVIEW_SERVICE_TRUST_VALUE);
  headers.set(
    REVIEW_WORKERS_AI_OVERRIDE_HEADER,
    reviewWorkersAiExplicitlyDisabled(env.KANAREK_REVIEW_WORKERS_AI_ENABLED) ? 'false' : 'true',
  );
  return new Request(request.clone(), { headers });
}

async function localFallback(
  request: Request,
  env: ReviewServiceEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  return handleReviewRouterRequest(request, env, fetcher);
}

export async function handleReviewRouterViaService(
  request: Request,
  env: ReviewServiceEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  if (!reviewRouterRequest(request)) return null;
  const service = env.KANAREK_REVIEW_SERVICE;
  if (!service) return localFallback(request, env, fetcher);
  if (!bearerAuthorized(request, env.KANAREK_REVIEW_ROUTER_TOKEN)) {
    return localFallback(request, env, fetcher);
  }

  try {
    return await service.fetch(serviceRequest(request, env));
  } catch (error) {
    console.warn(JSON.stringify({
      kanarekReviewService: 'binding_failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return localFallback(request, env, fetcher);
  }
}
function providerPool(value: unknown): ProviderPoolHealth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const health = value as JsonObject;
  const pool = health.providerPool;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return null;
  const candidate = pool as Partial<ProviderPoolHealth>;
  if (
    typeof candidate.available !== 'number' ||
    typeof candidate.configured !== 'number' ||
    typeof candidate.ready !== 'boolean' ||
    !Array.isArray(candidate.providers)
  ) return null;
  return candidate as ProviderPoolHealth;
}

export type ReviewProviderPoolState = {
  providerPool: ProviderPoolHealth;
  serviceConfigured: boolean;
  serviceReady: boolean;
};

export async function reviewProviderPoolStateViaService(
  env: ReviewServiceEnv,
): Promise<ReviewProviderPoolState> {
  const service = env.KANAREK_REVIEW_SERVICE;
  if (service) {
    try {
      const response = await service.fetch(
        new Request(`${INTERNAL_REVIEW_ORIGIN}${REVIEW_HEALTH_PATH}`),
      );
      if (response.ok) {
        const parsed = providerPool(await response.json());
        if (parsed) {
          return { providerPool: parsed, serviceConfigured: true, serviceReady: parsed.ready };
        }
      }
      await response.body?.cancel();
    } catch (error) {
      console.warn(JSON.stringify({
        kanarekReviewService: 'health_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }));
    }
  }
  return {
    providerPool: await reviewProviderPoolHealth(env),
    serviceConfigured: Boolean(service),
    serviceReady: false,
  };
}

export async function reviewProviderPoolHealthViaService(
  env: ReviewServiceEnv,
): Promise<ProviderPoolHealth> {
  return (await reviewProviderPoolStateViaService(env)).providerPool;
}

export { REVIEW_WORKERS_AI_OVERRIDE_HEADER };
