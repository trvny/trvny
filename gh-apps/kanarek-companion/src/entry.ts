import {
  addAccountAttentionOpenApi,
  handleAccountAttentionAction,
} from './account-attention.ts';
import {
  addAgentGuidanceOpenApi,
  handleAgentGuidanceAction,
} from './agents-guidance-actions.ts';
import { addEngramOpenApi, handleEngramAction } from './engram-actions.ts';
import {
  handleReviewRouterRequest,
  ReviewProviderCooldownStore,
  type ReviewRouterEnv,
} from './review-router.ts';
import router, {
  actionFetch,
  CommentProbeLock,
  customGptOpenApi,
  OperatorCheckpointStore,
} from './router.ts';

export { actionFetch, CommentProbeLock, OperatorCheckpointStore, ReviewProviderCooldownStore };

type JsonObject = Record<string, unknown>;
type RouterEnv = Parameters<typeof router.fetch>[1];

interface WorkerVersionMetadataLike {
  id?: string;
  tag?: string;
  timestamp?: string;
}

type Env = RouterEnv & ReviewRouterEnv & {
  CF_VERSION_METADATA?: WorkerVersionMetadataLike;
};

const OPENAPI_PATH = '/gpt-actions/openapi.json';
const CAPABILITY_PATH = '/gpt-actions/operator/capabilities';
const SMOKE_PATH = '/gpt-actions/operator/smoke';
const HEALTH_PATH = '/health';
const SMOKE_REPOSITORY = 'trvny/trvny';
const REQUIRED_SMOKE_OPERATIONS = [
  'getOperatorBootstrap',
  'getOperatorCapabilities',
  'getCloudflareOverview',
  'searchEngramMemory',
  'runOperatorAutopilot',
  'runOperatorSmokeTest',
  'orchestrateRelease',
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function addCapabilityOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CAPABILITY_PATH] = {
    get: {
      operationId: 'getOperatorCapabilities',
      summary: 'Inspect the capabilities of the live Gremlin gateway',
      description:
        'Returns the serving Cloudflare Worker version plus operation IDs derived from this exact deployment OpenAPI. Use before long workflows when deployment state matters.',
      responses: {
        '200': {
          description: 'Live gateway capability manifest',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {},
              },
            },
          },
        },
      },
    },
  };
  paths[SMOKE_PATH] = {
    post: {
      operationId: 'runOperatorSmokeTest',
      summary: 'Run a harmless authenticated smoke test against the live operator',
      description:
        'Verifies trvny/GPTomek identity, private operator bootstrap, live capability metadata and a harmless trvny/trvny repository read. Performs no mutations.',
      responses: {
        '200': {
          description: 'Operator smoke test passed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {},
              },
            },
          },
        },
      },
    },
  };
}

export function gatewayOpenApi(origin: string): JsonObject {
  const document = customGptOpenApi(origin);
  addEngramOpenApi(document);
  addCapabilityOpenApi(document);
  addAccountAttentionOpenApi(document);
  addAgentGuidanceOpenApi(document);
  return document;
}

export function operationIds(document: JsonObject): string[] {
  if (!isObject(document.paths)) return [];
  const ids = new Set<string>();
  for (const pathItem of Object.values(document.paths)) {
    if (!isObject(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!isObject(operation) || typeof operation.operationId !== 'string') continue;
      ids.add(operation.operationId);
    }
  }
  return [...ids].sort();
}

