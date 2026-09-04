import {
  autopilotInputHash,
  checkpointCall,
  operationIdAllowed,
  type AutopilotCheckpointEnv,
} from './autopilot-checkpoint.ts';
import { handleGptActions } from './gpt-actions.ts';
import {
  handleMergeReleasePolicyAction,
  releaseComparisonContainsTarget,
} from './policy-merge-release.ts';
import { loadGremlinPolicy } from './policy-actions.ts';
import { repositoryAllowedByPolicy } from './policy-enforcement.ts';
import { handleReleaseEntryAction, RELEASE_ENTRY_UPLOAD_PATH } from './release-entry-action.ts';
import { releaseAssetNameAllowed, releaseTagAllowed } from './release-actions.ts';
import {
  handleWorkflowAction,
  workflowDispatchInputs,
  workflowIdentifierAllowed,
  workflowRefAllowed,
} from './workflow-actions.ts';
import { handleEnhancedWorkflowDiagnosis } from './workflow-diagnosis-enhanced.ts';
import { zipEntryPath, ZipEntryError } from './zip-entry.ts';

export const RELEASE_ORCHESTRATION_PATH = '/gpt-actions/operator/releases/orchestrate';

const READ_PATH = '/gpt-actions/github/read';
const WORKFLOW_DISPATCH_PATH = '/gpt-actions/github/workflows/dispatch';
const WORKFLOW_DIAGNOSE_PATH = '/gpt-actions/github/workflows/diagnose';
const RELEASE_PATH = '/gpt-actions/github/releases/manage';
const RELEASE_ASSET_UPLOAD_PATH = '/gpt-actions/github/releases/assets/upload-artifact';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_BASELINE_RUNS = 30;
const DISCOVERY_ATTEMPTS = 4;
const DISCOVERY_DELAY_MS = 1_000;
const WORKFLOW_POLL_ATTEMPTS = 4;
const WORKFLOW_POLL_DELAY_MS = 2_500;
const RUN_TIMESTAMP_SKEW_MS = 5_000;

type JsonObject = Record<string, unknown>;
type RefKind = 'branch' | 'tag';
type MakeLatest = 'true' | 'false' | 'legacy';
type Stage =
  | 'prepared'
  | 'dispatched'
  | 'waiting_workflow'
  | 'release_prepared'
  | 'release_ready'
  | 'asset_prepared'
  | 'asset_uploaded';

interface ReleaseInput {
  operationId: string;
  repository: string;
  workflow: string;
  ref: string;
  workflowInputs: Record<string, string>;
  tag: string;
  artifactName: string;
  artifactEntryPath?: string;
  assetName: string;
  assetLabel?: string;
  releaseName?: string;
  releaseBody?: string;
  draft?: boolean;
  prerelease?: boolean;
  generateReleaseNotes: boolean;
  makeLatest?: MakeLatest;
}

interface Progress extends JsonObject {
  stage: Stage;
  repository: string;
  workflow: string;
  workflowId: number;
  ref: string;
  refKind: RefKind;
  targetSha: string;
  baselineRunIds: number[];
  preparedAt: string;
  dispatchedAt?: string;
  runId?: number;
  runAttempt?: number;
  artifact?: {
    id: number;
    name: string;
    sizeBytes: number;
  };
  releaseExistedBefore?: boolean;
  releaseId?: number;
  releaseTag?: string;
  assetPreparedAt?: string;
  assetId?: number;
}

class ReleaseOrchestrationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'ReleaseOrchestrationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(extraHeaders)) },
  });
}

function repositoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ReleaseOrchestrationError('repository_not_allowed', 403);
  }
  return value;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ReleaseOrchestrationError(`invalid_${name}`);
  }
  return value;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new ReleaseOrchestrationError(`invalid_${name}`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ReleaseOrchestrationError(`invalid_${name}`);
  return value;
}

function makeLatest(value: unknown): MakeLatest | undefined {
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false' && value !== 'legacy') {
    throw new ReleaseOrchestrationError('invalid_make_latest');
  }
  return value;
}

export function releaseArtifactEntryPath(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return zipEntryPath(value);
  } catch (error) {
    if (error instanceof ZipEntryError) {
      throw new ReleaseOrchestrationError(error.code, error.status);
    }
    throw error;
  }
}

export function releaseAssetUploadPath(entryPath?: string): string {
  return entryPath ? RELEASE_ENTRY_UPLOAD_PATH : RELEASE_ASSET_UPLOAD_PATH;
}

