import { bearerAuthorized } from '../../kanarek-companion/src/auth.ts';
import {
  REVIEW_SERVICE_INTERNAL_BEARER,
  REVIEW_SERVICE_TRUST_HEADER,
  REVIEW_SERVICE_TRUST_VALUE,
} from '../../kanarek-companion/src/review-service-protocol.ts';
import {
  handleReviewRouterRequest,
  REVIEW_WORKERS_AI_OVERRIDE_HEADER,
  reviewProviderPoolHealth,
  type ReviewRouterEnv,
} from '../../kanarek-companion/src/review-router.ts';

type Env = ReviewRouterEnv & {
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
};

const HEALTH_PATH = '/health';

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function reviewEnvForRequest(request: Request, env: Env): Env {
  const trusted =
    request.headers.get(REVIEW_SERVICE_TRUST_HEADER) === REVIEW_SERVICE_TRUST_VALUE &&
    bearerAuthorized(request, REVIEW_SERVICE_INTERNAL_BEARER);
  const effective: Env = {
    ...env,
    KANAREK_REVIEW_ROUTER_TOKEN: trusted ? REVIEW_SERVICE_INTERNAL_BEARER : undefined,
  };
  if (request.headers.get(REVIEW_WORKERS_AI_OVERRIDE_HEADER) === 'false') {
    effective.KANAREK_REVIEW_WORKERS_AI_ENABLED = 'false';
  }
  return effective;
}

async function health(env: Env): Promise<Response> {
  const providerPool = await reviewProviderPoolHealth(env);
  return json({
    ok: providerPool.ready,
    service: 'kanarek-review',
    providerPool,
    workerVersion: env.CF_VERSION_METADATA ?? null,
  }, providerPool.ready ? 200 : 503);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return health(env);
    }

    const response = await handleReviewRouterRequest(
      request,
      reviewEnvForRequest(request, env),
    );
    if (response) return response;
    return json({ error: 'not_found' }, 404);
  },
};

export default worker;
