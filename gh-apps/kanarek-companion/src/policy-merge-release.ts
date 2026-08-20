import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { handleOperatorAction } from './operator-actions.ts';
import { loadGremlinPolicy, type LoadedGremlinPolicy } from './policy-actions.ts';
import { repositoryAllowedByPolicy } from './policy-enforcement.ts';
import { handleReleaseAction, releaseTagAllowed } from './release-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const FINALIZE_PATH = '/gpt-actions/github/pull-requests/finalize';
const RELEASE_PATH = '/gpt-actions/github/releases/manage';
const RELEASE_ASSET_UPLOAD_PATH = '/gpt-actions/github/releases/assets/upload-artifact';
const RELEASE_ASSET_DELETE_PATH = '/gpt-actions/github/releases/assets/delete';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;
type MergeMethod = 'merge' | 'squash' | 'rebase';

class MergeReleasePolicyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'MergeReleasePolicyError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function internalRequest(source: Request, pathname: string, body: JsonObject): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function inputObject(request: Request, maxBytes = 160_000): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > maxBytes) throw new MergeReleasePolicyError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new MergeReleasePolicyError('invalid_json');
  }
  if (!isObject(value)) throw new MergeReleasePolicyError('invalid_json_object');
  return value;
}

function repositoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new MergeReleasePolicyError('repository_not_allowed', 403);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new MergeReleasePolicyError(`invalid_${name}`);
  }
  return value;
}

function expectedSha(value: unknown, name = 'expected_head_sha'): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new MergeReleasePolicyError(`invalid_${name}`);
  }
  return value.toLowerCase();
}

function requiredString(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new MergeReleasePolicyError(`invalid_${name}`);
  }
  return value;
}

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new MergeReleasePolicyError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new MergeReleasePolicyError('invalid_action_response', 502);
  if (!response.ok) {
    throw new MergeReleasePolicyError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
    );
  }
  return value;
}

async function readResponse(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<Response> {
  return handleGptActions(internalRequest(source, READ_PATH, { path }), env, fetcher);
}

async function readData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  return (await responseObject(await readResponse(source, env, fetcher, path))).data;
}

function repoPath(repository: string): string {
  return repository.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function policyMetadata(
  loaded: LoadedGremlinPolicy,
  section: 'merge' | 'release',
  extra: JsonObject = {},
): JsonObject {
  return {
    source: loaded.source,
    autonomy: loaded.policy.model.autonomy,
    operatingMode: loaded.policy.model.operatingMode,
    [section]: loaded.policy.runtime[section],
    ...extra,
  };
}

async function decorateResponse(
  response: Response,
  loaded: LoadedGremlinPolicy,
  section: 'merge' | 'release',
  extra: JsonObject = {},
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!isObject(payload)) return response;
  return json(
    {
      ...payload,
      policyApplied: policyMetadata(loaded, section, extra),
    },
    response.status,
  );
}

async function enforceRepositoryPolicy(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  loaded: LoadedGremlinPolicy,
  repository: string,
): Promise<void> {
  if (!repositoryAllowedByPolicy(loaded.policy, repository)) {
    throw new MergeReleasePolicyError('repository_not_allowed_by_policy', 403, { repository });
  }
  const raw = await readData(request, env, fetcher, `/repos/${repoPath(repository)}`);
  if (!isObject(raw)) throw new MergeReleasePolicyError('invalid_repository_response', 502);
  if (loaded.policy.runtime.repositories.skipArchived && raw.archived === true) {
    throw new MergeReleasePolicyError('archived_repository_blocked_by_policy', 403, { repository });
  }
}

export function mergeMethodAllowedByPolicy(
  policyMethod: MergeMethod,
  requested: unknown,
): { allowed: boolean; method: MergeMethod } {
  if (requested === undefined) return { allowed: true, method: policyMethod };
  if (requested !== 'merge' && requested !== 'squash' && requested !== 'rebase') {
    return { allowed: false, method: policyMethod };
  }
  return { allowed: requested === policyMethod, method: policyMethod };
}

export function releaseComparisonContainsTarget(value: unknown, targetSha: string): boolean {
  if (!isObject(value)) return false;
  const mergeBase = isObject(value.merge_base_commit) ? value.merge_base_commit : {};
  const mergeBaseSha = typeof mergeBase.sha === 'string' ? mergeBase.sha.toLowerCase() : '';
  return (
    mergeBaseSha === targetSha.toLowerCase() &&
    (value.status === 'ahead' || value.status === 'identical')
  );
}

async function allowedReleaseBranches(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
  targetSha: string,
  branches: string[],
): Promise<string[]> {
  const repo = repoPath(repository);
  const matches = await Promise.all(
    branches.map(async (branch) => {
      const path = `/repos/${repo}/compare/${encodeURIComponent(targetSha)}...${encodeURIComponent(branch)}`;
      const response = await readResponse(request, env, fetcher, path);
      if (response.status === 404) return null;
      const compare = (await responseObject(response)).data;
      return releaseComparisonContainsTarget(compare, targetSha) ? branch : null;
    }),
  );
  return matches.filter((branch): branch is string => Boolean(branch));
}