async function parseInput(
  request: Request,
): Promise<{ input: ReleaseInput; hashInput: JsonObject; inputHash: string }> {
  const text = await request.clone().text();
  if (text.length > 120_000) throw new ReleaseOrchestrationError('payload_too_large', 413);
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ReleaseOrchestrationError('invalid_json');
  }
  if (!isObject(raw)) throw new ReleaseOrchestrationError('invalid_json_object');
  const allowed = new Set([
    'operationId',
    'repository',
    'workflow',
    'ref',
    'inputs',
    'tag',
    'artifactName',
    'artifactEntryPath',
    'assetName',
    'assetLabel',
    'releaseName',
    'releaseBody',
    'draft',
    'prerelease',
    'generateReleaseNotes',
    'makeLatest',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new ReleaseOrchestrationError('invalid_release_orchestration_request');
  }

  if (!operationIdAllowed(raw.operationId)) {
    throw new ReleaseOrchestrationError('invalid_operation_id');
  }
  const repository = repositoryName(raw.repository);
  if (!workflowIdentifierAllowed(raw.workflow)) {
    throw new ReleaseOrchestrationError('invalid_workflow');
  }
  if (!workflowRefAllowed(raw.ref)) throw new ReleaseOrchestrationError('invalid_ref');
  if (!releaseTagAllowed(raw.tag)) throw new ReleaseOrchestrationError('invalid_tag');
  const artifactName = requiredText(raw.artifactName, 'artifact_name', 255);
  if (!releaseAssetNameAllowed(raw.assetName)) {
    throw new ReleaseOrchestrationError('invalid_asset_name');
  }
  const workflowInputs = workflowDispatchInputs(raw.inputs);
  const generateReleaseNotes = raw.generateReleaseNotes === undefined ? false : raw.generateReleaseNotes;
  if (typeof generateReleaseNotes !== 'boolean') {
    throw new ReleaseOrchestrationError('invalid_generate_release_notes');
  }

  const input: ReleaseInput = {
    operationId: raw.operationId,
    repository,
    workflow: raw.workflow,
    ref: raw.ref,
    workflowInputs,
    tag: raw.tag,
    artifactName,
    artifactEntryPath: releaseArtifactEntryPath(raw.artifactEntryPath),
    assetName: raw.assetName,
    assetLabel: optionalText(raw.assetLabel, 'asset_label', 255),
    releaseName: optionalText(raw.releaseName, 'release_name', 500),
    releaseBody: optionalText(raw.releaseBody, 'release_body', 65_000),
    draft: optionalBoolean(raw.draft, 'draft'),
    prerelease: optionalBoolean(raw.prerelease, 'prerelease'),
    generateReleaseNotes,
    makeLatest: makeLatest(raw.makeLatest),
  };
  const hashInput = { ...raw };
  delete hashInput.operationId;
  return { input, hashInput, inputHash: await autopilotInputHash(hashInput) };
}

function repoPath(repository: string): string {
  return repository.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function refPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
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

async function responseObject(response: Response): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new ReleaseOrchestrationError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new ReleaseOrchestrationError('invalid_action_response', 502);
  if (!response.ok) {
    throw new ReleaseOrchestrationError(
      typeof payload.error === 'string' ? payload.error : 'action_failed',
      response.status,
      payload,
    );
  }
  return payload;
}

