import { createAppJwt } from './github-app.ts';
import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { loadGremlinPolicy, type LoadedGremlinPolicy } from './policy-actions.ts';
import { releaseComparisonContainsTarget } from './policy-merge-release.ts';
import { repositoryAllowedByPolicy } from './policy-enforcement.ts';
import {
  artifactReleaseSnapshotMatches,
  releaseAssetNameAllowed,
  releaseTagAllowed,
} from './release-actions.ts';
import { extractZipEntry, ZipEntryError, zipEntryPath } from './zip-entry.ts';

export const RELEASE_ENTRY_UPLOAD_PATH = '/gpt-actions/github/releases/assets/upload-entry';

const GITHUB_API = 'https://api.github.com';
const GITHUB_UPLOADS = 'https://uploads.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const READ_PATH = '/gpt-actions/github/read';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;

type Input = {
  repository: string;
  releaseId: number;
  expectedTag: string;
  artifactId: number;
  expectedArtifactName: string;
  expectedArtifactSizeBytes: number;
  expectedWorkflowRunId: number;
  entryPath: string;
  assetName: string;
  label?: string;
};

type GptomekToken = {
  token: string;
  permissions: Record<string, string>;
};

class ReleaseEntryError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'ReleaseEntryError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  });
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ReleaseEntryError(`invalid_${name}`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReleaseEntryError(`invalid_${name}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ReleaseEntryError(`invalid_${name}`);
  }
  return value;
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ReleaseEntryError('repository_not_allowed', 403);
  }
  return value;
}

function inputObject(value: unknown): Input {
  if (!isObject(value)) throw new ReleaseEntryError('invalid_json_object');
  const allowed = new Set([
    'repository',
    'releaseId',
    'expectedTag',
    'artifactId',
    'expectedArtifactName',
    'expectedArtifactSizeBytes',
    'expectedWorkflowRunId',
    'entryPath',
    'assetName',
    'label',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ReleaseEntryError('invalid_release_entry_request');
  }
  const repositoryName = repository(value.repository);
  const expectedTag = requiredText(value.expectedTag, 'expected_tag', 200);
  if (!releaseTagAllowed(expectedTag)) throw new ReleaseEntryError('invalid_expected_tag');
  const outputName = requiredText(value.assetName, 'asset_name', 255);
  if (!releaseAssetNameAllowed(outputName)) throw new ReleaseEntryError('invalid_asset_name');
  const label = value.label === undefined ? undefined : requiredText(value.label, 'label', 255);
  return {
    repository: repositoryName,
    releaseId: positiveInteger(value.releaseId, 'release_id'),
    expectedTag,
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
    assetName: outputName,
    ...(label === undefined ? {} : { label }),
  };
}

async function requestInput(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 32_000) throw new ReleaseEntryError('payload_too_large', 413);
  try {
    return inputObject(text.trim() ? JSON.parse(text) : {});
  } catch (error) {
    if (error instanceof ReleaseEntryError || error instanceof ZipEntryError) throw error;
    throw new ReleaseEntryError('invalid_json');
  }
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

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new ReleaseEntryError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new ReleaseEntryError('invalid_action_response', 502);
  if (!response.ok) {
    throw new ReleaseEntryError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
    );
  }
  return value;
}

async function readData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  const response = await handleGptActions(internalReadRequest(source, path), env, fetcher);
  return (await responseObject(response)).data;
}

function repoPath(repositoryName: string): string {
  return repositoryName.split('/').map(encodeURIComponent).join('/');
}

function tokenHeaders(token: string, contentType = 'application/json'): Headers {
  return new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': contentType,
    'User-Agent': 'gremlin-gpt-actions',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

function permissionAllows(value: unknown, required: 'read' | 'write'): boolean {
  if (value === 'write') return true;
  return required === 'read' && value === 'read';
}

async function gptomekToken(env: GptActionsEnv, fetcher: typeof fetch): Promise<GptomekToken> {
  const appId = requiredText(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredText(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new ReleaseEntryError('invalid_gptomek_installation_id', 503);
  }
  const jwt = await createAppJwt(appId, privateKey);
  const response = await fetcher(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: tokenHeaders(jwt),
  });
  if (!response.ok) throw new ReleaseEntryError('gptomek_token_failed', 502);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReleaseEntryError('invalid_gptomek_token_response', 502);
  }
  if (!isObject(value) || typeof value.token !== 'string' || !isObject(value.permissions)) {
    throw new ReleaseEntryError('invalid_gptomek_token_response', 502);
  }
  const permissions: Record<string, string> = {};
  for (const [name, permission] of Object.entries(value.permissions)) {
    if (typeof permission === 'string') permissions[name] = permission;
  }
  return { token: value.token, permissions };
}

async function downloadArtifactZip(
  token: string,
  repositoryName: string,
  artifactId: number,
  fetcher: typeof fetch,
): Promise<ArrayBuffer> {
  const repo = repoPath(repositoryName);
  const response = await fetcher(`${GITHUB_API}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
    headers: tokenHeaders(token),
    redirect: 'manual',
  });
  if (response.status === 410) throw new ReleaseEntryError('artifact_expired', 409);
  if (response.status === 404) throw new ReleaseEntryError('artifact_download_not_found', 409);

  let archive = response;
  if (response.status === 302) {
    const location = response.headers.get('location');
    if (!location) throw new ReleaseEntryError('invalid_artifact_download_redirect', 502);
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new ReleaseEntryError('invalid_artifact_download_redirect', 502);
    }
    if (target.protocol !== 'https:' || target.username || target.password) {
      throw new ReleaseEntryError('invalid_artifact_download_redirect', 502);
    }
    archive = await fetcher(target, {
      headers: { 'User-Agent': 'gremlin-gpt-actions' },
      redirect: 'follow',
    });
  }
  if (!archive.ok) throw new ReleaseEntryError('artifact_download_failed', 502);
  const contentLength = Number(archive.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new ReleaseEntryError('artifact_too_large_for_entry_extraction', 413);
  }
  const bytes = await archive.arrayBuffer();
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ReleaseEntryError('artifact_too_large_for_entry_extraction', 413);
  }
  return bytes;
}

