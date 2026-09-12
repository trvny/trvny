import gremlinRouter, {
  type GremlinRouterEnv,
} from 'kanarek-companion/gremlin-core';

type Env = GremlinRouterEnv & {
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

function health(env: Env): Response {
  return json({
    ok: true,
    service: 'gremlin-operator',
    workerVersion: env.CF_VERSION_METADATA ?? null,
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return health(env);
    }
    const response = await gremlinRouter.fetch(request, env);
    return response ?? json({ error: 'not_found' }, 404);
  },
};

export default worker;
