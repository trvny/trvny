import { createAppJwt } from './github-app.ts';
import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_UPLOADS = 'https://uploads.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const RELEASE_PATH = '/gpt-actions/github/releases/manage';
const RELEASE_ASSET_UPLOAD_PATH = '/gpt-actions/github/releases/assets/upload-artifact';
const RELEASE_ASSET_DELETE_PATH = '/gpt-actions/github/releases/assets/delete';
const MAX_RELEASE_ASSET_BYTES = 64 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;
type MakeLatest = 'true' | 'false' | 'legacy';

interface GptomekToken {
  permissions: Record<string, string>;
  token: string;
}

class ReleaseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'ReleaseError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ReleaseError('repository_not_allowed', 403);
  }
  return value;
}

export function releaseTagAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 200) return false;
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[~^:?*\[\\\s]/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part && part !== '.' && !part.endsWith('.lock'));
}

function tag(value: unknown): string {
  if (!releaseTagAllowed(value)) throw new ReleaseError('invalid_tag');
  return value;
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new ReleaseError('invalid_target_sha');
  }
  return value.toLowerCase();
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReleaseError(`invalid_${name}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ReleaseError(`invalid_${name}`);
  }
  return value;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ReleaseError(`invalid_${name}`);
  }
  return value;
}

export function releaseAssetNameAllowed(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 255 &&
    !value.startsWith('.') &&
    !value.endsWith('.') &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)
  );
}

function assetName(value: unknown): string {
  if (!releaseAssetNameAllowed(value)) throw new ReleaseError('invalid_asset_name');
  return value;
}

function repoPath(repositoryName: string): string {
  return repositoryName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function refPath(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
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

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 160_000) throw new ReleaseError('payload_too_large', 413);
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ReleaseError('invalid_json');
  }
  if (!isObject(parsed)) throw new ReleaseError('invalid_json_object');
  return parsed;
}

async function payload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new ReleaseError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new ReleaseError('invalid_action_response', 502);
  if (!response.ok) {
    throw new ReleaseError(typeof value.error === 'string' ? value.error : 'action_failed', response.status);
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
  return (await payload(await readResponse(source, env, fetcher, path))).data;
}

async function botData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  method: string,
  path: string,
  body: JsonObject,
): Promise<unknown> {
  const response = await handleGptActions(
    internalRequest(source, BOT_PATH, { method, path, body }),
    env,
    fetcher,
  );
  return (await payload(response)).data;
}

function textField(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new ReleaseError(`invalid_${name}`);
  return value;
}

function booleanField(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ReleaseError(`invalid_${name}`);
  return value;
}

function makeLatestField(value: unknown): MakeLatest | undefined {
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false' && value !== 'legacy') {
    throw new ReleaseError('invalid_make_latest');
  }
  return value;
}

export function releaseUpdateFlags(
  existingDraft: boolean,
  existingPrerelease: boolean,
  draftInput: unknown,
  prereleaseInput: unknown,
  makeLatestInput: unknown,
): JsonObject {
  const draft = booleanField(draftInput, 'draft');
  const prerelease = booleanField(prereleaseInput, 'prerelease');
  const makeLatest = makeLatestField(makeLatestInput);
  const effectiveDraft = draft ?? existingDraft;
  const effectivePrerelease = prerelease ?? existingPrerelease;
  if ((effectiveDraft || effectivePrerelease) && makeLatest === 'true') {
    throw new ReleaseError('latest_not_allowed_for_draft_or_prerelease');
  }
  return {
    ...(draft === undefined ? {} : { draft }),
    ...(prerelease === undefined ? {} : { prerelease }),
    ...(makeLatest === undefined ? {} : { make_latest: makeLatest }),
  };
}

function compactRelease(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const author = isObject(value.author) ? value.author : {};
  return {
    id: typeof value.id === 'number' ? value.id : null,
    tagName: typeof value.tag_name === 'string' ? value.tag_name : null,
    targetCommitish: typeof value.target_commitish === 'string' ? value.target_commitish : null,
    name: typeof value.name === 'string' ? value.name : null,
    draft: value.draft === true,
    prerelease: value.prerelease === true,
    immutable: value.immutable === true,
    author: typeof author.login === 'string' ? author.login : null,
    htmlUrl: typeof value.html_url === 'string' ? value.html_url : null,
    publishedAt: typeof value.published_at === 'string' ? value.published_at : null,
  };
}

function compactAsset(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const uploader = isObject(value.uploader) ? value.uploader : {};
  return {
    id: typeof value.id === 'number' ? value.id : null,
    name: typeof value.name === 'string' ? value.name : null,
    label: typeof value.label === 'string' ? value.label : null,
    state: typeof value.state === 'string' ? value.state : null,
    contentType: typeof value.content_type === 'string' ? value.content_type : null,
    sizeBytes: typeof value.size === 'number' ? value.size : null,
    digest: typeof value.digest === 'string' ? value.digest : null,
    uploader: typeof uploader.login === 'string' ? uploader.login : null,
    browserDownloadUrl:
      typeof value.browser_download_url === 'string' ? value.browser_download_url : null,
  };
}

function permissionAllows(value: unknown, required: 'read' | 'write'): boolean {
  if (value === 'write') return true;
  return required === 'read' && value === 'read';
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

async function gptomekToken(env: GptActionsEnv, fetcher: typeof fetch): Promise<GptomekToken> {
  const appId = requiredText(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredText(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new ReleaseError('invalid_gptomek_installation_id', 503);
  }

  const jwt = await createAppJwt(appId, privateKey);
  const response = await fetcher(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    { method: 'POST', headers: tokenHeaders(jwt) },
  );
  if (!response.ok) throw new ReleaseError('gptomek_token_failed', 502);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReleaseError('invalid_gptomek_token_response', 502);
  }
  if (!isObject(value) || typeof value.token !== 'string' || !isObject(value.permissions)) {
    throw new ReleaseError('invalid_gptomek_token_response', 502);
  }
  const permissions: Record<string, string> = {};
  for (const [name, permission] of Object.entries(value.permissions)) {
    if (typeof permission === 'string') permissions[name] = permission;
  }
  return { token: value.token, permissions };
}

function verifyRelease(value: unknown, releaseId: number, expectedTag: string): JsonObject {
  if (!isObject(value) || value.id !== releaseId || value.tag_name !== expectedTag) {
    throw new ReleaseError('release_snapshot_changed', 409);
  }
  if (value.immutable === true) throw new ReleaseError('release_is_immutable', 409);
  return value;
}

export function artifactReleaseSnapshotMatches(
  value: unknown,
  artifactId: number,
  expectedName: string,
  expectedSizeBytes: number,
  expectedWorkflowRunId: number,
): boolean {
  if (!isObject(value)) return false;
  const workflowRun = isObject(value.workflow_run) ? value.workflow_run : {};
  return (
    value.id === artifactId &&
    value.name === expectedName &&
    value.size_in_bytes === expectedSizeBytes &&
    workflowRun.id === expectedWorkflowRunId &&
    value.expired !== true
  );
}

export function releaseAssetSnapshotMatches(
  value: unknown,
  assetId: number,
  expectedName: string,
  expectedSizeBytes: number,
): boolean {
  return (
    isObject(value) &&
    value.id === assetId &&
    value.name === expectedName &&
    value.size === expectedSizeBytes
  );
}

function releaseAssets(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new ReleaseError('invalid_release_assets_response', 502);
  return value.filter((entry): entry is JsonObject => isObject(entry));
}

async function downloadArtifactZip(
  token: string,
  repositoryName: string,
  artifactId: number,
  fetcher: typeof fetch,
): Promise<Response> {
  const repo = repoPath(repositoryName);
  const response = await fetcher(`${GITHUB_API}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
    headers: tokenHeaders(token),
    redirect: 'manual',
  });
  if (response.status === 410) throw new ReleaseError('artifact_expired', 409);
  if (response.status === 404) throw new ReleaseError('artifact_download_not_found', 409);
  if (response.status === 302) {
    const location = response.headers.get('location');
    if (!location) throw new ReleaseError('invalid_artifact_download_redirect', 502);
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new ReleaseError('invalid_artifact_download_redirect', 502);
    }
    if (target.protocol !== 'https:' || target.username || target.password) {
      throw new ReleaseError('invalid_artifact_download_redirect', 502);
    }
    const archive = await fetcher(target, {
      headers: { 'User-Agent': 'gremlin-gpt-actions' },
      redirect: 'follow',
    });
    if (!archive.ok) throw new ReleaseError('artifact_download_failed', 502);
    return archive;
  }
  if (!response.ok) throw new ReleaseError('artifact_download_failed', 502);
  return response;
}