function releaseAssets(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new ReleaseEntryError('invalid_release_assets_response', 502);
  return value.filter(isObject);
}

function verifyRelease(value: unknown, input: Input): JsonObject {
  if (!isObject(value) || value.id !== input.releaseId || value.tag_name !== input.expectedTag) {
    throw new ReleaseEntryError('release_snapshot_changed', 409);
  }
  if (value.immutable === true) throw new ReleaseEntryError('release_is_immutable', 409);
  return value;
}

async function releaseTarget(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  input: Input,
  release: JsonObject,
): Promise<string> {
  const ref = release.draft === true ? release.target_commitish : input.expectedTag;
  if (typeof ref !== 'string' || !ref) throw new ReleaseEntryError('invalid_release_target', 502);
  const commit = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(input.repository)}/commits/${encodeURIComponent(ref)}`,
  );
  if (!isObject(commit) || typeof commit.sha !== 'string' || !SHA_RE.test(commit.sha)) {
    throw new ReleaseEntryError('invalid_release_target', 502);
  }
  return commit.sha.toLowerCase();
}

async function enforcePolicy(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  input: Input,
  release: JsonObject,
): Promise<{ loaded: LoadedGremlinPolicy; targetSha: string; matchedBranches: string[] }> {
  const loaded = await loadGremlinPolicy(request, env, fetcher);
  if (!repositoryAllowedByPolicy(loaded.policy, input.repository)) {
    throw new ReleaseEntryError('repository_not_allowed_by_policy', 403, {
      repository: input.repository,
    });
  }
  const repositoryRaw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(input.repository)}`,
  );
  if (!isObject(repositoryRaw)) throw new ReleaseEntryError('invalid_repository_response', 502);
  if (loaded.policy.runtime.repositories.skipArchived && repositoryRaw.archived === true) {
    throw new ReleaseEntryError('archived_repository_blocked_by_policy', 403, {
      repository: input.repository,
    });
  }

  const targetSha = await releaseTarget(request, env, fetcher, input, release);
  const matched = await Promise.all(
    loaded.policy.runtime.release.allowedBranches.map(async (branch) => {
      const compare = await readData(
        request,
        env,
        fetcher,
        `/repos/${repoPath(input.repository)}/compare/${encodeURIComponent(targetSha)}...${encodeURIComponent(branch)}`,
      );
      return releaseComparisonContainsTarget(compare, targetSha) ? branch : null;
    }),
  );
  const matchedBranches = matched.filter((branch): branch is string => Boolean(branch));
  if (!matchedBranches.length) {
    throw new ReleaseEntryError('release_target_not_allowed_by_policy', 403, {
      repository: input.repository,
      targetSha,
      allowedBranches: loaded.policy.runtime.release.allowedBranches,
    });
  }
  return { loaded, targetSha, matchedBranches };
}

function contentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (lower.endsWith('.json')) return 'application/json';
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.sha256') ||
    lower.endsWith('.sha256sum') ||
    lower.endsWith('.checksums')
  ) {
    return 'text/plain; charset=utf-8';
  }
  return 'application/octet-stream';
}

async function uploadAsset(
  token: string,
  input: Input,
  bytes: ArrayBuffer,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  const url = new URL(
    `${GITHUB_UPLOADS}/repos/${repoPath(input.repository)}/releases/${input.releaseId}/assets`,
  );
  url.searchParams.set('name', input.assetName);
  if (input.label !== undefined) url.searchParams.set('label', input.label);
  const response = await fetcher(url, {
    method: 'POST',
    headers: tokenHeaders(token, contentType(input.assetName)),
    body: bytes,
  });
  if (response.status === 422) throw new ReleaseEntryError('release_asset_name_conflict', 409);
  if (!response.ok) throw new ReleaseEntryError('release_asset_upload_failed', 502);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReleaseEntryError('invalid_release_asset_response', 502);
  }
  if (!isObject(value) || typeof value.id !== 'number' || value.name !== input.assetName) {
    throw new ReleaseEntryError('invalid_release_asset_response', 502);
  }
  return value;
}

