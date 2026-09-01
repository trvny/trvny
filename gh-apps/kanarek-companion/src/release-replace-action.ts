import { createAppJwt } from './github-app.ts';
import type { GptActionsEnv } from './gpt-actions.ts';
import { handleReleaseEntryAction } from './release-entry-action.ts';
import {
  artifactReleaseSnapshotMatches,
  releaseAssetNameAllowed,
  releaseAssetSnapshotMatches,
  releaseTagAllowed,
} from './release-actions.ts';
import { extractZipEntry, zipEntryPath } from './zip-entry.ts';

export const RELEASE_ASSET_REPLACE_PATH = '/gpt-actions/github/releases/assets/replace-entry';

const READ_PATH = '/gpt-actions/github/read';
const DELETE_PATH = '/gpt-actions/github/releases/assets/delete';
const ENTRY_UPLOAD_PATH = '/gpt-actions/github/releases/assets/upload-entry';
const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

type JsonObject = Record<string, unknown>;
type Env = GptActionsEnv;
type Dispatch = (request: Request) => Promise<Response>;

type Input = {
  repository: string;
  releaseId: number;
  expectedTag: string;
  oldAssetId: number;
  expectedOldSizeBytes: number;
  artifactId: number;
  expectedArtifactName: string;
  expectedArtifactSizeBytes: number;
  expectedWorkflowRunId: number;
  entryPath: string;
  assetName: string;
  label?: string;
};

class ReplaceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'ReplaceError';
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

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ReplaceError(`invalid_${name}`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReplaceError(`invalid_${name}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ReplaceError(`invalid_${name}`);
  }
  return value;
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ReplaceError('repository_not_allowed', 403);
  }
  return value;
}

export function replacementNamesMatch(oldName: unknown, newName: unknown): boolean {
  return (
    releaseAssetNameAllowed(oldName) &&
    releaseAssetNameAllowed(newName) &&
    oldName === newName
  );
}

function inputObject(value: unknown): Input {
  if (!isObject(value)) throw new ReplaceError('invalid_json_object');
  const allowed = new Set([
    'repository',
    'releaseId',
    'expectedTag',
    'oldAssetId',
    'expectedOldSizeBytes',
    'artifactId',
    'expectedArtifactName',
    'expectedArtifactSizeBytes',
    'expectedWorkflowRunId',
    'entryPath',
    'assetName',
    'label',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ReplaceError('invalid_release_asset_replace_request');
  }
  const assetName = requiredText(value.assetName, 'asset_name', 255);
  if (!releaseAssetNameAllowed(assetName)) throw new ReplaceError('invalid_asset_name');
  const expectedTag = requiredText(value.expectedTag, 'expected_tag', 200);
  if (!releaseTagAllowed(expectedTag)) throw new ReplaceError('invalid_expected_tag');
  const label = value.label === undefined ? undefined : requiredText(value.label, 'label', 255);
  return {
    repository: repository(value.repository),
    releaseId: positiveInteger(value.releaseId, 'release_id'),
    expectedTag,
    oldAssetId: positiveInteger(value.oldAssetId, 'old_asset_id'),
    expectedOldSizeBytes: nonNegativeInteger(value.expectedOldSizeBytes, 'expected_old_size_bytes'),
    artifactId: positiveInteger(value.artifactId, 'artifact_id'),
    expectedArtifactName: requiredText(value.expectedArtifactName, 'expected_artifact_name', 255),
    expectedArtifactSizeBytes: nonNegativeInteger(
      value.expectedArtifactSizeBytes,
      'expected_artifact_size_bytes',
    ),
    expectedWorkflowRunId: positiveInteger(
      value.expectedWorkflowRunId,
      'expected_workflow_run_id',
    ),
    entryPath: zipEntryPath(value.entryPath),
    assetName,
    ...(label === undefined ? {} : { label }),
  };
}

async function requestInput(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 32_000) throw new ReplaceError('payload_too_large', 413);
  try {
    return inputObject(text.trim() ? JSON.parse(text) : {});
  } catch (error) {
    if (error instanceof ReplaceError) throw error;
    throw new ReplaceError('invalid_json');
  }
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
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new ReplaceError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new ReplaceError('invalid_action_response', 502);
  return value;
}

async function actionObject(response: Response): Promise<JsonObject> {
  const value = await responseObject(response);
  if (!response.ok) {
    throw new ReplaceError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
      { action: value },
    );
  }
  return value;
}

async function readData(
  source: Request,
  dispatch: Dispatch,
  path: string,
): Promise<unknown> {
  const response = await dispatch(internalRequest(source, READ_PATH, { path }));
  return (await actionObject(response)).data;
}

function repoPath(repositoryName: string): string {
  return repositoryName.split('/').map(encodeURIComponent).join('/');
}

function tokenHeaders(token: string): Headers {
  return new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'gremlin-gpt-actions',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

async function gptomekToken(env: Env, fetcher: typeof fetch): Promise<string> {
  const appId = requiredText(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredText(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new ReplaceError('invalid_gptomek_installation_id', 503);
  }
  const jwt = await createAppJwt(appId, privateKey);
  const response = await fetcher(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: tokenHeaders(jwt),
  });
  if (!response.ok) throw new ReplaceError('gptomek_token_failed', 502);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReplaceError('invalid_gptomek_token_response', 502);
  }
  if (!isObject(value) || typeof value.token !== 'string') {
    throw new ReplaceError('invalid_gptomek_token_response', 502);
  }
  const permissions = isObject(value.permissions) ? value.permissions : {};
  if (permissions.actions !== 'read' && permissions.actions !== 'write') {
    throw new ReplaceError('gptomek_actions_read_required', 503);
  }
  return value.token;
}

async function downloadArtifactZip(
  token: string,
  input: Input,
  fetcher: typeof fetch,
): Promise<ArrayBuffer> {
  const url = `${GITHUB_API}/repos/${repoPath(input.repository)}/actions/artifacts/${input.artifactId}/zip`;
  const response = await fetcher(url, { headers: tokenHeaders(token), redirect: 'manual' });
  if (response.status === 410) throw new ReplaceError('artifact_expired', 409);
  if (response.status === 404) throw new ReplaceError('artifact_download_not_found', 409);
  let archive = response;
  if (response.status === 302) {
    const location = response.headers.get('location');
    if (!location) throw new ReplaceError('invalid_artifact_download_redirect', 502);
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new ReplaceError('invalid_artifact_download_redirect', 502);
    }
    if (target.protocol !== 'https:' || target.username || target.password) {
      throw new ReplaceError('invalid_artifact_download_redirect', 502);
    }
    archive = await fetcher(target, {
      headers: { 'User-Agent': 'gremlin-gpt-actions' },
      redirect: 'follow',
    });
  }
  if (!archive.ok) throw new ReplaceError('artifact_download_failed', 502);
  const declared = Number(archive.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new ReplaceError('artifact_too_large_for_entry_extraction', 413);
  }
  const bytes = await archive.arrayBuffer();
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ReplaceError('artifact_too_large_for_entry_extraction', 413);
  }
  return bytes;
}

async function verifySnapshots(source: Request, dispatch: Dispatch, input: Input): Promise<void> {
  const repo = repoPath(input.repository);
  const [release, oldAsset, artifact] = await Promise.all([
    readData(source, dispatch, `/repos/${repo}/releases/${input.releaseId}`),
    readData(source, dispatch, `/repos/${repo}/releases/assets/${input.oldAssetId}`),
    readData(source, dispatch, `/repos/${repo}/actions/artifacts/${input.artifactId}`),
  ]);
  if (!isObject(release) || release.id !== input.releaseId || release.tag_name !== input.expectedTag) {
    throw new ReplaceError('release_snapshot_changed', 409);
  }
  if (release.immutable === true) throw new ReplaceError('release_is_immutable', 409);
  if (
    !releaseAssetSnapshotMatches(
      oldAsset,
      input.oldAssetId,
      input.assetName,
      input.expectedOldSizeBytes,
    )
  ) {
    throw new ReplaceError('release_asset_snapshot_changed', 409);
  }
  if (
    !artifactReleaseSnapshotMatches(
      artifact,
      input.artifactId,
      input.expectedArtifactName,
      input.expectedArtifactSizeBytes,
      input.expectedWorkflowRunId,
    )
  ) {
    throw new ReplaceError('artifact_snapshot_changed', 409);
  }
}

async function replaceAsset(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
  dispatch: Dispatch,
): Promise<Response> {
  const input = await requestInput(request);
  await verifySnapshots(request, dispatch, input);

  const token = await gptomekToken(env, fetcher);
  const archive = await downloadArtifactZip(token, input, fetcher);
  const prepared = await extractZipEntry(archive, input.entryPath);

  const deleted = await dispatch(
    internalRequest(request, DELETE_PATH, {
      repository: input.repository,
      releaseId: input.releaseId,
      expectedTag: input.expectedTag,
      assetId: input.oldAssetId,
      expectedName: input.assetName,
      expectedSizeBytes: input.expectedOldSizeBytes,
    }),
  );
  const deletedPayload = await actionObject(deleted);

  const uploadRequest = internalRequest(request, ENTRY_UPLOAD_PATH, {
    repository: input.repository,
    releaseId: input.releaseId,
    expectedTag: input.expectedTag,
    artifactId: input.artifactId,
    expectedArtifactName: input.expectedArtifactName,
    expectedArtifactSizeBytes: input.expectedArtifactSizeBytes,
    expectedWorkflowRunId: input.expectedWorkflowRunId,
    entryPath: input.entryPath,
    assetName: input.assetName,
    ...(input.label === undefined ? {} : { label: input.label }),
  });
  const uploaded = await handleReleaseEntryAction(uploadRequest, env, fetcher);
  if (!uploaded) {
    return json({
      ok: false,
      error: 'replacement_upload_route_missing',
      recoveryRequired: true,
      oldAssetDeleted: true,
      preparedSource: {
        entryPath: prepared.path,
        sizeBytes: prepared.uncompressedSize,
        crc32: prepared.crc32,
      },
    }, 500);
  }
  const uploadPayload = await responseObject(uploaded);
  if (!uploaded.ok) {
    return json({
      ok: false,
      error: 'replacement_upload_failed_after_delete',
      recoveryRequired: true,
      oldAssetDeleted: true,
      preparedSource: {
        entryPath: prepared.path,
        sizeBytes: prepared.uncompressedSize,
        crc32: prepared.crc32,
      },
      upload: uploadPayload,
      delete: deletedPayload,
    }, uploaded.status >= 400 && uploaded.status < 600 ? uploaded.status : 502);
  }

  return json({
    ok: true,
    replaced: true,
    oldAssetId: input.oldAssetId,
    preparedSource: {
      entryPath: prepared.path,
      sizeBytes: prepared.uncompressedSize,
      crc32: prepared.crc32,
      compression: prepared.compression,
    },
    delete: deletedPayload,
    upload: uploadPayload,
  });
}

export function addReleaseReplaceOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[RELEASE_ASSET_REPLACE_PATH] = {
    post: {
      operationId: 'replaceReleaseAssetSafely',
      summary: 'Replace one exact release asset with one exact artifact entry',
      description:
        'Preflights the exact release, old asset, artifact and ZIP entry before deleting anything, then uses guarded exact deletion and guarded exact-entry upload. If upload fails after deletion, reports explicit recovery-required state.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: [
                'repository',
                'releaseId',
                'expectedTag',
                'oldAssetId',
                'expectedOldSizeBytes',
                'artifactId',
                'expectedArtifactName',
                'expectedArtifactSizeBytes',
                'expectedWorkflowRunId',
                'entryPath',
                'assetName',
              ],
              properties: {
                repository: { type: 'string', example: 'twojstar/kanarek' },
                releaseId: { type: 'integer', minimum: 1 },
                expectedTag: { type: 'string' },
                oldAssetId: { type: 'integer', minimum: 1 },
                expectedOldSizeBytes: { type: 'integer', minimum: 0 },
                artifactId: { type: 'integer', minimum: 1 },
                expectedArtifactName: { type: 'string' },
                expectedArtifactSizeBytes: { type: 'integer', minimum: 0 },
                expectedWorkflowRunId: { type: 'integer', minimum: 1 },
                entryPath: { type: 'string', example: 'app-release.apk' },
                assetName: { type: 'string', example: 'kanarek.apk' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Release asset replaced and verified',
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        },
        '409': {
          description: 'Exact snapshot conflict or replacement recovery required',
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        },
      },
    },
  };
}

export async function handleReleaseReplaceAction(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
  dispatch: Dispatch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== RELEASE_ASSET_REPLACE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await replaceAsset(request, env, fetcher, dispatch);
  } catch (error) {
    if (error instanceof ReplaceError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    console.error(JSON.stringify({
      gptReleaseReplace: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return json({ ok: false, error: 'release_replace_internal_error' }, 500);
  }
}
