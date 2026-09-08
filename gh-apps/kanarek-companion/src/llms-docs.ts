const MAX_REMOTE_DOC_BYTES = 192_000;
const MAX_LLMS_LINKS = 160;
const REMOTE_FETCH_TIMEOUT_MS = 10_000;

export type RemoteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type JsonObject = Record<string, unknown>;

interface LlmsEntry {
  title: string;
  url: string;
  section: string | null;
  description: string | null;
  optional: boolean;
  readable: boolean;
  order: number;
}

class LlmsDocsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'LlmsDocsError';
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function stringValue(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new LlmsDocsError(`invalid_${name}`);
  }
  return value.trim();
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || !host.includes('.')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true;
  return [
    'localhost',
    '.localhost',
    '.local',
    '.internal',
    '.lan',
    '.home',
  ].some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix));
}

function safeHttpsUrl(value: string | URL, name: string): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new LlmsDocsError(`invalid_${name}`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    blockedHostname(url.hostname)
  ) {
    throw new LlmsDocsError(`${name}_not_allowed`, 403);
  }
  return url;
}

function llmsUrlFor(siteUrl: string): URL {
  const url = safeHttpsUrl(siteUrl, 'site_url');
  url.search = '';
  url.hash = '';
  if (!url.pathname.toLowerCase().endsWith('/llms.txt')) {
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    url.pathname += 'llms.txt';
  }
  return safeHttpsUrl(url, 'llms_url');
}

function readableDocumentUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith('.md') ||
    path.endsWith('.mdx') ||
    path.endsWith('.txt') ||
    path.endsWith('.rst') ||
    path.endsWith('.adoc')
  );
}

function supportedTextContentType(response: Response): boolean {
  const raw = response.headers.get('content-type');
  if (!raw) return true;
  const type = raw.split(';', 1)[0]?.trim().toLowerCase();
  return new Set([
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/octet-stream',
  ]).has(type ?? '');
}

async function boundedUtf8(response: Response, tooLargeCode: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REMOTE_DOC_BYTES) {
    throw new LlmsDocsError(tooLargeCode, 413);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REMOTE_DOC_BYTES) {
        await reader.cancel();
        throw new LlmsDocsError(tooLargeCode, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new LlmsDocsError('remote_document_encoding_invalid', 502);
  }
}

async function fetchText(
  url: URL,
  fetchRemote: RemoteFetch,
  kind: 'llms' | 'document',
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchRemote(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof LlmsDocsError) throw error;
    throw new LlmsDocsError('remote_docs_fetch_failed', 502);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new LlmsDocsError('remote_docs_redirect_not_allowed', 502);
  }
  if (response.status === 404) {
    throw new LlmsDocsError(kind === 'llms' ? 'llms_txt_not_found' : 'remote_document_not_found', 404);
  }
  if (!response.ok) throw new LlmsDocsError('remote_docs_upstream_failed', 502);
  if (!supportedTextContentType(response)) {
    throw new LlmsDocsError('remote_document_type_not_allowed', 415);
  }
  return boundedUtf8(
    response,
    kind === 'llms' ? 'llms_txt_too_large' : 'remote_document_too_large',
  );
}

function parseLlms(content: string, llmsUrl: URL): {
  title: string | null;
  summary: string | null;
  entries: LlmsEntry[];
} {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  let title: string | null = null;
  let section: string | null = null;
  const summaryLines: string[] = [];
  const entries: LlmsEntry[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 && !title) {
      title = h1[1]?.trim() || null;
      continue;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      section = h2[1]?.trim() || null;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote && entries.length === 0 && !section) {
      const text = quote[1]?.trim();
      if (text) summaryLines.push(text);
      continue;
    }
    const link = /^\s*[-*+]\s+\[([^\]\n]{1,300})\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)(?:\s*:\s*(.*))?\s*$/.exec(line);
    if (!link) continue;

    let target: URL;
    try {
      target = safeHttpsUrl(new URL(link[2] ?? '', llmsUrl), 'document_url');
    } catch (error) {
      if (error instanceof LlmsDocsError) continue;
      throw error;
    }
    const href = target.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    entries.push({
      title: (link[1] ?? '').trim(),
      url: href,
      section,
      description: link[3]?.trim() || null,
      optional: section?.trim().toLowerCase() === 'optional',
      readable: readableDocumentUrl(target),
      order: entries.length,
    });
    if (entries.length >= MAX_LLMS_LINKS) break;
  }

  return {
    title,
    summary: summaryLines.length ? summaryLines.join(' ') : null,
    entries,
  };
}