async function uploadReleaseAsset(
  token: string,
  repositoryName: string,
  releaseId: number,
  name: string,
  label: string | undefined,
  bytes: ArrayBuffer,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  const repo = repoPath(repositoryName);
  const url = new URL(`${GITHUB_UPLOADS}/repos/${repo}/releases/${releaseId}/assets`);
  url.searchParams.set('name', name);
  if (label !== undefined) url.searchParams.set('label', label);
  const response = await fetcher(url, {
    method: 'POST',
    headers: tokenHeaders(token, 'application/zip'),
    body: bytes,
  });
  if (response.status === 422) throw new ReleaseError('release_asset_name_conflict', 409);
  if (!response.ok) throw new ReleaseError('release_asset_upload_failed', 502);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReleaseError('invalid_release_asset_response', 502);
  }
  if (!isObject(value) || typeof value.id !== 'number' || value.name !== name) {
    throw new ReleaseError('invalid_release_asset_response', 502);
  }
  return value;
}

async function resolveTagCommit(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repositoryName: string,
  tagName: string,
): Promise<string | null> {
  const repo = repoPath(repositoryName);
  const ref = await readResponse(source, env, fetcher, `/repos/${repo}/git/ref/tags/${refPath(tagName)}`);
  if (ref.status === 404) return null;
  const refValue = (await payload(ref)).data;
  if (!isObject(refValue) || !isObject(refValue.object)) {
    throw new ReleaseError('invalid_tag_ref_response', 502);
  }
  let objectType = refValue.object.type;
  let objectSha = refValue.object.sha;
  for (let depth = 0; depth < 4; depth += 1) {
    if (objectType === 'commit' && typeof objectSha === 'string' && SHA_RE.test(objectSha)) {
      return objectSha.toLowerCase();
    }
    if (objectType !== 'tag' || typeof objectSha !== 'string' || !SHA_RE.test(objectSha)) {
      throw new ReleaseError('invalid_tag_target', 409);
    }
    const tagObject = await readData(source, env, fetcher, `/repos/${repo}/git/tags/${objectSha}`);
    if (!isObject(tagObject) || !isObject(tagObject.object)) {
      throw new ReleaseError('invalid_tag_object_response', 502);
    }
    objectType = tagObject.object.type;
    objectSha = tagObject.object.sha;
  }
  throw new ReleaseError('tag_chain_too_deep', 409);
}

