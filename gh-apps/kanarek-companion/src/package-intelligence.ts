import {
  inspectRegistryPackage,
  packageEcosystem,
  packageName,
  PackageRegistryError,
  packageVersion,
  registryAlternatives,
  type PackageEcosystem,
  type PackageRegistryResult,
} from './package-registry.ts';

export const PACKAGE_INTELLIGENCE_PATH = '/gpt-actions/packages/inspect';

const READ_PATH = '/gpt-actions/github/read';
const EXPECTED_OPERATOR = 'trvny';
const MAX_REQUEST_BYTES = 16_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_EXTERNAL_FETCHES = 24;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_ADVISORIES = 12;
const CHANGELOG_CANDIDATES = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'RELEASES.md'] as const;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
type DirectFetch = typeof fetch;

type Input = {
  ecosystem: PackageEcosystem;
  package: string;
  version: string | null;
  includeAdvisories: boolean;
  includeAlternatives: boolean;
  includeUpstream: boolean;
};

type Warning = {
  source: string;
  error: string;
};

export class PackageIntelligenceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'PackageIntelligenceError';
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
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new PackageIntelligenceError(`invalid_${name}`);
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const body = await request.clone().text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new PackageIntelligenceError('payload_too_large', 413);
  }
  let raw: unknown;
  try {
    raw = body.trim() ? JSON.parse(body) : {};
  } catch {
    throw new PackageIntelligenceError('invalid_json');
  }
  if (!isObject(raw)) throw new PackageIntelligenceError('invalid_json_object');
  const allowed = new Set([
    'ecosystem',
    'package',
    'version',
    'includeAdvisories',
    'includeAlternatives',
    'includeUpstream',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new PackageIntelligenceError('invalid_package_intelligence_request');
  }
  const ecosystem = packageEcosystem(raw.ecosystem);
  return {
    ecosystem,
    package: packageName(ecosystem, raw.package),
    version: packageVersion(raw.version),
    includeAdvisories: booleanValue(raw.includeAdvisories, 'include_advisories', true),
    includeAlternatives: booleanValue(raw.includeAlternatives, 'include_alternatives', false),
    includeUpstream: booleanValue(raw.includeUpstream, 'include_upstream', true),
  };
}

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify({ path }) });
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function authorizeOperator(request: Request, invoke: Invoke): Promise<Response | null> {
  const response = await invoke(internalReadRequest(request, '/user'));
  if (!response.ok) return response;
  const payload = await responseObject(response);
  const data = payload && isObject(payload.data) ? payload.data : null;
  if (!payload || payload.ok !== true || data?.login !== EXPECTED_OPERATOR) {
    return json({ ok: false, error: 'operator_not_allowed' }, 403);
  }
  return null;
}

function externalHostAllowed(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return [
    'registry.npmjs.org',
    'pypi.org',
    'crates.io',
    'search.maven.org',
    'repo1.maven.org',
    'api.osv.dev',
    'api.github.com',
  ].includes(url.hostname) || url.hostname === 'nuget.org' || url.hostname.endsWith('.nuget.org');
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PackageIntelligenceError('external_response_too_large', 502);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PackageIntelligenceError('external_response_too_large', 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new PackageIntelligenceError('external_response_invalid_utf8', 502);
  }
}

function externalTransport(fetcher: DirectFetch): {
  json: (url: string, init?: RequestInit) => Promise<unknown>;
  text: (url: string, init?: RequestInit) => Promise<string>;
  count: () => number;
} {
  let used = 0;
  async function response(urlValue: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(urlValue);
    if (!externalHostAllowed(url)) throw new PackageIntelligenceError('external_host_not_allowed', 403);
    used += 1;
    if (used > MAX_EXTERNAL_FETCHES) {
      throw new PackageIntelligenceError('package_intelligence_fetch_budget_exceeded', 503);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let result: Response;
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('user-agent')) headers.set('user-agent', 'GPTomek-Package-Intelligence/1.0');
      result = await fetcher(url.toString(), { ...init, headers, signal: controller.signal, redirect: 'error' });
    } catch {
      throw new PackageIntelligenceError('external_request_failed', 502, { source: url.hostname });
    } finally {
      clearTimeout(timer);
    }
    if (!result.ok) {
      throw new PackageIntelligenceError(
        result.status === 404 ? 'external_not_found' : 'external_request_failed',
        result.status === 404 ? 404 : 502,
        { source: url.hostname, upstreamStatus: result.status },
      );
    }
    return result;
  }
  return {
    json: async (url, init) => {
      const value = await boundedText(await response(url, init), MAX_JSON_BYTES);
      try {
        return JSON.parse(value);
      } catch {
        throw new PackageIntelligenceError('external_invalid_json', 502);
      }
    },
    text: async (url, init) => boundedText(await response(url, init), MAX_TEXT_BYTES),
    count: () => used,
  };
}

