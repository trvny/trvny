import { GPTOMEK_CONTROL_BRANCH } from '../gptomek-control.ts';

export type JsonObject = Record<string, unknown>;

export class SpecialistToolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'SpecialistToolError';
    this.code = code;
    this.status = status;
  }
}

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Repository owners Gremlin/GPTomek may act on. Single source of truth.
export const REPOSITORY_OWNERS: ReadonlySet<string> = new Set(['trvny', 'travnie']);
const REPOSITORY_NAME_RE = /^[A-Za-z0-9_.-]+$/;
const REPOSITORY_PATH_RE = new RegExp(
  `^/repos/(?:${[...REPOSITORY_OWNERS].join('|')})/[A-Za-z0-9_.-]+(?:/|$)`,
);

// Exact `owner/name` with an allowed owner.
export function repositoryInScope(value: string): boolean {
  const parts = value.split('/');
  return (
    parts.length === 2 &&
    REPOSITORY_OWNERS.has(parts[0]) &&
    REPOSITORY_NAME_RE.test(parts[1])
  );
}

export function repositoryOwner(repository: string): string {
  return repository.split('/')[0];
}

// GitHub API pathname under /repos/{allowed owner}/{name}.
export function repositoryPathInScope(pathname: string): boolean {
  return REPOSITORY_PATH_RE.test(pathname);
}

// main, the default branch and the GPTomek control ref are never work branches.
export function isProtectedBranch(branchName: string, defaultBranch: string): boolean {
  return (
    branchName.toLowerCase() === 'main' ||
    branchName === defaultBranch ||
    branchName === GPTOMEK_CONTROL_BRANCH
  );
}

// `owner/name` for GitHub API paths, each segment encoded.
export function repoPath(repository: string): string {
  return repository.split('/').map(encodeURIComponent).join('/');
}

// POST to another route of this Worker with the caller's headers, for
// composing actions in-process.
export function internalRequest(source: Request, pathname: string, body: JsonObject = {}): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

export const GITHUB_READ_PATH = '/gpt-actions/github/read';

// GitHub REST read through GPT Actions, as the caller.
export function internalReadRequest(source: Request, path: string): Request {
  return internalRequest(source, GITHUB_READ_PATH, { path });
}

// JSON object body; empty body -> {}. Limit counts UTF-16 code units.
export async function readJsonObject(
  request: Request,
  maxLength: number,
  error: (code: string, status?: number) => Error,
): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > maxLength) throw error('payload_too_large', 413);
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw error('invalid_json');
  }
  if (!isObject(value)) throw error('invalid_json_object');
  return value;
}

// Internal GPT Actions JSON response. Non-JSON -> invalid_action_response 502.
// Failure: HTTP !ok, or payload.ok !== true when requireOk; code = payload.error
// or fallback(status).
export async function actionResponseObject(
  response: Response,
  error: (code: string, status?: number) => Error,
  options: { fallback?: (status: number) => string; requireOk?: boolean } = {},
): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw error('invalid_action_response', 502);
  }
  if (!isObject(value)) throw error('invalid_action_response', 502);
  if (!response.ok || (options.requireOk && value.ok !== true)) {
    const fallback = options.fallback ?? (() => 'action_failed');
    throw error(typeof value.error === 'string' ? value.error : fallback(response.status), response.status);
  }
  return value;
}

export function assertSerializedSize(value: unknown, maxBytes: number): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SpecialistToolError('invalid_input');
  }
  if (serialized.length > maxBytes) throw new SpecialistToolError('payload_too_large', 413);
}

export function stringValue(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new SpecialistToolError(`invalid_${name}`);
  }
  return value.trim();
}

export function optionalStringValue(
  value: unknown,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return stringValue(value, name, maxLength);
}

export function integerValue(
  value: unknown,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SpecialistToolError(`invalid_${name}`);
  }
  return value;
}

export async function boundedText(
  response: Response,
  maxBytes: number,
  tooLargeCode: string,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SpecialistToolError(tooLargeCode, 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function boundedJson(
  response: Response,
  maxBytes: number,
  invalidCode: string,
  tooLargeCode: string,
): Promise<unknown> {
  const text = await boundedText(response, maxBytes, tooLargeCode);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SpecialistToolError(invalidCode, 502);
  }
}