async function releaseAsGptomek(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const tagName = tag(input.tag);
  const targetSha = sha(input.targetSha);
  const name = textField(input.name, 'name', 500);
  const body = textField(input.body, 'body', 65_000);
  const draftInput = booleanField(input.draft, 'draft');
  const prereleaseInput = booleanField(input.prerelease, 'prerelease');
  const generateReleaseNotes = booleanField(input.generateReleaseNotes, 'generate_release_notes') ?? false;
  const makeLatestInput = makeLatestField(input.makeLatest);

  const repo = repoPath(repositoryName);
  const commit = await readData(request, env, fetcher, `/repos/${repo}/commits/${targetSha}`);
  if (!isObject(commit) || typeof commit.sha !== 'string' || commit.sha.toLowerCase() !== targetSha) {
    throw new ReleaseError('target_commit_not_confirmed', 409);
  }

  const existingResponse = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/releases/tags/${refPath(tagName)}`,
  );
  let existing: JsonObject | null = null;
  if (existingResponse.ok) {
    const value = (await payload(existingResponse)).data;
    if (!isObject(value)) throw new ReleaseError('invalid_release_response', 502);
    existing = value;
  } else if (existingResponse.status !== 404) {
    await payload(existingResponse);
  }

  const tagCommit = await resolveTagCommit(request, env, fetcher, repositoryName, tagName);
  if (tagCommit && tagCommit !== targetSha) throw new ReleaseError('tag_target_changed', 409);

  if (existing) {
    if (typeof existing.id !== 'number' || existing.tag_name !== tagName) {
      throw new ReleaseError('invalid_release_response', 502);
    }
    if (!tagCommit && existing.draft !== true) {
      throw new ReleaseError('published_release_tag_missing', 409);
    }
    if (!tagCommit) {
      const storedTarget =
        typeof existing.target_commitish === 'string' && SHA_RE.test(existing.target_commitish)
          ? existing.target_commitish.toLowerCase()
          : null;
      if (storedTarget !== targetSha) throw new ReleaseError('draft_release_target_mismatch', 409);
    }
    if (generateReleaseNotes) throw new ReleaseError('generate_notes_requires_new_release');
    if (existing.immutable === true) throw new ReleaseError('release_is_immutable', 409);

    const patch: JsonObject = {
      tag_name: tagName,
      ...releaseUpdateFlags(
        existing.draft === true,
        existing.prerelease === true,
        draftInput,
        prereleaseInput,
        makeLatestInput,
      ),
    };
    if (name !== undefined) patch.name = name;
    if (body !== undefined) patch.body = body;
    const updated = await botData(
      request,
      env,
      fetcher,
      'PATCH',
      `/repos/${repo}/releases/${existing.id}`,
      patch,
    );
    return json({ ok: true, created: false, release: compactRelease(updated) });
  }

  const draft = draftInput ?? false;
  const prerelease = prereleaseInput ?? false;
  const makeLatest = makeLatestInput ?? 'true';
  if ((draft || prerelease) && makeLatest === 'true') {
    throw new ReleaseError('latest_not_allowed_for_draft_or_prerelease');
  }
  const createBody: JsonObject = {
    tag_name: tagName,
    target_commitish: targetSha,
    draft,
    prerelease,
    generate_release_notes: generateReleaseNotes,
    make_latest: makeLatest,
  };
  if (name !== undefined) createBody.name = name;
  if (body !== undefined) createBody.body = body;
  const created = await botData(request, env, fetcher, 'POST', `/repos/${repo}/releases`, createBody);
  if (!isObject(created) || created.tag_name !== tagName || created.target_commitish !== targetSha) {
    throw new ReleaseError('release_creation_not_confirmed', 502);
  }
  return json({ ok: true, created: true, release: compactRelease(created) });
}

async function uploadWorkflowArtifactAsReleaseAsset(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const releaseId = positiveInteger(input.releaseId, 'release_id');
  const expectedTag = tag(input.expectedTag);
  const artifactId = positiveInteger(input.artifactId, 'artifact_id');
  const expectedArtifactName = requiredText(input.expectedArtifactName, 'expected_artifact_name', 255);
  const expectedArtifactSizeBytes = nonNegativeInteger(
    input.expectedArtifactSizeBytes,
    'expected_artifact_size_bytes',
  );
  const expectedWorkflowRunId = positiveInteger(
    input.expectedWorkflowRunId,
    'expected_workflow_run_id',
  );
  const outputName = assetName(input.assetName);
  const label = textField(input.label, 'label', 255);
  const repo = repoPath(repositoryName);

  const [releaseRaw, artifactRaw, assetsRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/releases/${releaseId}`),
    readData(request, env, fetcher, `/repos/${repo}/actions/artifacts/${artifactId}`),
    readData(request, env, fetcher, `/repos/${repo}/releases/${releaseId}/assets?per_page=100`),
  ]);
  verifyRelease(releaseRaw, releaseId, expectedTag);
  if (
    !artifactReleaseSnapshotMatches(
      artifactRaw,
      artifactId,
      expectedArtifactName,
      expectedArtifactSizeBytes,
      expectedWorkflowRunId,
    )
  ) {
    throw new ReleaseError('artifact_snapshot_changed', 409);
  }
  if (expectedArtifactSizeBytes > MAX_RELEASE_ASSET_BYTES) {
    throw new ReleaseError('artifact_too_large_for_release_asset', 413);
  }
  const existingAsset = releaseAssets(assetsRaw).find((entry) => entry.name === outputName);
  if (existingAsset) {
    return json({ ok: false, error: 'release_asset_exists', asset: compactAsset(existingAsset) }, 409);
  }

  const installation = await gptomekToken(env, fetcher);
  if (!permissionAllows(installation.permissions.actions, 'read')) {
    throw new ReleaseError('gptomek_actions_read_required', 503);
  }
  if (!permissionAllows(installation.permissions.contents, 'write')) {
    throw new ReleaseError('gptomek_contents_write_required', 503);
  }

  const archive = await downloadArtifactZip(
    installation.token,
    repositoryName,
    artifactId,
    fetcher,
  );
  const bytes = await archive.arrayBuffer();
  if (bytes.byteLength > MAX_RELEASE_ASSET_BYTES) {
    throw new ReleaseError('artifact_too_large_for_release_asset', 413);
  }
  const uploaded = await uploadReleaseAsset(
    installation.token,
    repositoryName,
    releaseId,
    outputName,
    label,
    bytes,
    fetcher,
  );
  return json({
    ok: true,
    releaseId,
    tag: expectedTag,
    source: {
      artifactId,
      artifactName: expectedArtifactName,
      workflowRunId: expectedWorkflowRunId,
      reportedSizeBytes: expectedArtifactSizeBytes,
      downloadedBytes: bytes.byteLength,
    },
    asset: compactAsset(uploaded),
  });
}

