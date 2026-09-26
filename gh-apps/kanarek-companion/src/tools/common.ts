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
