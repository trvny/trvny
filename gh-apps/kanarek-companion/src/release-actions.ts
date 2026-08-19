import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const RELEASE_PATH = '/gpt-actions/github/releases/manage';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;
type MakeLatest = 'true' | 'false' | 'legacy';

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
}

export async function handleReleaseAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== RELEASE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
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