async function deleteReleaseAssetAsGptomek(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const releaseId = positiveInteger(input.releaseId, 'release_id');
  const expectedTag = tag(input.expectedTag);
  const assetId = positiveInteger(input.assetId, 'asset_id');
  const expectedName = assetName(input.expectedName);
  const expectedSizeBytes = nonNegativeInteger(input.expectedSizeBytes, 'expected_size_bytes');
  const repo = repoPath(repositoryName);

  const [releaseRaw, assetRaw, assetsRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/releases/${releaseId}`),
    readData(request, env, fetcher, `/repos/${repo}/releases/assets/${assetId}`),
    readData(request, env, fetcher, `/repos/${repo}/releases/${releaseId}/assets?per_page=100`),
  ]);
  verifyRelease(releaseRaw, releaseId, expectedTag);
  if (!releaseAssetSnapshotMatches(assetRaw, assetId, expectedName, expectedSizeBytes)) {
    throw new ReleaseError('release_asset_snapshot_changed', 409);
  }
  const belongsToRelease = releaseAssets(assetsRaw).some((entry) => entry.id === assetId);
  if (!belongsToRelease) throw new ReleaseError('release_asset_not_in_release', 409);

  const installation = await gptomekToken(env, fetcher);
  if (!permissionAllows(installation.permissions.contents, 'write')) {
    throw new ReleaseError('gptomek_contents_write_required', 503);
  }
  const response = await fetcher(`${GITHUB_API}/repos/${repo}/releases/assets/${assetId}`, {
    method: 'DELETE',
    headers: tokenHeaders(installation.token),
  });
  if (response.status === 404) throw new ReleaseError('release_asset_disappeared', 409);
  if (!response.ok) throw new ReleaseError('release_asset_delete_failed', 502);
  await response.body?.cancel();
  return json({ ok: true, deleted: true, releaseId, tag: expectedTag, assetId, name: expectedName });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

export function addReleaseOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[RELEASE_PATH] = {
    post: {
      operationId: 'releaseAsGptomek',
      summary: 'Create or update a release as gptomek[bot]',
      description:
        'Creates a release from an exact commit SHA or updates the release for that tag. Existing tag targets must match; immutable releases are rejected.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'tag', 'targetSha'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                tag: { type: 'string' },
                targetSha: { type: 'string' },
                name: { type: 'string' },
                body: { type: 'string' },
                draft: { type: 'boolean' },
                prerelease: { type: 'boolean' },
                generateReleaseNotes: { type: 'boolean', default: false },
                makeLatest: { type: 'string', enum: ['true', 'false', 'legacy'] },
              },
            },
          },
        },
      },
      responses: objectResponse('Release result'),
    },
  };
  paths[RELEASE_ASSET_UPLOAD_PATH] = {
    post: {
      operationId: 'uploadWorkflowArtifactAsReleaseAsset',
      summary: 'Publish an Actions artifact ZIP as a release asset',
      description:
        'Verifies one release and one workflow artifact snapshot, downloads the artifact ZIP as gptomek[bot], then uploads it to the release without overwriting an existing asset.',
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
                'assetName',
              ],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                releaseId: { type: 'integer', minimum: 1 },
                expectedTag: { type: 'string' },
                artifactId: { type: 'integer', minimum: 1 },
                expectedArtifactName: { type: 'string' },
                expectedArtifactSizeBytes: { type: 'integer', minimum: 0 },
                expectedWorkflowRunId: { type: 'integer', minimum: 1 },
                assetName: { type: 'string', example: 'feedseek-android.zip' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      responses: objectResponse('Uploaded release asset'),
    },
  };
  paths[RELEASE_ASSET_DELETE_PATH] = {
    post: {
      operationId: 'deleteReleaseAssetAsGptomek',
      summary: 'Delete one exact release asset as gptomek[bot]',
      description:
        'Deletes a release asset only after its release tag, asset ID, name, size and membership in that release still match the expected snapshot.',
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
                'assetId',
                'expectedName',
                'expectedSizeBytes',
              ],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                releaseId: { type: 'integer', minimum: 1 },
                expectedTag: { type: 'string' },
                assetId: { type: 'integer', minimum: 1 },
                expectedName: { type: 'string' },
                expectedSizeBytes: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      },
      responses: objectResponse('Deleted release asset'),
    },
  };
}

export async function handleReleaseAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    pathname !== RELEASE_PATH &&
    pathname !== RELEASE_ASSET_UPLOAD_PATH &&
    pathname !== RELEASE_ASSET_DELETE_PATH
  ) {
    return null;
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (pathname === RELEASE_ASSET_UPLOAD_PATH) {
      return await uploadWorkflowArtifactAsReleaseAsset(request, env, fetcher);
    }
    if (pathname === RELEASE_ASSET_DELETE_PATH) {
      return await deleteReleaseAssetAsGptomek(request, env, fetcher);
    }
    return await releaseAsGptomek(request, env, fetcher);
  } catch (error) {
    if (error instanceof ReleaseError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptRelease: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'release_internal_error' }, 500);
  }
}