async function enforceReleaseTarget(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  loaded: LoadedGremlinPolicy,
  repository: string,
  targetSha: string,
): Promise<string[]> {
  const branches = loaded.policy.runtime.release.allowedBranches;
  const matched = await allowedReleaseBranches(
    request,
    env,
    fetcher,
    repository,
    targetSha,
    branches,
  );
  if (!matched.length) {
    throw new MergeReleasePolicyError('release_target_not_allowed_by_policy', 403, {
      repository,
      targetSha,
      allowedBranches: branches,
    });
  }
  return matched;
}

async function policyFinalizePullRequest(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const [input, loaded] = await Promise.all([
    inputObject(request, 32_000),
    loadGremlinPolicy(request, env, fetcher),
  ]);
  const repository = repositoryName(input.repository);
  positiveInteger(input.pullRequestNumber, 'pull_request_number');
  expectedSha(input.expectedHeadSha);
  await enforceRepositoryPolicy(request, env, fetcher, loaded, repository);

  const merge = loaded.policy.runtime.merge;
  if (!merge.enabled) {
    throw new MergeReleasePolicyError('merge_disabled_by_policy', 403, { repository });
  }
  const method = mergeMethodAllowedByPolicy(merge.method, input.mergeMethod);
  if (!method.allowed) {
    throw new MergeReleasePolicyError('merge_method_not_allowed_by_policy', 403, {
      requested: input.mergeMethod ?? null,
      required: method.method,
    });
  }

  const response = await handleOperatorAction(
    internalRequest(request, FINALIZE_PATH, { ...input, mergeMethod: method.method }),
    env,
    fetcher,
  );
  if (!response) throw new MergeReleasePolicyError('action_route_missing', 500);
  return decorateResponse(response, loaded, 'merge', {
    hardSafetyFloor: {
      expectedHeadSha: true,
      greenCi: true,
      noActionableReviews: true,
      note: 'Runtime hard guards may be stricter than policy and are never relaxed by it.',
    },
  });
}

async function releaseTargetFromSnapshot(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
  releaseId: number,
  expectedTag: string,
): Promise<string> {
  const repo = repoPath(repository);
  const release = await readData(request, env, fetcher, `/repos/${repo}/releases/${releaseId}`);
  if (!isObject(release) || release.id !== releaseId || release.tag_name !== expectedTag) {
    throw new MergeReleasePolicyError('release_snapshot_changed', 409);
  }
  const ref = release.draft === true ? release.target_commitish : expectedTag;
  if (typeof ref !== 'string' || !ref) {
    throw new MergeReleasePolicyError('invalid_release_target', 502);
  }
  const commit = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/commits/${encodeURIComponent(ref)}`,
  );
  if (!isObject(commit) || typeof commit.sha !== 'string' || !SHA_RE.test(commit.sha)) {
    throw new MergeReleasePolicyError('invalid_release_target', 502);
  }
  return commit.sha.toLowerCase();
}

async function policyReleaseAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  pathname: string,
): Promise<Response> {
  const [input, loaded] = await Promise.all([
    inputObject(request),
    loadGremlinPolicy(request, env, fetcher),
  ]);
  const repository = repositoryName(input.repository);
  await enforceRepositoryPolicy(request, env, fetcher, loaded, repository);

  let targetSha: string;
  if (pathname === RELEASE_PATH) {
    if (loaded.policy.runtime.release.requireExpectedTargetSha) {
      targetSha = expectedSha(input.targetSha, 'target_sha');
    } else {
      targetSha = expectedSha(input.targetSha, 'target_sha');
    }
  } else {
    const releaseId = positiveInteger(input.releaseId, 'release_id');
    const expectedTag = requiredString(input.expectedTag, 'expected_tag', 200);
    if (!releaseTagAllowed(expectedTag)) {
      throw new MergeReleasePolicyError('invalid_expected_tag');
    }
    targetSha = await releaseTargetFromSnapshot(
      request,
      env,
      fetcher,
      repository,
      releaseId,
      expectedTag,
    );
  }

  const matchedBranches = await enforceReleaseTarget(
    request,
    env,
    fetcher,
    loaded,
    repository,
    targetSha,
  );

  const response = await handleReleaseAction(
    internalRequest(request, pathname, input),
    env,
    fetcher,
  );
  if (!response) throw new MergeReleasePolicyError('action_route_missing', 500);
  return decorateResponse(response, loaded, 'release', { targetSha, matchedBranches });
}

export async function handleMergeReleasePolicyAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    pathname !== FINALIZE_PATH &&
    pathname !== RELEASE_PATH &&
    pathname !== RELEASE_ASSET_UPLOAD_PATH &&
    pathname !== RELEASE_ASSET_DELETE_PATH
  ) {
    return null;
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (pathname === FINALIZE_PATH) {
      return await policyFinalizePullRequest(request, env, fetcher);
    }
    return await policyReleaseAction(request, env, fetcher, pathname);
  } catch (error) {
    if (error instanceof MergeReleasePolicyError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    console.error(
      JSON.stringify({
        gptMergeReleasePolicy: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'merge_release_policy_internal_error' }, 500);
  }
}