export function githubRepositoryFromUrl(value: string | null): { owner: string; repo: string } | null {
  if (!value) return null;
  let normalized = value.trim().replace(/^scm:git:/i, '').replace(/^git\+/, '');
  normalized = normalized.replace(/^git:\/\/github\.com\//i, 'https://github.com/');
  normalized = normalized.replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  normalized = normalized.replace(/^git@github\.com:/i, 'https://github.com/');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== 'github.com') return null;
  const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo };
}

function compactAdvisories(raw: unknown): JsonObject {
  const payload = isObject(raw) ? raw : {};
  const vulns = Array.isArray(payload.vulns) ? payload.vulns.filter(isObject) : [];
  const items = vulns.slice(0, MAX_ADVISORIES).map((vuln) => ({
    id: text(vuln.id),
    summary: text(vuln.summary),
    modified: text(vuln.modified),
    published: text(vuln.published),
    aliases: Array.isArray(vuln.aliases) ? vuln.aliases.filter((alias): alias is string => typeof alias === 'string').slice(0, 8) : [],
    severity: Array.isArray(vuln.severity)
      ? vuln.severity.filter(isObject).slice(0, 4).map((entry) => ({ type: text(entry.type), score: text(entry.score) }))
      : [],
  }));
  return {
    source: 'osv',
    count: vulns.length,
    truncated: vulns.length > items.length || typeof payload.next_page_token === 'string',
    items,
  };
}

function osvEcosystem(ecosystem: PackageEcosystem): string {
  if (ecosystem === 'pypi') return 'PyPI';
  if (ecosystem === 'crates') return 'crates.io';
  if (ecosystem === 'maven') return 'Maven';
  if (ecosystem === 'nuget') return 'NuGet';
  return 'npm';
}

async function advisories(
  registry: PackageRegistryResult,
  transport: ReturnType<typeof externalTransport>,
): Promise<JsonObject> {
  const raw = await transport.json('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      package: { name: registry.name, ecosystem: osvEcosystem(registry.ecosystem) },
      version: registry.selectedVersion,
    }),
  });
  return compactAdvisories(raw);
}

async function optionalExternal<T>(
  source: string,
  warnings: Warning[],
  work: () => Promise<T>,
  notFoundIsQuiet = false,
): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (notFoundIsQuiet && error instanceof PackageIntelligenceError && error.status === 404) return null;
    const code = error instanceof PackageIntelligenceError || error instanceof PackageRegistryError
      ? error.code
      : 'external_optional_lookup_failed';
    warnings.push({ source, error: code });
    return null;
  }
}

async function githubUpstream(
  repositoryUrl: string | null,
  transport: ReturnType<typeof externalTransport>,
  warnings: Warning[],
): Promise<JsonObject | null> {
  const repository = githubRepositoryFromUrl(repositoryUrl);
  if (!repository) return null;
  const path = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  const metadata = await optionalExternal('github-repository', warnings, () => transport.json(`https://api.github.com/repos/${path}`, {
    headers: { accept: 'application/vnd.github+json' },
  }));
  if (!isObject(metadata)) return null;
  const latestRelease = await optionalExternal('github-release', warnings, () => transport.json(`https://api.github.com/repos/${path}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
  }), true);
  let changelogUrl: string | null = null;
  const defaultBranch = text(metadata.default_branch);
  if (defaultBranch) {
    for (const candidate of CHANGELOG_CANDIDATES) {
      const raw = await optionalExternal('github-changelog', warnings, () => transport.json(
        `https://api.github.com/repos/${path}/contents/${candidate}?ref=${encodeURIComponent(defaultBranch)}`,
        { headers: { accept: 'application/vnd.github+json' } },
      ), true);
      if (isObject(raw) && raw.type === 'file' && text(raw.html_url)) {
        changelogUrl = text(raw.html_url);
        break;
      }
    }
  }
  const release = isObject(latestRelease) ? latestRelease : null;
  return {
    provider: 'github',
    repository: `${repository.owner}/${repository.repo}`,
    url: text(metadata.html_url),
    archived: metadata.archived === true,
    fork: metadata.fork === true,
    defaultBranch,
    pushedAt: text(metadata.pushed_at),
    updatedAt: text(metadata.updated_at),
    stars: typeof metadata.stargazers_count === 'number' ? metadata.stargazers_count : null,
    openIssues: typeof metadata.open_issues_count === 'number' ? metadata.open_issues_count : null,
    latestRelease: release ? {
      tag: text(release.tag_name),
      name: text(release.name),
      publishedAt: text(release.published_at),
      url: text(release.html_url),
      prerelease: release.prerelease === true,
      draft: release.draft === true,
    } : null,
    changelogUrl,
  };
}