function compactAsset(value: JsonObject): JsonObject {
  return {
    id: typeof value.id === 'number' ? value.id : null,
    name: typeof value.name === 'string' ? value.name : null,
    label: typeof value.label === 'string' ? value.label : null,
    state: typeof value.state === 'string' ? value.state : null,
    contentType: typeof value.content_type === 'string' ? value.content_type : null,
    sizeBytes: typeof value.size === 'number' ? value.size : null,
    digest: typeof value.digest === 'string' ? value.digest : null,
    browserDownloadUrl:
      typeof value.browser_download_url === 'string' ? value.browser_download_url : null,
  };
}

async function uploadEntry(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await requestInput(request);
  if (input.expectedArtifactSizeBytes > MAX_ARCHIVE_BYTES) {
    throw new ReleaseEntryError('artifact_too_large_for_entry_extraction', 413);
  }
  const repo = repoPath(input.repository);
  const [releaseRaw, artifactRaw, assetsRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/releases/${input.releaseId}`),
    readData(request, env, fetcher, `/repos/${repo}/actions/artifacts/${input.artifactId}`),
    readData(request, env, fetcher, `/repos/${repo}/releases/${input.releaseId}/assets?per_page=100`),
  ]);
  const release = verifyRelease(releaseRaw, input);
  if (
    !artifactReleaseSnapshotMatches(
      artifactRaw,
      input.artifactId,
      input.expectedArtifactName,
      input.expectedArtifactSizeBytes,
      input.expectedWorkflowRunId,
    )
  ) {
    throw new ReleaseEntryError('artifact_snapshot_changed', 409);
  }
  const existing = releaseAssets(assetsRaw).find((asset) => asset.name === input.assetName);
  if (existing) {
    return json({ ok: false, error: 'release_asset_exists', asset: compactAsset(existing) }, 409);
  }

  const policy = await enforcePolicy(request, env, fetcher, input, release);
  const installation = await gptomekToken(env, fetcher);
  if (!permissionAllows(installation.permissions.actions, 'read')) {
    throw new ReleaseEntryError('gptomek_actions_read_required', 503);
  }
  if (!permissionAllows(installation.permissions.contents, 'write')) {
    throw new ReleaseEntryError('gptomek_contents_write_required', 503);
  }

  const archive = await downloadArtifactZip(
    installation.token,
    input.repository,
    input.artifactId,
    fetcher,
  );
  const extracted = await extractZipEntry(archive, input.entryPath);
  const uploaded = await uploadAsset(
    installation.token,
    input,
    extracted.bytes,
    fetcher,
  );

  const verifiedRaw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/releases/assets/${uploaded.id}`,
  );
  if (
    !isObject(verifiedRaw) ||
    verifiedRaw.id !== uploaded.id ||
    verifiedRaw.name !== input.assetName ||
    verifiedRaw.size !== extracted.uncompressedSize
  ) {
    throw new ReleaseEntryError('release_asset_verification_failed', 502);
  }

  return json({
    ok: true,
    releaseId: input.releaseId,
    tag: input.expectedTag,
    source: {
      artifactId: input.artifactId,
      artifactName: input.expectedArtifactName,
      workflowRunId: input.expectedWorkflowRunId,
      artifactSizeBytes: input.expectedArtifactSizeBytes,
      entryPath: extracted.path,
      compressedSizeBytes: extracted.compressedSize,
      sizeBytes: extracted.uncompressedSize,
      crc32: extracted.crc32,
      compression: extracted.compression,
    },
    asset: compactAsset(verifiedRaw),
    policyApplied: {
      source: policy.loaded.source,
      autonomy: policy.loaded.policy.model.autonomy,
      operatingMode: policy.loaded.policy.model.operatingMode,
      release: policy.loaded.policy.runtime.release,
      targetSha: policy.targetSha,
      matchedBranches: policy.matchedBranches,
    },
  });
}

export function addReleaseEntryOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[RELEASE_ENTRY_UPLOAD_PATH] = {
    post: {
      operationId: 'uploadArtifactEntryAsReleaseAsset',
      summary: 'Publish one exact file from an Actions artifact ZIP as a release asset',
      description:
        'Validates the release and artifact snapshot, enforces private release policy, extracts one exact bounded ZIP entry with CRC verification, uploads it without overwriting and verifies the created asset.',
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
          description: 'Extracted and uploaded release asset',
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        },
      },
    },
  };
}

export async function handleReleaseEntryAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== RELEASE_ENTRY_UPLOAD_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await uploadEntry(request, env, fetcher);
  } catch (error) {
    if (error instanceof ReleaseEntryError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    if (error instanceof ZipEntryError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(JSON.stringify({
      gptReleaseEntry: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return json({ ok: false, error: 'release_entry_internal_error' }, 500);
  }
}
