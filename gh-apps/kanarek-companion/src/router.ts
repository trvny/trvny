import baseWorker, { CommentProbeLock } from './index.ts';
import { handleGptActions, openApiDocument } from './gpt-actions.ts';

export { CommentProbeLock };

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];

type JsonObject = Record<string, unknown>;

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const OAUTH_AUTHORIZE_PATH = '/gpt-actions/oauth/authorize';

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
      return handleGptActions(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

export default worker;
