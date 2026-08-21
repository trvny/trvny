import { loadAgentGuidance, targetPaths } from './agents-guidance.ts';
import router from './router.ts';

type JsonObject = Record<string, unknown>;
type Env = Parameters<typeof router.fetch>[1];

const CONTEXT_PATH = '/gpt-actions/github/context';
const INVESTIGATION_PATH = '/gpt-actions/github/code/investigate';
const READ_PATH = '/gpt-actions/github/read';
const SHA_RE = /^[0-9a-f]{40}$/i;

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

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function contentPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
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

async function githubFile(
  request: Request,
  env: Env,
  repository: string,
  path: string,
  ref: string,
): Promise<unknown | null> {
  const response = await router.fetch(
    internalReadRequest(
      request,
      `/repos/${repoPath(repository)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}`,
    ),
    env,
  );
  if (response.status === 404) return null;
  const payload = await responseObject(response);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'agent_guidance_read_failed');
  }
  return payload.data;
}

function contextDetails(payload: JsonObject, input: JsonObject): {
  repository: string;
  ref: string;
  paths: string[];
} | null {
  const repository = isObject(payload.repository) ? payload.repository : null;
  const fullName = repository && typeof repository.fullName === 'string' ? repository.fullName : null;
  const defaultBranch = repository && typeof repository.defaultBranch === 'string'
    ? repository.defaultBranch
    : null;
  const headSha = typeof payload.headSha === 'string' && SHA_RE.test(payload.headSha)
    ? payload.headSha
    : null;
  if (!fullName || (!headSha && !defaultBranch)) return null;
  return {
    repository: fullName,
    ref: headSha ?? defaultBranch!,
    paths: targetPaths(input.targetPaths),
  };
}

function investigationDetails(payload: JsonObject): {
  repository: string;
  ref: string;
  paths: string[];
} | null {
  const repository = isObject(payload.repository) ? payload.repository : null;
  const name = repository && typeof repository.name === 'string' ? repository.name : null;
  const resolved = repository && typeof repository.resolvedRefSha === 'string' && SHA_RE.test(repository.resolvedRefSha)
    ? repository.resolvedRefSha
    : null;
  if (!name || !resolved) return null;
  const files = Array.isArray(payload.files) ? payload.files : [];
  const paths = files
    .map((file) => (isObject(file) && typeof file.path === 'string' ? file.path : null))
    .filter((path): path is string => Boolean(path))
    .slice(0, 6);
  return { repository: name, ref: resolved, paths };
}

export async function handleAgentGuidanceAction(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![CONTEXT_PATH, INVESTIGATION_PATH].includes(pathname)) return null;
  if (request.method !== 'POST') return null;

  let input: JsonObject = {};
  if (pathname === CONTEXT_PATH) {
    try {
      const value: unknown = await request.clone().json();
      if (!isObject(value)) return json({ ok: false, error: 'invalid_json_object' }, 400);
      input = value;
      targetPaths(input.targetPaths);
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_target_paths') {
        return json({ ok: false, error: 'invalid_target_paths' }, 400);
      }
      return json({ ok: false, error: 'invalid_json' }, 400);
    }
  }

  const response = await router.fetch(request, env, ctx);
  if (!response.ok) return response;
  const payload = await responseObject(response);
  if (!payload || payload.ok !== true) return response;

  let details: ReturnType<typeof contextDetails> | ReturnType<typeof investigationDetails>;
  try {
    details = pathname === CONTEXT_PATH
      ? contextDetails(payload, input)
      : investigationDetails(payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_target_paths') {
      return json({ ok: false, error: 'invalid_target_paths' }, 400);
    }
    throw error;
  }
  if (!details) return response;

  const guidance = await loadAgentGuidance(
    details.paths,
    details.ref,
    (path, ref) => githubFile(request, env, details.repository, path, ref),
  );
  return json({ ...payload, agentGuidance: guidance }, response.status);
}

function operationById(document: JsonObject, operationId: string): JsonObject | null {
  if (!isObject(document.paths)) return null;
  for (const path of Object.values(document.paths)) {
    if (!isObject(path)) continue;
    for (const operation of Object.values(path)) {
      if (isObject(operation) && operation.operationId === operationId) return operation;
    }
  }
  return null;
}

function requestProperties(operation: JsonObject): JsonObject | null {
  if (!isObject(operation.requestBody) || !isObject(operation.requestBody.content)) return null;
  const content = operation.requestBody.content;
  const jsonContent = isObject(content['application/json']) ? content['application/json'] : null;
  const schema = jsonContent && isObject(jsonContent.schema) ? jsonContent.schema : null;
  if (!schema || !isObject(schema.properties)) return null;
  return schema.properties;
}

export function addAgentGuidanceOpenApi(document: JsonObject): void {
  const context = operationById(document, 'getRepositoryContext');
  if (context) {
    context.description =
      'Returns default-branch state, root and applicable nested AGENTS.md guidance, open PRs, recent commits and workflow failures for one trvny repository.';
    const properties = requestProperties(context);
    if (properties) {
      properties.targetPaths = {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' },
        description: 'Repository-relative files expected to be touched; used to load applicable nested AGENTS.md scopes.',
      };
    }
  }

  const investigation = operationById(document, 'investigateCode');
  if (investigation) {
    investigation.description =
      'Searches the default-branch code index, fetches matches from an optional branch/tag/SHA snapshot, and returns applicable root/nested AGENTS.md guidance for matched files.';
  }
}
