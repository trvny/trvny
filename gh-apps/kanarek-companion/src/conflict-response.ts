type JsonObject = Record<string, unknown>;

type WorkerFetch = (request: Request) => Promise<Response>;

const SHA_RE = /^[0-9a-f]{40}$/i;
const REPOSITORY_RE = /^trvny\/[A-Za-z0-9_.-]+$/;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function requestObject(request: Request): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function repoPath(repository: string): string {
  return repository.split('/').map(encodeURIComponent).join('/');
}

function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

function validBranch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    value.length <= 240 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    /^[A-Za-z0-9._/-]+$/.test(value)
  );
}

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = '/gpt-actions/github/read';
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

async function actionData(source: Request, path: string, invoke: WorkerFetch): Promise<unknown | null> {
  const response = await invoke(internalReadRequest(source, path));
  if (!response.ok) return null;
  const payload = await responseObject(response);
  return payload?.ok === true ? payload.data ?? null : null;
}

function branchHead(value: unknown): string | null {
  if (!isObject(value) || !isObject(value.object) || typeof value.object.sha !== 'string') return null;
  return SHA_RE.test(value.object.sha) ? value.object.sha.toLowerCase() : null;
}

function conflict(
  payload: JsonObject,
  repository: string,
  branch: string,
  expectedHeadSha: string,
  currentHeadSha: string,
): JsonObject {
  return {
    ...payload,
    conflict: {
      kind: 'stale_snapshot',
      resource: {
        type: 'branch',
        repository,
        ref: branch,
      },
      expected: { headSha: expectedHeadSha.toLowerCase() },
      current: { headSha: currentHeadSha.toLowerCase() },
      changedFields: ['headSha'],
      recovery: 'refresh_context_and_retry',
    },
  };
}

async function enrichBranchHeadChanged(
  request: Request,
  payload: JsonObject,
  input: JsonObject,
  invoke: WorkerFetch,
): Promise<JsonObject | null> {
  const repository = input.repository;
  const branch = input.branch;
  const expectedHeadSha = input.expectedHeadSha;
  if (
    typeof repository !== 'string' ||
    !REPOSITORY_RE.test(repository) ||
    !validBranch(branch) ||
    typeof expectedHeadSha !== 'string' ||
    !SHA_RE.test(expectedHeadSha)
  ) {
    return null;
  }
  const ref = await actionData(
    request,
    `/repos/${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
    invoke,
  );
  const currentHeadSha = branchHead(ref);
  return currentHeadSha
    ? conflict(payload, repository, branch, expectedHeadSha, currentHeadSha)
    : null;
}

async function enrichBaseHeadChanged(
  request: Request,
  payload: JsonObject,
  input: JsonObject,
  invoke: WorkerFetch,
): Promise<JsonObject | null> {
  const repository = input.repository;
  const expectedBaseSha = input.expectedBaseSha;
  if (
    typeof repository !== 'string' ||
    !REPOSITORY_RE.test(repository) ||
    typeof expectedBaseSha !== 'string' ||
    !SHA_RE.test(expectedBaseSha)
  ) {
    return null;
  }
  const repositoryData = await actionData(request, `/repos/${repoPath(repository)}`, invoke);
  if (!isObject(repositoryData) || !validBranch(repositoryData.default_branch)) return null;
  const branch = repositoryData.default_branch;
  const ref = await actionData(
    request,
    `/repos/${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
    invoke,
  );
  const currentHeadSha = branchHead(ref);
  return currentHeadSha
    ? conflict(payload, repository, branch, expectedBaseSha, currentHeadSha)
    : null;
}

export async function enrichConflictResponse(
  request: Request,
  response: Response,
  invoke: WorkerFetch,
): Promise<Response> {
  if (response.status !== 409 || request.method !== 'POST') return response;
  const payload = await responseObject(response);
  const input = await requestObject(request);
  if (!payload || !input || typeof payload.error !== 'string') return response;

  let enriched: JsonObject | null = null;
  try {
    if (payload.error === 'branch_head_changed') {
      enriched = await enrichBranchHeadChanged(request, payload, input, invoke);
    } else if (payload.error === 'base_head_changed') {
      enriched = await enrichBaseHeadChanged(request, payload, input, invoke);
    }
  } catch {
    enriched = null;
  }
  if (!enriched) return response;
  return Response.json(enriched, {
    status: response.status,
    headers: { 'cache-control': 'no-store' },
  });
}