async function readResponse(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<Response> {
  return handleGptActions(internalRequest(request, READ_PATH, { path }), env, fetcher);
}

async function readData(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  return (await responseObject(await readResponse(request, env, fetcher, path))).data;
}

async function optionalReadData(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown | null> {
  const response = await readResponse(request, env, fetcher, path);
  if (response.status === 404) return null;
  return (await responseObject(response)).data;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTarget(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  ref: string,
): Promise<{ kind: RefKind; sha: string }> {
  const repo = repoPath(repository);
  let kind: RefKind | null = null;
  for (const [candidate, namespace] of [
    ['branch', 'heads'],
    ['tag', 'tags'],
  ] as const) {
    const response = await readResponse(
      request,
      env,
      fetcher,
      `/repos/${repo}/git/ref/${namespace}/${refPath(ref)}`,
    );
    if (response.status === 404) continue;
    await responseObject(response);
    kind = candidate;
    break;
  }
  if (!kind) throw new ReleaseOrchestrationError('workflow_ref_not_found', 404);

  const commit = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/commits/${encodeURIComponent(ref)}`,
  );
  const sha = isObject(commit) ? stringValue(commit.sha) : null;
  if (!sha || !SHA_RE.test(sha)) {
    throw new ReleaseOrchestrationError('invalid_workflow_ref_response', 502);
  }
  return { kind, sha: sha.toLowerCase() };
}

async function validatePolicyTarget(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  targetSha: string,
): Promise<{ source: JsonObject; matchedBranches: string[] }> {
  const loaded = await loadGremlinPolicy(request, env, fetcher);
  if (!repositoryAllowedByPolicy(loaded.policy, repository)) {
    throw new ReleaseOrchestrationError('repository_not_allowed_by_policy', 403);
  }
  const repo = repoPath(repository);
  const metadata = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(metadata)) throw new ReleaseOrchestrationError('invalid_repository_response', 502);
  if (loaded.policy.runtime.repositories.skipArchived && metadata.archived === true) {
    throw new ReleaseOrchestrationError('archived_repository_blocked_by_policy', 403);
  }

  const matchedBranches: string[] = [];
  for (const branch of loaded.policy.runtime.release.allowedBranches) {
    const response = await readResponse(
      request,
      env,
      fetcher,
      `/repos/${repo}/compare/${encodeURIComponent(targetSha)}...${encodeURIComponent(branch)}`,
    );
    if (response.status === 404) continue;
    const compare = (await responseObject(response)).data;
    if (releaseComparisonContainsTarget(compare, targetSha)) matchedBranches.push(branch);
  }
  if (!matchedBranches.length) {
    throw new ReleaseOrchestrationError('release_target_not_allowed_by_policy', 403, {
      repository,
      targetSha,
      allowedBranches: loaded.policy.runtime.release.allowedBranches,
    });
  }
  return { source: loaded.source as unknown as JsonObject, matchedBranches };
}

async function workflowMetadata(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  workflow: string,
): Promise<{ id: number; name: string | null; path: string | null }> {
  const raw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(repository)}/actions/workflows/${encodeURIComponent(workflow)}`,
  );
  if (!isObject(raw) || positiveInteger(raw.id) === null) {
    throw new ReleaseOrchestrationError('invalid_workflow_response', 502);
  }
  if (raw.state !== 'active') throw new ReleaseOrchestrationError('workflow_not_active', 409);
  return { id: raw.id as number, name: stringValue(raw.name), path: stringValue(raw.path) };
}

async function workflowRuns(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  workflowId: number,
): Promise<JsonObject[]> {
  const data = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(repository)}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&per_page=${MAX_BASELINE_RUNS}`,
  );
  if (!isObject(data)) throw new ReleaseOrchestrationError('invalid_workflow_runs_response', 502);
  return objectArray(data.workflow_runs);
}

export function selectDispatchedRun(
  runs: JsonObject[],
  baselineRunIds: number[],
  targetSha: string,
  preparedAt: string,
): JsonObject | null {
  const baseline = new Set(baselineRunIds);
  const preparedEpoch = Date.parse(preparedAt);
  if (!Number.isFinite(preparedEpoch)) {
    throw new ReleaseOrchestrationError('invalid_dispatch_checkpoint_timestamp', 500);
  }
  const candidates = runs.filter((run) => {
    const id = positiveInteger(run.id);
    const actor = isObject(run.actor) ? run.actor.login : null;
    const createdAt = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
    return (
      id !== null &&
      !baseline.has(id) &&
      run.event === 'workflow_dispatch' &&
      actor === 'gptomek[bot]' &&
      Number.isFinite(createdAt) &&
      createdAt >= preparedEpoch - RUN_TIMESTAMP_SKEW_MS &&
      typeof run.head_sha === 'string' &&
      run.head_sha.toLowerCase() === targetSha.toLowerCase()
    );
  });
  if (candidates.length > 1) {
    throw new ReleaseOrchestrationError('ambiguous_dispatched_workflow_run', 409, {
      runIds: candidates.map((run) => run.id),
    });
  }
  return candidates[0] ?? null;
}

async function discoverDispatchedRun(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  progress: Progress,
): Promise<JsonObject | null> {
  for (let attempt = 0; attempt < DISCOVERY_ATTEMPTS; attempt += 1) {
    const run = selectDispatchedRun(
      await workflowRuns(request, env, fetcher, progress.repository, progress.workflowId),
      progress.baselineRunIds,
      progress.targetSha,
      progress.preparedAt,
    );
    if (run) return run;
    if (attempt < DISCOVERY_ATTEMPTS - 1) await sleep(DISCOVERY_DELAY_MS);
  }
  return null;
}

async function workflowRun(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  progress: Progress,
): Promise<JsonObject> {
  if (!progress.runId) throw new ReleaseOrchestrationError('missing_workflow_run_checkpoint', 500);
  const raw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(progress.repository)}/actions/runs/${progress.runId}`,
  );
  if (!isObject(raw) || raw.id !== progress.runId) {
    throw new ReleaseOrchestrationError('invalid_workflow_run_response', 502);
  }
  if (
    typeof raw.head_sha !== 'string' ||
    raw.head_sha.toLowerCase() !== progress.targetSha ||
    raw.event !== 'workflow_dispatch'
  ) {
    throw new ReleaseOrchestrationError('workflow_run_snapshot_changed', 409);
  }
  return raw;
}

async function pollWorkflowRun(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  progress: Progress,
): Promise<JsonObject> {
  let run = await workflowRun(request, env, fetcher, progress);
  for (
    let attempt = 1;
    attempt < WORKFLOW_POLL_ATTEMPTS && run.status !== 'completed';
    attempt += 1
  ) {
    await sleep(WORKFLOW_POLL_DELAY_MS);
    run = await workflowRun(request, env, fetcher, progress);
  }
  return run;
}

