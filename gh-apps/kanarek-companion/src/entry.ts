import router, {
  actionFetch,
  CommentProbeLock,
  customGptOpenApi,
  OperatorCheckpointStore,
} from './router.ts';

export { actionFetch, CommentProbeLock, OperatorCheckpointStore };

type JsonObject = Record<string, unknown>;
type RouterEnv = Parameters<typeof router.fetch>[1];

interface WorkerVersionMetadataLike {
  id?: string;
  tag?: string;
  timestamp?: string;
}

type Env = RouterEnv & {
  CF_VERSION_METADATA?: WorkerVersionMetadataLike;
};

const OPENAPI_PATH = '/gpt-actions/openapi.json';
const CAPABILITY_PATH = '/gpt-actions/operator/capabilities';
const HEALTH_PATH = '/health';

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
}

export function gatewayOpenApi(origin: string): JsonObject {
  const document = customGptOpenApi(origin);
  addCapabilityOpenApi(document);
  return document;
}

function operationIds(document: JsonObject): string[] {
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

function internalAuthProbe(source: Request): Request {
  const url = new URL(source.url);
  url.pathname = '/gpt-actions/github/read';
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: '/user' }),
  });
}

async function capabilityResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const authorized = await router.fetch(internalAuthProbe(request), env);
  if (!authorized.ok) return authorized;
  const document = gatewayOpenApi(new URL(request.url).origin);
  return json({ ok: true, ...(await gatewayManifest(document, env.CF_VERSION_METADATA)) });
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
  return json({ ...body, gateway: manifest }, response.status);
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === OPENAPI_PATH && request.method === 'GET') {
      return json(gatewayOpenApi(url.origin));
    }
    if (url.pathname === CAPABILITY_PATH) {
      return capabilityResponse(request, env);
    }
    if (url.pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return decoratedHealth(request, env, ctx);
    }
    return router.fetch(request, env, ctx);
  },
};

export default worker;
