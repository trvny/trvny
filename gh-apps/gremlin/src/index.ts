import runtime, {
  gremlinMcpManifest,
  handleGremlinMcp,
  type RuntimeEnv,
} from 'kanarek-companion/runtime';

type Env = RuntimeEnv & {
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
};

const HEALTH_PATH = '/health';
const MCP_PATH = '/mcp';
const CAPABILITY_PATH = '/gpt-actions/operator/capabilities';
// Kanarek-only ingress (GitHub webhook, GPTomek wake, private review router):
// served by kanarek-companion, never by Gremlin.
const KANAREK_PATHS = new Set(['/webhooks/github', '/gptomek/wake']);
const KANAREK_PREFIXES = ['/review-router/'];
// Obsolete Engram memory bridge was bound to a different provider.
// Keep the shared Kanarek legacy route unchanged, but do not serve it on Gremlin.
const OBSOLETE_ENGRAM_PATH_PREFIX = '/gpt-actions/engram/';

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function health(env: Env): Response {
  return json({
    ok: true,
    service: 'gremlin',
    workerVersion: env.CF_VERSION_METADATA ?? null,
  });
}

function kanarekOnly(pathname: string): boolean {
  return KANAREK_PATHS.has(pathname) || KANAREK_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function decorateCapabilities(
  request: Request,
  response: Response,
): Promise<Response> {
  if (
    !response.ok ||
    request.method !== 'GET' ||
    new URL(request.url).pathname !== CAPABILITY_PATH
  ) {
    return response;
  }
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    return json({
      ...payload,
      service: 'gremlin',
      mcp: gremlinMcpManifest(new URL(request.url).origin),
    }, response.status);
  } catch {
    return response;
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return health(env);
    }
    if (kanarekOnly(pathname) || pathname.startsWith(OBSOLETE_ENGRAM_PATH_PREFIX)) {
      return json({ error: 'not_found' }, 404);
    }
    if (pathname === '/gpt-actions/openapi.json' && request.method === 'GET') {
      const response = await runtime.fetch(request, env, ctx);
      if (!response.ok) return response;
      const document = await response.json() as { paths?: Record<string, unknown> };
      for (const path of Object.keys(document.paths ?? {})) {
        if (path.startsWith(OBSOLETE_ENGRAM_PATH_PREFIX)) delete document.paths?.[path];
      }
      return json(document, response.status);
    }
    if (pathname === MCP_PATH) {
      const response = await handleGremlinMcp(
        request,
        env,
        (internalRequest) => worker.fetch(internalRequest, env, ctx),
      );
      return response ?? json({ error: 'not_found' }, 404);
    }
    return decorateCapabilities(request, await runtime.fetch(request, env, ctx));
  },
};

export default worker;
