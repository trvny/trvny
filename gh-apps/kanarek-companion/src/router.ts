import baseWorker, { CommentProbeLock } from './index.ts';
import { handleGptActions, openApiDocument } from './gpt-actions.ts';

export { CommentProbeLock };

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];

type JsonObject = Record<string, unknown>;

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const OAUTH_AUTHORIZE_PATH = '/gpt-actions/oauth/authorize';
const BOT_ACTION_PATH = '/gpt-actions/github/bot';

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeObjectSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeObjectSchemas);
  if (!isObject(value)) return value;

  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = normalizeObjectSchemas(entry);
  }
  if (output.type === 'object' && !isObject(output.properties)) {
    output.properties = {};
  }
  return output;
}

function oauthSecurityScheme(components: JsonObject): JsonObject {
  if (!isObject(components.securitySchemes)) components.securitySchemes = {};
  const securitySchemes = components.securitySchemes as JsonObject;
  if (!isObject(securitySchemes.githubOAuth)) securitySchemes.githubOAuth = {};
  const githubOAuth = securitySchemes.githubOAuth as JsonObject;
  if (!isObject(githubOAuth.flows)) githubOAuth.flows = {};
  const flows = githubOAuth.flows as JsonObject;
  if (!isObject(flows.authorizationCode)) flows.authorizationCode = {};
  return flows.authorizationCode as JsonObject;
}

export function customGptOpenApi(origin: string): JsonObject {
  const document = normalizeObjectSchemas(openApiDocument(origin));
  if (!isObject(document)) throw new Error('invalid_openapi_document');

  if (!isObject(document.components)) document.components = {};
  const components = document.components as JsonObject;
  if (!isObject(components.schemas)) components.schemas = {};

  const authorizationCode = oauthSecurityScheme(components);
  authorizationCode.authorizationUrl = `${origin}${OAUTH_AUTHORIZE_PATH}`;
  authorizationCode.scopes = {
    github: 'Authenticate with the installed GitHub App',
  };
  return document;
}

export function githubOAuthAuthorizationUrl(requestUrl: string): string {
  const request = new URL(requestUrl);
  const clientId = request.searchParams.get('client_id');
  if (!clientId) throw new Error('missing_client_id');

  const target = new URL(GITHUB_AUTHORIZE_URL);
  target.searchParams.set('client_id', clientId);
  for (const key of ['redirect_uri', 'state', 'login', 'allow_signup', 'prompt']) {
    const value = request.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

export async function normalizeGptActionsRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  if (url.pathname !== BOT_ACTION_PATH || request.method !== 'POST') return request;

  let input: JsonObject;
  try {
    const value = await request.clone().json();
    if (!isObject(value)) return request;
    input = value;
  } catch {
    return request;
  }

  const path = typeof input.path === 'string' ? input.path : '';
  if (input.method !== 'POST' || !path.endsWith('/reactions') || input.expect === 'empty') {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...input, expect: 'empty' }),
  });
}

function actionException(error: unknown): Response {
  const requestId = crypto.randomUUID();
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'unknown_error';
  console.error(JSON.stringify({ gptActions: 'uncaught', requestId, detail }));
  return Response.json(
    { ok: false, error: 'worker_exception', requestId, detail },
    {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    },
  );
}

export const actionFetch: typeof fetch = (input, init) => fetch(input, init);

const worker = {
  async fetch(
    request: Request,
    env: BaseEnv,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/gpt-actions/openapi.json') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      return Response.json(customGptOpenApi(url.origin), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === OAUTH_AUTHORIZE_PATH) {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      try {
        return Response.redirect(githubOAuthAuthorizationUrl(request.url), 302);
      } catch {
        return Response.json({ error: 'invalid_oauth_authorize_request' }, { status: 400 });
      }
    }
    if (url.pathname === '/gpt-actions' || url.pathname.startsWith('/gpt-actions/')) {
      try {
        return await handleGptActions(
          await normalizeGptActionsRequest(request),
          env,
          actionFetch,
        );
      } catch (error) {
        return actionException(error);
      }
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

export default worker;
