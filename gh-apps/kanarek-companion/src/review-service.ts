import { bearerAuthorized } from './auth.ts';
import {
  REVIEW_ROUTER_MODELS_PATH,
  REVIEW_ROUTER_PATH,
  REVIEW_SERVICE_INTERNAL_BEARER,
  REVIEW_SERVICE_TRUST_HEADER,
  REVIEW_SERVICE_TRUST_VALUE,
  REVIEW_WORKERS_AI_OVERRIDE_HEADER,
  type ReviewProviderPoolHealth,
} from './review-service-protocol.ts';

const REVIEW_HEALTH_PATH = '/health';
const INTERNAL_REVIEW_ORIGIN = 'https://kanarek-review.internal';

export interface ReviewServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ReviewServiceEnv {
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  KANAREK_REVIEW_SERVICE?: ReviewServiceBinding;
  KANAREK_REVIEW_WORKERS_AI_ENABLED?: string;
}

type JsonObject = Record<string, unknown>;

function reviewRouterRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname === REVIEW_ROUTER_PATH || pathname === REVIEW_ROUTER_MODELS_PATH;
}

function workersAiDisabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === 'false' || value === '0' || value === 'no' || value === 'off';
}

function serviceRequest(request: Request, env: ReviewServiceEnv): Request {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${REVIEW_SERVICE_INTERNAL_BEARER}`);
  headers.set(REVIEW_SERVICE_TRUST_HEADER, REVIEW_SERVICE_TRUST_VALUE);
  headers.set(REVIEW_WORKERS_AI_OVERRIDE_HEADER, workersAiDisabled(env.KANAREK_REVIEW_WORKERS_AI_ENABLED) ? 'false' : 'true');
  return new Request(request.clone(), { headers });
}

function unavailable(status = 503): Response {
  return Response.json({ error: 'review_service_unavailable' }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function handleReviewRouterViaService(
  request: Request,
  env: ReviewServiceEnv,
): Promise<Response | null> {
  if (!reviewRouterRequest(request)) return null;
  if (!bearerAuthorized(request, env.KANAREK_REVIEW_ROUTER_TOKEN)) return unavailable(401);
  const service = env.KANAREK_REVIEW_SERVICE;
  if (!service) return unavailable();
  try {
    return await service.fetch(serviceRequest(request, env));
  } catch (error) {
    console.warn(JSON.stringify({ kanarekReviewService: 'binding_failed', error: error instanceof Error ? error.message : 'unknown_error' }));
    return unavailable();
  }
}

function providerPool(value: unknown): ReviewProviderPoolHealth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pool = (value as JsonObject).providerPool;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return null;
  const candidate = pool as Partial<ReviewProviderPoolHealth>;
  if (typeof candidate.available !== 'number' || typeof candidate.configured !== 'number' || typeof candidate.ready !== 'boolean' || !Array.isArray(candidate.providers)) return null;
  return candidate as ReviewProviderPoolHealth;
}

export type ReviewProviderPoolState = { providerPool: ReviewProviderPoolHealth; serviceConfigured: boolean; serviceReady: boolean };

const EMPTY_PROVIDER_POOL: ReviewProviderPoolHealth = { available: 0, configured: 0, providers: [], ready: false };

export async function reviewProviderPoolStateViaService(env: ReviewServiceEnv): Promise<ReviewProviderPoolState> {
  const service = env.KANAREK_REVIEW_SERVICE;
  if (service) {
    try {
      const response = await service.fetch(new Request(`${INTERNAL_REVIEW_ORIGIN}${REVIEW_HEALTH_PATH}`));
      if (response.ok) {
        const parsed = providerPool(await response.json());
        if (parsed) return { providerPool: parsed, serviceConfigured: true, serviceReady: parsed.ready };
      }
      await response.body?.cancel();
    } catch (error) {
      console.warn(JSON.stringify({ kanarekReviewService: 'health_failed', error: error instanceof Error ? error.message : 'unknown_error' }));
    }
  }
  return { providerPool: EMPTY_PROVIDER_POOL, serviceConfigured: Boolean(service), serviceReady: false };
}

export async function reviewProviderPoolHealthViaService(env: ReviewServiceEnv): Promise<ReviewProviderPoolHealth> {
  return (await reviewProviderPoolStateViaService(env)).providerPool;
}