export function selectArtifact(artifacts: JsonObject[], expectedName: string): JsonObject | null {
  const candidates = artifacts.filter(
    (artifact) => artifact.name === expectedName && artifact.expired !== true,
  );
  if (candidates.length > 1) {
    throw new ReleaseOrchestrationError('ambiguous_workflow_artifact', 409, {
      artifactIds: candidates.map((artifact) => artifact.id),
    });
  }
  return candidates[0] ?? null;
}

async function artifactSnapshot(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  progress: Progress,
  expectedName: string,
): Promise<{ id: number; name: string; sizeBytes: number }> {
  if (!progress.runId) throw new ReleaseOrchestrationError('missing_workflow_run_checkpoint', 500);
  const data = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(progress.repository)}/actions/runs/${progress.runId}/artifacts?per_page=100`,
  );
  if (!isObject(data)) throw new ReleaseOrchestrationError('invalid_artifacts_response', 502);
  const artifact = selectArtifact(objectArray(data.artifacts), expectedName);
  if (!artifact) {
    throw new ReleaseOrchestrationError('workflow_artifact_not_found', 409, {
      artifactName: expectedName,
    });
  }
  const id = positiveInteger(artifact.id);
  const sizeBytes =
    typeof artifact.size_in_bytes === 'number' &&
    Number.isInteger(artifact.size_in_bytes) &&
    artifact.size_in_bytes >= 0
      ? artifact.size_in_bytes
      : null;
  if (!id || sizeBytes === null) {
    throw new ReleaseOrchestrationError('invalid_artifact_snapshot', 502);
  }
  return { id, name: expectedName, sizeBytes };
}

async function invokeWorkflowDispatch(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  input: ReleaseInput,
): Promise<JsonObject> {
  const response = await handleWorkflowAction(
    internalRequest(request, WORKFLOW_DISPATCH_PATH, {
      repository: input.repository,
      workflow: input.workflow,
      ref: input.ref,
      ...(Object.keys(input.workflowInputs).length ? { inputs: input.workflowInputs } : {}),
    }),
    env,
    fetcher,
  );
  if (!response) throw new ReleaseOrchestrationError('workflow_dispatch_route_missing', 500);
  return responseObject(response);
}

async function invokeRelease(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  input: ReleaseInput,
  progress: Progress,
): Promise<JsonObject> {
  const current = await optionalReadData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(input.repository)}/releases/tags/${encodeURIComponent(input.tag)}`,
  );
  const crashRecoveredCreate = progress.releaseExistedBefore === false && current !== null;
  if (crashRecoveredCreate) {
    const author = isObject(current) && isObject(current.author) ? current.author.login : null;
    if (author !== 'gptomek[bot]') {
      throw new ReleaseOrchestrationError('release_creation_outcome_uncertain', 409, {
        tag: input.tag,
      });
    }
  }
  const response = await handleMergeReleasePolicyAction(
    internalRequest(request, RELEASE_PATH, {
      repository: input.repository,
      tag: input.tag,
      targetSha: progress.targetSha,
      ...(input.releaseName !== undefined ? { name: input.releaseName } : {}),
      ...(input.releaseBody !== undefined ? { body: input.releaseBody } : {}),
      ...(input.draft !== undefined ? { draft: input.draft } : {}),
      ...(input.prerelease !== undefined ? { prerelease: input.prerelease } : {}),
      generateReleaseNotes: crashRecoveredCreate ? false : input.generateReleaseNotes,
      ...(input.makeLatest !== undefined ? { makeLatest: input.makeLatest } : {}),
    }),
    env,
    fetcher,
  );
  if (!response) throw new ReleaseOrchestrationError('release_route_missing', 500);
  return responseObject(response);
}