function queryScore(query: string, entry: LlmsEntry): number {
  const normalized = query.toLowerCase().trim();
  if (normalized === '*') return entry.optional ? 1 : 2;
  const tokens = normalized.split(/[^a-z0-9_.+-]+/).filter((token) => token.length >= 2);
  if (!tokens.length) return 0;
  const title = entry.title.toLowerCase();
  const section = entry.section?.toLowerCase() ?? '';
  const description = entry.description?.toLowerCase() ?? '';
  const url = entry.url.toLowerCase();
  let score = title.includes(normalized) ? 30 : 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 10;
    if (section.includes(token)) score += 6;
    if (description.includes(token)) score += 4;
    if (url.includes(token)) score += 2;
  }
  if (entry.optional) score -= 1;
  return Math.max(score, 0);
}

function publicEntry(entry: LlmsEntry, score?: number): JsonObject {
  return {
    title: entry.title,
    url: entry.url,
    section: entry.section,
    description: entry.description,
    optional: entry.optional,
    readable: entry.readable,
    ...(score === undefined ? {} : { score }),
  };
}

export async function searchLlmsDocs(
  input: JsonObject,
  query: string,
  limit: number,
  fetchRemote: RemoteFetch,
): Promise<Response> {
  try {
    const siteUrl = stringValue(input.siteUrl, 'site_url', 2_000);
    const llmsUrl = llmsUrlFor(siteUrl);
    const content = await fetchText(llmsUrl, fetchRemote, 'llms');
    const parsed = parseLlms(content, llmsUrl);
    const requestedDocument = input.documentUrl === undefined
      ? null
      : stringValue(input.documentUrl, 'document_url', 4_000);

    if (requestedDocument) {
      const requested = safeHttpsUrl(requestedDocument, 'document_url').toString();
      const entry = parsed.entries.find((candidate) => candidate.url === requested);
      if (!entry) throw new LlmsDocsError('document_not_listed_in_llms_txt', 403);
      if (!entry.readable) throw new LlmsDocsError('remote_document_type_not_allowed', 403);
      const documentUrl = safeHttpsUrl(entry.url, 'document_url');
      documentUrl.hash = '';
      const documentContent = await fetchText(documentUrl, fetchRemote, 'document');
      return json({
        ok: true,
        source: 'llms.txt',
        query,
        siteUrl,
        llmsUrl: llmsUrl.toString(),
        title: parsed.title,
        summary: parsed.summary,
        document: {
          ...publicEntry(entry),
          content: documentContent,
        },
      });
    }

    const matches = parsed.entries
      .map((entry) => ({ entry, score: queryScore(query, entry) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.entry.order - right.entry.order);
    const visible = matches.slice(0, limit);
    return json({
      ok: true,
      source: 'llms.txt',
      query,
      siteUrl,
      llmsUrl: llmsUrl.toString(),
      title: parsed.title,
      summary: parsed.summary,
      documentCount: parsed.entries.length,
      matchCount: matches.length,
      truncated: matches.length > visible.length,
      matches: visible.map(({ entry, score }) => publicEntry(entry, score)),
    });
  } catch (error) {
    if (error instanceof LlmsDocsError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    throw error;
  }
}