function epoch(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function maintenanceSignals(
  latestPublishedAt: string | null,
  upstream: JsonObject | null,
  now = Date.now(),
): JsonObject {
  const candidates = [
    { source: 'registry-release', at: epoch(latestPublishedAt) },
    { source: 'repository-push', at: epoch(upstream?.pushedAt) },
    { source: 'repository-release', at: isObject(upstream?.latestRelease) ? epoch(upstream.latestRelease.publishedAt) : null },
  ].filter((entry): entry is { source: string; at: number } => entry.at !== null);
  const latest = candidates.sort((left, right) => right.at - left.at)[0] ?? null;
  const ageDays = latest ? Math.max(0, Math.floor((now - latest.at) / 86_400_000)) : null;
  let status: 'active' | 'aging' | 'stale' | 'archived' | 'unknown' = 'unknown';
  if (upstream?.archived === true) status = 'archived';
  else if (ageDays !== null && ageDays <= 180) status = 'active';
  else if (ageDays !== null && ageDays <= 730) status = 'aging';
  else if (ageDays !== null) status = 'stale';
  return {
    status,
    latestActivityAt: latest ? new Date(latest.at).toISOString() : null,
    latestActivitySource: latest?.source ?? null,
    ageDays,
    repositoryArchived: upstream?.archived === true,
    note: 'Heuristic signal only; semantic maintenance judgment stays with the model.',
  };
}

async function inspect(
  fetcher: DirectFetch,
  input: Input,
): Promise<Response> {
  const warnings: Warning[] = [];
  const transport = externalTransport(fetcher);
  let registry: PackageRegistryResult;
  try {
    registry = await inspectRegistryPackage(
      input.ecosystem,
      input.package,
      input.version,
      transport.json,
      transport.text,
    );
  } catch (error) {
    if (error instanceof PackageIntelligenceError && error.status === 404) {
      throw new PackageRegistryError(
        input.version ? 'package_version_not_found' : 'package_not_found',
        404,
      );
    }
    throw error;
  }
  const upstream = input.includeUpstream
    ? await githubUpstream(registry.repositoryUrl, transport, warnings)
    : null;
  const osv = input.includeAdvisories
    ? await optionalExternal('osv', warnings, () => advisories(registry, transport))
    : null;
  const alternatives = input.includeAlternatives
    ? await optionalExternal('registry-alternatives', warnings, () => registryAlternatives(input.ecosystem, input.package, transport.json))
    : null;
  return json({
    ok: true,
    package: registry,
    maintenance: maintenanceSignals(registry.latestPublishedAt, upstream),
    advisories: osv,
    upstream,
    alternatives,
    warnings,
    evidence: {
      registry: registry.registryUrl,
      advisorySource: input.includeAdvisories ? 'https://osv.dev/' : null,
      externalFetches: transport.count(),
      bounded: true,
      readOnly: true,
    },
  });
}

export async function handlePackageIntelligenceAction(
  request: Request,
  invoke: Invoke,
  fetcher: DirectFetch = fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PACKAGE_INTELLIGENCE_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const unauthorized = await authorizeOperator(request, invoke);
    if (unauthorized) return unauthorized;
    const input = await inputObject(request);
    return await inspect(fetcher, input);
  } catch (error) {
    if (error instanceof PackageRegistryError) return json({ ok: false, error: error.code }, error.status);
    if (error instanceof PackageIntelligenceError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    console.error(JSON.stringify({ packageIntelligence: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }));
    return json({ ok: false, error: 'package_intelligence_internal_error' }, 500);
  }
}

function requestSchema(): JsonObject {
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['ecosystem', 'package'],
          properties: {
            ecosystem: { type: 'string', enum: ['npm', 'pypi', 'crates', 'maven', 'nuget'] },
            package: { type: 'string', description: 'Package name; use group:artifact for Maven Central.' },
            version: { type: 'string', description: 'Optional exact version; omit for the current registry version.' },
            includeAdvisories: { type: 'boolean', default: true },
            includeAlternatives: { type: 'boolean', default: false },
            includeUpstream: { type: 'boolean', default: true },
          },
          additionalProperties: false,
        },
      },
    },
  };
}

export function addPackageIntelligenceOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[PACKAGE_INTELLIGENCE_PATH] = {
    post: {
      operationId: 'inspectPackage',
      summary: 'Inspect one package using live registry, advisory and upstream evidence',
      description: 'Read-only package intelligence for npm, PyPI, crates.io, Maven Central and NuGet. Normalizes versions, release freshness, license/deprecation signals and optional OSV, upstream GitHub, changelog and alternatives evidence without exposing a generic URL fetcher.',
      security: [{ githubOAuth: [] }],
      requestBody: requestSchema(),
      responses: {
        '200': {
          description: 'Normalized live package intelligence',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  };
}