async function releaseAssets(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  releaseId: number,
): Promise<JsonObject[]> {
  const data = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(repository)}/releases/${releaseId}/assets?per_page=100`,
  );
  if (!Array.isArray(data)) {
    throw new ReleaseOrchestrationError('invalid_release_assets_response', 502);
  }
  return data.filter(isObject);
}

export function releaseAssetRecoveryCandidate(
  assets: JsonObject[],
  name: string,
  preparedAt: string,
): JsonObject | null {
  const preparedEpoch = Date.parse(preparedAt);
  if (!Number.isFinite(preparedEpoch)) return null;
  const matches = assets.filter((asset) => {
    const uploader = isObject(asset.uploader) ? asset.uploader.login : null;
    const created = typeof asset.created_at === 'string' ? Date.parse(asset.created_at) : NaN;
    return (
      asset.name === name &&
      uploader === 'gptomek[bot]' &&
      Number.isFinite(created) &&
      created >= preparedEpoch - RUN_TIMESTAMP_SKEW_MS
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

async function invokeArtifactUpload(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  input: ReleaseInput,
  progress: Progress,
): Promise<JsonObject> {
  if (!progress.releaseId || !progress.runId || !progress.artifact) {
    throw new ReleaseOrchestrationError('incomplete_release_checkpoint', 500);
  }
  const uploadPath = releaseAssetUploadPath(input.artifactEntryPath);
  const uploadRequest = internalRequest(request, uploadPath, {
    repository: input.repository,
    releaseId: progress.releaseId,
    expectedTag: input.tag,
    artifactId: progress.artifact.id,
    expectedArtifactName: progress.artifact.name,
    expectedArtifactSizeBytes: progress.artifact.sizeBytes,
    expectedWorkflowRunId: progress.runId,
    ...(input.artifactEntryPath !== undefined ? { entryPath: input.artifactEntryPath } : {}),
    assetName: input.assetName,
    ...(input.assetLabel !== undefined ? { label: input.assetLabel } : {}),
  });
  const response = input.artifactEntryPath
    ? await handleReleaseEntryAction(uploadRequest, env, fetcher)
    : await handleMergeReleasePolicyAction(uploadRequest, env, fetcher);
  if (!response) throw new ReleaseOrchestrationError('release_asset_route_missing', 500);
  return responseObject(response);
}

async function diagnosis(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  repository: string,
  runId: number,
): Promise<JsonObject | null> {
  const response = await handleEnhancedWorkflowDiagnosis(
    internalRequest(request, WORKFLOW_DIAGNOSE_PATH, { repository, runId }),
    env,
    fetcher,
  );
  if (!response) return null;
  try {
    const value = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function operation(
  operationId: string,
  status: 'paused' | 'complete' | 'in_progress' | 'uncertain',
  extra: JsonObject = {},
): JsonObject {
  return { id: operationId, status, resumable: true, retentionDays: 7, ...extra };
}

async function pause(
  env: AutopilotCheckpointEnv,
  inputHash: string,
  operationId: string,
  progress: Progress,
  body: JsonObject,
): Promise<Response> {
  const stored = await checkpointCall(env, operationId, '/progress', { inputHash, progress });
  if (!stored.response.ok) {
    throw new ReleaseOrchestrationError('checkpoint_progress_failed', 502);
  }
  return json({
    ...body,
    continueAutomatically: true,
    retryAfterSeconds: body.retryAfterSeconds ?? 1,
    operation: operation(operationId, 'paused'),
  });
}

async function complete(
  env: AutopilotCheckpointEnv,
  inputHash: string,
  operationId: string,
  status: number,
  body: JsonObject,
): Promise<Response> {
  const finalBody = { ...body, operation: operation(operationId, 'complete') };
  const stored = await checkpointCall(env, operationId, '/complete', {
    inputHash,
    status,
    body: finalBody,
  });
  if (!stored.response.ok) {
    return json({ ...finalBody, checkpointWarning: 'checkpoint_completion_failed' }, status);
  }
  return json(finalBody, status);
}

function progressFrom(value: unknown): Progress | null {
  if (!isObject(value) || typeof value.stage !== 'string') return null;
  const stage = value.stage as Stage;
  if (
    ![
      'prepared',
      'dispatched',
      'waiting_workflow',
      'release_prepared',
      'release_ready',
      'asset_prepared',
      'asset_uploaded',
    ].includes(stage)
  ) {
    return null;
  }
  if (
    typeof value.repository !== 'string' ||
    typeof value.workflow !== 'string' ||
    positiveInteger(value.workflowId) === null ||
    typeof value.ref !== 'string' ||
    (value.refKind !== 'branch' && value.refKind !== 'tag') ||
    typeof value.targetSha !== 'string' ||
    !SHA_RE.test(value.targetSha) ||
    !Array.isArray(value.baselineRunIds) ||
    !value.baselineRunIds.every((id) => positiveInteger(id) !== null) ||
    typeof value.preparedAt !== 'string'
  ) {
    return null;
  }
  return value as Progress;
}

async function prepare(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  input: ReleaseInput,
  inputHash: string,
): Promise<Response> {
  const target = await resolveTarget(request, env, fetcher, input.repository, input.ref);
  const policy = await validatePolicyTarget(request, env, fetcher, input.repository, target.sha);
  const workflow = await workflowMetadata(request, env, fetcher, input.repository, input.workflow);
  const baseline = await workflowRuns(request, env, fetcher, input.repository, workflow.id);
  const progress: Progress = {
    stage: 'prepared',
    repository: input.repository,
    workflow: input.workflow,
    workflowId: workflow.id,
    ref: input.ref,
    refKind: target.kind,
    targetSha: target.sha,
    baselineRunIds: baseline
      .map((run) => positiveInteger(run.id))
      .filter((id): id is number => id !== null),
    preparedAt: new Date().toISOString(),
  };
  return pause(env, inputHash, input.operationId, progress, {
    ok: true,
    stage: 'prepared',
    nextAction: 'dispatch_workflow',
    target: { ref: input.ref, kind: target.kind, sha: target.sha },
    workflow,
    policyApplied: policy,
  });
}

async function advance(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
  input: ReleaseInput,
  inputHash: string,
  progress: Progress,
): Promise<Response> {
  if (
    progress.repository !== input.repository ||
    progress.workflow !== input.workflow ||
    progress.ref !== input.ref
  ) {
    throw new ReleaseOrchestrationError('checkpoint_input_mismatch', 409);
  }

  if (progress.stage === 'prepared') {
    const already = await discoverDispatchedRun(request, env, fetcher, progress);
    if (already) {
      const runId = positiveInteger(already.id);
      if (!runId) throw new ReleaseOrchestrationError('invalid_workflow_run_response', 502);
      const next: Progress = {
        ...progress,
        stage: 'waiting_workflow',
        runId,
        runAttempt: positiveInteger(already.run_attempt) ?? 1,
      };
      return pause(env, inputHash, input.operationId, next, {
        ok: true,
        stage: 'workflow_identified',
        recovery: { dispatchReplaySuppressed: true },
        workflowRun: {
          id: runId,
          status: already.status ?? null,
          htmlUrl: already.html_url ?? null,
        },
        nextAction: 'wait_for_workflow',
      });
    }

    await invokeWorkflowDispatch(request, env, fetcher, input);
    const next: Progress = {
      ...progress,
      stage: 'dispatched',
      dispatchedAt: new Date().toISOString(),
    };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'dispatched',
      nextAction: 'identify_workflow_run',
    });
  }

  if (progress.stage === 'dispatched') {
    const run = await discoverDispatchedRun(request, env, fetcher, progress);
    if (!run) {
      return pause(env, inputHash, input.operationId, progress, {
        ok: true,
        stage: 'waiting_for_run_registration',
        nextAction: 'identify_workflow_run',
        retryAfterSeconds: 4,
      });
    }
    const runId = positiveInteger(run.id);
    if (!runId) throw new ReleaseOrchestrationError('invalid_workflow_run_response', 502);
    const next: Progress = {
      ...progress,
      stage: 'waiting_workflow',
      runId,
      runAttempt: positiveInteger(run.run_attempt) ?? 1,
    };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'workflow_identified',
      workflowRun: {
        id: runId,
        status: run.status ?? null,
        htmlUrl: run.html_url ?? null,
      },
      nextAction: 'wait_for_workflow',
    });
  }

  if (progress.stage === 'waiting_workflow') {
    const run = await pollWorkflowRun(request, env, fetcher, progress);
    if (run.status !== 'completed') {
      return pause(env, inputHash, input.operationId, progress, {
        ok: true,
        stage: 'waiting_for_workflow',
        workflowRun: {
          id: progress.runId,
          status: run.status ?? null,
          htmlUrl: run.html_url ?? null,
        },
        nextAction: 'wait_for_workflow',
        retryAfterSeconds: 8,
      });
    }
    if (run.conclusion !== 'success') {
      const runId = progress.runId as number;
      return complete(env, inputHash, input.operationId, 409, {
        ok: false,
        error: 'release_workflow_failed',
        stage: 'workflow_failed',
        workflowRun: {
          id: runId,
          conclusion: run.conclusion ?? null,
          htmlUrl: run.html_url ?? null,
        },
        diagnosis: await diagnosis(request, env, fetcher, input.repository, runId),
        continueAutomatically: true,
        nextAction: 'fix_workflow_failure_then_start_new_release_operation',
      });
    }

    const artifact = await artifactSnapshot(request, env, fetcher, progress, input.artifactName);
    const existing = await optionalReadData(
      request,
      env,
      fetcher,
      `/repos/${repoPath(input.repository)}/releases/tags/${encodeURIComponent(input.tag)}`,
    );
    const next: Progress = {
      ...progress,
      stage: 'release_prepared',
      artifact,
      releaseExistedBefore: existing !== null,
    };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'workflow_succeeded',
      workflowRun: {
        id: progress.runId,
        conclusion: 'success',
        htmlUrl: run.html_url ?? null,
      },
      artifact,
      nextAction: 'create_or_update_release',
    });
  }

  if (progress.stage === 'release_prepared') {
    const result = await invokeRelease(request, env, fetcher, input, progress);
    const release = isObject(result.release) ? result.release : null;
    const releaseId = release ? positiveInteger(release.id) : null;
    if (!releaseId) throw new ReleaseOrchestrationError('invalid_release_response', 502);
    const next: Progress = {
      ...progress,
      stage: 'release_ready',
      releaseId,
      releaseTag: input.tag,
    };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'release_ready',
      created: result.created ?? null,
      release,
      policyApplied: result.policyApplied ?? null,
      nextAction: 'prepare_release_asset',
    });
  }

  if (progress.stage === 'release_ready') {
    if (!progress.releaseId) {
      throw new ReleaseOrchestrationError('missing_release_checkpoint', 500);
    }
    const assets = await releaseAssets(request, env, fetcher, input.repository, progress.releaseId);
    const existing = assets.filter((asset) => asset.name === input.assetName);
    if (existing.length) {
      return complete(env, inputHash, input.operationId, 409, {
        ok: false,
        error: 'release_asset_name_conflict',
        stage: 'asset_conflict',
        releaseId: progress.releaseId,
        assetName: input.assetName,
      });
    }
    const next: Progress = {
      ...progress,
      stage: 'asset_prepared',
      assetPreparedAt: new Date().toISOString(),
    };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'asset_prepared',
      nextAction: 'upload_release_asset',
    });
  }

  if (progress.stage === 'asset_prepared') {
    if (!progress.releaseId || !progress.assetPreparedAt) {
      throw new ReleaseOrchestrationError('missing_asset_checkpoint', 500);
    }
    const assets = await releaseAssets(request, env, fetcher, input.repository, progress.releaseId);
    const recovery = releaseAssetRecoveryCandidate(
      assets,
      input.assetName,
      progress.assetPreparedAt,
    );
    let assetId: number | null = recovery ? positiveInteger(recovery.id) : null;
    let recovered = Boolean(assetId);

    if (!assetId) {
      const conflicting = assets.filter((asset) => asset.name === input.assetName);
      if (conflicting.length) {
        return complete(env, inputHash, input.operationId, 409, {
          ok: false,
          error: 'release_asset_upload_outcome_uncertain',
          stage: 'asset_uncertain',
          releaseId: progress.releaseId,
          assetName: input.assetName,
        });
      }
      const result = await invokeArtifactUpload(request, env, fetcher, input, progress);
      const asset = isObject(result.asset) ? result.asset : null;
      assetId = asset ? positiveInteger(asset.id) : null;
      if (!assetId) {
        throw new ReleaseOrchestrationError('invalid_release_asset_response', 502);
      }
      recovered = false;
    }

    const next: Progress = { ...progress, stage: 'asset_uploaded', assetId };
    return pause(env, inputHash, input.operationId, next, {
      ok: true,
      stage: 'asset_uploaded',
      assetId,
      recovery: recovered ? { priorUploadVerified: true, uploadReplaySuppressed: true } : null,
      nextAction: 'verify_release',
    });
  }

  if (!progress.releaseId || !progress.assetId) {
    throw new ReleaseOrchestrationError('incomplete_final_release_checkpoint', 500);
  }
  const repo = repoPath(input.repository);
  const [release, asset] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/releases/${progress.releaseId}`),
    readData(request, env, fetcher, `/repos/${repo}/releases/assets/${progress.assetId}`),
  ]);
  if (!isObject(release) || release.id !== progress.releaseId || release.tag_name !== input.tag) {
    throw new ReleaseOrchestrationError('release_verification_failed', 409);
  }
  if (!isObject(asset) || asset.id !== progress.assetId || asset.name !== input.assetName) {
    throw new ReleaseOrchestrationError('release_asset_verification_failed', 409);
  }
  if (input.makeLatest === 'true') {
    const latest = await readData(request, env, fetcher, `/repos/${repo}/releases/latest`);
    if (!isObject(latest) || latest.tag_name !== input.tag) {
      throw new ReleaseOrchestrationError('latest_release_verification_failed', 409);
    }
  }

  return complete(env, inputHash, input.operationId, 200, {
    ok: true,
    stage: 'complete',
    workflow: {
      id: progress.runId ?? null,
      attempt: progress.runAttempt ?? null,
      targetSha: progress.targetSha,
    },
    release: {
      id: progress.releaseId,
      tag: input.tag,
      htmlUrl: release.html_url ?? null,
      draft: release.draft === true,
      prerelease: release.prerelease === true,
    },
    asset: {
      id: progress.assetId,
      name: input.assetName,
      sizeBytes: typeof asset.size === 'number' ? asset.size : null,
      downloadUrl: asset.browser_download_url ?? null,
    },
    verified: true,
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addReleaseOrchestrationOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[RELEASE_ORCHESTRATION_PATH] = {
    post: {
      operationId: 'orchestrateRelease',
      summary: 'Build and publish a release through guarded GitHub actions',
      description:
        'Runs a resumable release state machine: validate target, dispatch and verify a workflow, select an exact artifact, optionally extract one exact artifact entry, create/update the release, upload the asset and verify final state.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: [
                'operationId',
                'repository',
                'workflow',
                'ref',
                'tag',
                'artifactName',
                'assetName',
              ],
              properties: {
                operationId: {
                  type: 'string',
                  pattern: '^op-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$',
                  description:
                    'Stable ID reused on every continuation call for this release operation.',
                },
                repository: { type: 'string', example: 'trvny/feedseek' },
                workflow: { type: 'string', example: 'release.yml' },
                ref: { type: 'string', example: 'main' },
                inputs: {
                  type: 'object',
                  properties: {},
                  additionalProperties: { type: 'string' },
                },
                tag: { type: 'string', example: 'v1.2.3' },
                artifactName: { type: 'string' },
                artifactEntryPath: {
                  type: 'string',
                  example: 'app-release.apk',
                  description: 'Optional exact ZIP entry to publish instead of the whole artifact archive.',
                },
                assetName: { type: 'string', example: 'app-release.zip' },
                assetLabel: { type: 'string' },
                releaseName: { type: 'string' },
                releaseBody: { type: 'string' },
                draft: { type: 'boolean' },
                prerelease: { type: 'boolean' },
                generateReleaseNotes: { type: 'boolean', default: false },
                makeLatest: { type: 'string', enum: ['true', 'false', 'legacy'] },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Release orchestration progress or completed result'),
        '409': objectResponse('Guarded release orchestration conflict'),
      },
    },
  };
}