function workerVersion(metadata: WorkerVersionMetadataLike | undefined): JsonObject {
  return {
    id: typeof metadata?.id === 'string' ? metadata.id : null,
    tag: typeof metadata?.tag === 'string' ? metadata.tag : null,
    timestamp: typeof metadata?.timestamp === 'string' ? metadata.timestamp : null,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function gatewayManifest(
  document: JsonObject,
  metadata: WorkerVersionMetadataLike | undefined,
): Promise<JsonObject> {
  const ids = operationIds(document);
  const info = isObject(document.info) ? document.info : {};
  return {
    manifestVersion: 1,
    service: 'kanarek-companion',
    workerVersion: workerVersion(metadata),
    openApi: {
      title: typeof info.title === 'string' ? info.title : null,
      version: typeof info.version === 'string' ? info.version : null,
      operationCount: ids.length,
      operationIds: ids,
      capabilityDigest: `sha256:${await sha256(ids.join('\n'))}`,
    },
  };
}

function internalActionRequest(
  source: Request,
  pathname: string,
  method: 'GET' | 'POST',
  body?: JsonObject,
): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function smokeFailure(stage: string, response: Response, payload: JsonObject | null): Response {
  return json(
    {
      ok: false,
      stage,
      status: response.status,
      error: typeof payload?.error === 'string' ? payload.error : 'smoke_step_failed',
    },
    response.status >= 400 ? response.status : 502,
  );
}

async function capabilityResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const authorized = await router.fetch(
    internalActionRequest(request, '/gpt-actions/github/read', 'POST', { path: '/user' }),
    env,
  );
  if (!authorized.ok) return authorized;
  const document = gatewayOpenApi(new URL(request.url).origin);
  return json({ ok: true, ...(await gatewayManifest(document, env.CF_VERSION_METADATA)) });
}

async function operatorSmokeResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const identityResponse = await router.fetch(
    internalActionRequest(request, '/gpt-actions/whoami', 'GET'),
    env,
  );
  const identity = await responseObject(identityResponse);
  if (!identityResponse.ok || identity?.ok !== true) {
    return smokeFailure('identity', identityResponse, identity);
  }

  const bootstrapResponse = await router.fetch(
    internalActionRequest(request, '/gpt-actions/operator/bootstrap', 'POST', {
      repository: SMOKE_REPOSITORY,
    }),
    env,
  );
  const bootstrap = await responseObject(bootstrapResponse);
  if (!bootstrapResponse.ok || bootstrap?.ok !== true || !isObject(bootstrap.policy)) {
    return smokeFailure('bootstrap', bootstrapResponse, bootstrap);
  }

  const capabilitiesResponse = await capabilityResponse(
    internalActionRequest(request, CAPABILITY_PATH, 'GET'),
    env,
  );
  const capabilities = await responseObject(capabilitiesResponse);
  const openApi = isObject(capabilities?.openApi) ? capabilities.openApi : null;
  const worker = isObject(capabilities?.workerVersion) ? capabilities.workerVersion : null;
  const ids = Array.isArray(openApi?.operationIds)
    ? openApi.operationIds.filter((value): value is string => typeof value === 'string')
    : [];
  const missingOperations = REQUIRED_SMOKE_OPERATIONS.filter((operation) => !ids.includes(operation));
  if (
    !capabilitiesResponse.ok ||
    capabilities?.ok !== true ||
    typeof worker?.id !== 'string' ||
    missingOperations.length
  ) {
    return json(
      {
        ok: false,
        stage: 'capabilities',
        status: capabilitiesResponse.status,
        error: 'live_capability_manifest_invalid',
        missingOperations,
      },
      capabilitiesResponse.ok ? 502 : capabilitiesResponse.status,
    );
  }

  const repositoryResponse = await router.fetch(
    internalActionRequest(request, '/gpt-actions/github/read', 'POST', {
      path: `/repos/${SMOKE_REPOSITORY}`,
    }),
    env,
  );
  const repositoryPayload = await responseObject(repositoryResponse);
  const repository = isObject(repositoryPayload?.data) ? repositoryPayload.data : null;
  if (
    !repositoryResponse.ok ||
    repositoryPayload?.ok !== true ||
    repository?.full_name !== SMOKE_REPOSITORY ||
    typeof repository.default_branch !== 'string'
  ) {
    return smokeFailure('repository_read', repositoryResponse, repositoryPayload);
  }

  const user = isObject(identity.user) ? identity.user : {};
  const bot = isObject(identity.bot) ? identity.bot : {};
  return json({
    ok: true,
    service: 'kanarek-companion',
    workerVersion: worker,
    capabilityDigest: openApi?.capabilityDigest ?? null,
    operationCount: openApi?.operationCount ?? ids.length,
    checks: {
      identity: {
        ok: true,
        user: typeof user.login === 'string' ? user.login : null,
        bot: typeof bot.login === 'string' ? bot.login : null,
      },
      bootstrap: {
        ok: true,
        policyVersion: bootstrap.policy.version ?? null,
        repository: SMOKE_REPOSITORY,
      },
      capabilities: {
        ok: true,
        requiredOperations: [...REQUIRED_SMOKE_OPERATIONS],
      },
      repositoryRead: {
        ok: true,
        repository: repository.full_name,
        defaultBranch: repository.default_branch,
      },
    },
  });
}

async function decoratedHealth(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const response = await router.fetch(request, env, ctx);
  if (request.method === 'HEAD') return response;
  let body: JsonObject;
  try {
    const value = await response.clone().json();
    if (!isObject(value)) return response;
    body = value;
  } catch {
    return response;
  }
  const document = gatewayOpenApi(new URL(request.url).origin);
  const manifest = await gatewayManifest(document, env.CF_VERSION_METADATA);
  return json({
    ...body,
    gateway: manifest,
    cloudflare: {
      configured: Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_API_TOKEN?.trim()),
    },
  }, response.status);
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const reviewRouterResponse = await handleReviewRouterRequest(request, env);
    if (reviewRouterResponse) return reviewRouterResponse;
    if (url.pathname === OPENAPI_PATH && request.method === 'GET') {
      return json(gatewayOpenApi(url.origin));
    }
    if (url.pathname === CAPABILITY_PATH) {
      return capabilityResponse(request, env);
    }
    if (url.pathname === SMOKE_PATH) {
      return operatorSmokeResponse(request, env);
    }
    if (url.pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return decoratedHealth(request, env, ctx);
    }
    const engramResponse = await handleEngramAction(
      request,
      env,
      (internalRequest) => router.fetch(internalRequest, env, ctx),
      actionFetch,
    );
    if (engramResponse) return engramResponse;
    const attentionResponse = await handleAccountAttentionAction(
      request,
      (internalRequest) => router.fetch(internalRequest, env, ctx),
    );
    if (attentionResponse) return attentionResponse;
    const guidanceResponse = await handleAgentGuidanceAction(request, env, ctx);
    if (guidanceResponse) return guidanceResponse;
    return router.fetch(request, env, ctx);
  },
};

export default worker;
