import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const CODE_INVESTIGATION_PATH = '/gpt-actions/github/code/investigate';

type JsonObject = Record<string, unknown>;

class InvestigationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'InvestigationError';
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
    throw new InvestigationError('repository_not_allowed', 403);
  }
  return value;
}

function terms(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new InvestigationError('invalid_terms');
  }
  const result = value.map((term) => {
    if (
      typeof term !== 'string' ||
      term.length < 2 ||
      term.length > 80 ||
      !/^[A-Za-z0-9_./@+-]+$/.test(term)
    ) {
      throw new InvestigationError('invalid_terms');
    }
    return term;
  });
  if (new Set(result.map((term) => term.toLowerCase())).size !== result.length) {
    throw new InvestigationError('duplicate_terms');
  }
  return result;
}

function maxFiles(value: unknown): number {
  if (value === undefined) return 5;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new InvestigationError('invalid_max_files');
  }
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function filePath(value: string): string {
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

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new InvestigationError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new InvestigationError('invalid_json');
  }
  if (!isObject(value)) throw new InvestigationError('invalid_json_object');
  return value;
}

async function actionPayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new InvestigationError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new InvestigationError('invalid_action_response', 502);
  if (!response.ok) {
    throw new InvestigationError(
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
  const response = await handleGptActions(
    internalRequest(source, READ_PATH, { path }),
    env,
    fetcher,
  );
  return (await actionPayload(response)).data;
}

function decodeContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export interface CodeSnippet {
  startLine: number;
  endLine: number;
  text: string;
}

export function buildCodeSnippets(
  content: string,
  searchTerms: string[],
  maxSnippets = 6,
): CodeSnippet[] {
  const lines = content.split(/\r?\n/);
  const lowered = searchTerms.map((term) => term.toLowerCase());
  const hits: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLowerCase();
    if (lowered.some((term) => line.includes(term))) hits.push(index);
  }

  const windows: Array<[number, number]> = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - 2);
    const end = Math.min(lines.length - 1, hit + 2);
    const previous = windows.at(-1);
    if (previous && start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end);
    } else if (windows.length < maxSnippets) {
      windows.push([start, end]);
    }
  }

  return windows.map(([start, end]) => ({
    startLine: start + 1,
    endLine: end + 1,
    text: lines
      .slice(start, end + 1)
      .map((line, offset) => `${start + offset + 1}: ${line}`)
      .join('\n')
      .slice(0, 8_000),
  }));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function investigateCode(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const searchTerms = terms(input.terms);
  const limit = maxFiles(input.maxFiles);
  const query = `${searchTerms.join(' ')} repo:${repositoryName}`;
  const search = await readData(
    request,
    env,
    fetcher,
    `/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`,
  );
  if (!isObject(search) || !Array.isArray(search.items)) {
    throw new InvestigationError('invalid_code_search_response', 502);
  }

  const repo = repoPath(repositoryName);
  const items = search.items.slice(0, limit);
  const files = await Promise.all(
    items.map(async (raw) => {
      if (!isObject(raw) || typeof raw.path !== 'string') return null;
      const contentRaw = await readData(
        request,
        env,
        fetcher,
        `/repos/${repo}/contents/${filePath(raw.path)}`,
      );
      const content = decodeContent(contentRaw);
      return {
        path: raw.path,
        sha: stringValue(raw.sha),
        htmlUrl: stringValue(raw.html_url),
        size: isObject(contentRaw) ? numberValue(contentRaw.size) : null,
        snippets: content ? buildCodeSnippets(content, searchTerms) : [],
        contentAvailable: content !== null,
      };
    }),
  );

  return json({
    ok: true,
    repository: repositoryName,
    terms: searchTerms,
    totalCount: numberValue(search.total_count),
    incompleteResults: search.incomplete_results === true,
    files: files.filter((file): file is NonNullable<typeof file> => Boolean(file)),
  });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

export function addInvestigationOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CODE_INVESTIGATION_PATH] = {
    post: {
      operationId: 'investigateCode',
      summary: 'Search code and return useful snippets',
      description:
        'Searches one trvny repository for identifier-like terms, fetches the best matching files and returns line-numbered context around matches.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'terms'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                terms: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                maxFiles: { type: 'integer', minimum: 1, maximum: 6 },
              },
            },
          },
        },
      },
      responses: objectResponse('Code investigation results'),
    },
  };
}

export async function handleInvestigationAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== CODE_INVESTIGATION_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await investigateCode(request, env, fetcher);
  } catch (error) {
    if (error instanceof InvestigationError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptInvestigation: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'investigation_internal_error' }, 500);
  }
}