export async function handleReleaseOrchestrationAction(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== RELEASE_ORCHESTRATION_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let parsed: Awaited<ReturnType<typeof parseInput>>;
  try {
    parsed = await parseInput(request);
  } catch (error) {
    if (error instanceof ReleaseOrchestrationError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    return json({ ok: false, error: 'invalid_release_orchestration_request' }, 400);
  }

  if (!env.OPERATOR_CHECKPOINTS) {
    return json({ ok: false, error: 'operator_checkpoint_storage_unavailable' }, 503);
  }

  const claim = await checkpointCall(env, parsed.input.operationId, '/claim', {
    operationId: parsed.input.operationId,
    inputHash: parsed.inputHash,
  });
  if (claim.payload.state === 'input_mismatch') {
    return json(
      {
        ok: false,
        error: 'operation_input_mismatch',
        operation: operation(parsed.input.operationId, 'uncertain'),
      },
      409,
    );
  }
  if (claim.payload.state === 'in_progress') {
    const retryAfterSeconds =
      typeof claim.payload.retryAfterSeconds === 'number' ? claim.payload.retryAfterSeconds : 30;
    return json(
      {
        ok: false,
        error: 'operation_in_progress',
        retryAfterSeconds,
        operation: operation(parsed.input.operationId, 'in_progress'),
      },
      409,
      { 'retry-after': String(retryAfterSeconds) },
    );
  }
  if (claim.payload.state === 'complete' && isObject(claim.payload.result)) {
    const status = claim.payload.result.status;
    const body = claim.payload.result.body;
    if (typeof status === 'number' && isObject(body)) {
      return json(
        {
          ...body,
          operation: operation(parsed.input.operationId, 'complete', {
            resumed: true,
            replayed: true,
          }),
        },
        status,
      );
    }
  }
  if (!claim.response.ok && claim.payload.state !== 'recover') {
    return json({ ok: false, error: 'checkpoint_claim_failed' }, 502);
  }

  try {
    const progress = progressFrom(claim.payload.progress);
    if (claim.payload.state === 'recover' && !progress) {
      await checkpointCall(env, parsed.input.operationId, '/uncertain', {
        inputHash: parsed.inputHash,
      });
      return json(
        {
          ok: false,
          error: 'release_operation_recovery_state_missing',
          operation: operation(parsed.input.operationId, 'uncertain', { resumeSafe: false }),
        },
        409,
      );
    }
    return progress
      ? await advance(request, env, fetcher, parsed.input, parsed.inputHash, progress)
      : await prepare(request, env, fetcher, parsed.input, parsed.inputHash);
  } catch (error) {
    const orchestrated =
      error instanceof ReleaseOrchestrationError
        ? error
        : new ReleaseOrchestrationError('release_orchestration_internal_error', 500, {
            detail: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
          });
    const failureBody = {
      ok: false,
      error: orchestrated.code,
      ...orchestrated.details,
    };
    if (orchestrated.status < 500) {
      return complete(
        env,
        parsed.inputHash,
        parsed.input.operationId,
        orchestrated.status,
        failureBody,
      );
    }
    await checkpointCall(env, parsed.input.operationId, '/uncertain', {
      inputHash: parsed.inputHash,
    });
    return json(
      {
        ...failureBody,
        operation: operation(parsed.input.operationId, 'uncertain', { resumeSafe: true }),
      },
      orchestrated.status,
    );
  }
}
