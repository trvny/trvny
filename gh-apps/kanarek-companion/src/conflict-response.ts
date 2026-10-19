import { isObject, type JsonObject, repoPath, repositoryInScope } from './tools/common.ts';
import type { GithubGateway } from './github-gateway.ts';


const SHA_RE = /^[0-9a-f]{40}$/i;

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

// Best effort: any read failure means no enrichment.
async function actionData(github: GithubGateway, path: string): Promise<unknown | null> {
  try {
    return (await github.read(path)) ?? null;
  } catch {
    return null;
  }
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
  payload: JsonObject,
  input: JsonObject,
  github: GithubGateway,
): Promise<JsonObject | null> {
  const repository = input.repository;
  const branch = input.branch;
  const expectedHeadSha = input.expectedHeadSha;
  if (
    typeof repository !== 'string' ||
    !repositoryInScope(repository) ||
    !validBranch(branch) ||
    typeof expectedHeadSha !== 'string' ||
    !SHA_RE.test(expectedHeadSha)
  ) {
    return null;
  }
  const ref = await actionData(github, `/repos/${repoPath(repository)}/git/ref/heads/${refPath(branch)}`);
  const currentHeadSha = branchHead(ref);
  return currentHeadSha
    ? conflict(payload, repository, branch, expectedHeadSha, currentHeadSha)
    : null;
}

async function enrichBaseHeadChanged(
  payload: JsonObject,
  input: JsonObject,
  github: GithubGateway,
): Promise<JsonObject | null> {
  const repository = input.repository;
  const expectedBaseSha = input.expectedBaseSha;
  if (
    typeof repository !== 'string' ||
    !repositoryInScope(repository) ||
    typeof expectedBaseSha !== 'string' ||
    !SHA_RE.test(expectedBaseSha)
  ) {
    return null;
  }
  const repositoryData = await actionData(github, `/repos/${repoPath(repository)}`);
  if (!isObject(repositoryData) || !validBranch(repositoryData.default_branch)) return null;
  const branch = repositoryData.default_branch;
  const ref = await actionData(github, `/repos/${repoPath(repository)}/git/ref/heads/${refPath(branch)}`);
  const currentHeadSha = branchHead(ref);
  return currentHeadSha
    ? conflict(payload, repository, branch, expectedBaseSha, currentHeadSha)
    : null;
}

export async function enrichConflictResponse(
  request: Request,
  response: Response,
  github: GithubGateway,
): Promise<Response> {
  if (response.status !== 409 || request.method !== 'POST') return response;
  const payload = await responseObject(response);
  const input = await requestObject(request);
  if (!payload || !input || typeof payload.error !== 'string') return response;

  let enriched: JsonObject | null = null;
  try {
    if (payload.error === 'branch_head_changed') {
      enriched = await enrichBranchHeadChanged(payload, input, github);
    } else if (payload.error === 'base_head_changed') {
      enriched = await enrichBaseHeadChanged(payload, input, github);
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
