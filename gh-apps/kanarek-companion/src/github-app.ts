const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const MAX_PAGES = 20;

export const TEST_COMMENT_MARKER =
  '<!-- kanarek-companion:test-comment -->';

export interface InstallationAccessCheck {
  expiresAt: string;
  repositoryCount: number;
}

export interface TestCommentResult {
  commentId: number;
  commentUrl: string;
  created: boolean;
  expiresAt: string;
}

interface InstallationToken {
  expiresAt: string;
  permissions: Record<string, string>;
  token: string;
}

interface GitHubApiDiagnosticContext {
  grantedPermissions?: Record<string, string>;
}

export class GitHubApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`${operation} failed with status ${status}`);
    this.name = 'GitHubApiError';
    this.operation = operation;
    this.status = status;
  }
}

function concatBytes(
  parts: Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function derLength(length: number): Uint8Array<ArrayBuffer> {
  if (length < 0x80) return new Uint8Array([length]);

  const octets: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function der(
  tag: number,
  value: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return concatBytes([new Uint8Array([tag]), derLength(value.byteLength), value]);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  let binary = '';
  for (let index = 0; index < value.byteLength; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pkcs1ToPkcs8(
  privateKey: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01,
    0x01, 0x01, 0x05, 0x00,
  ]);
  return der(
    0x30,
    concatBytes([version, rsaAlgorithmIdentifier, der(0x04, privateKey)]),
  );
}

function privateKeyDer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const isPkcs1 = normalized.includes('-----BEGIN RSA PRIVATE KEY-----');
  const isPkcs8 = normalized.includes('-----BEGIN PRIVATE KEY-----');
  if (!isPkcs1 && !isPkcs8) throw new Error('invalid_private_key_format');

  const base64 = normalized
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  if (!base64) throw new Error('empty_private_key');

  const decoded = base64ToBytes(base64);
  return (isPkcs1 ? pkcs1ToPkcs8(decoded) : decoded).buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function createAppJwt(
  appId: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = jsonToBase64Url({ alg: 'RS256', typ: 'JWT' });
  const payload = jsonToBase64Url({
    iat: nowSeconds - 60,
    exp: nowSeconds + 480,
    iss: appId,
  });
  const unsigned = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function githubHeaders(token: string): Headers {
  return new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'kanarek-companion',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
}

async function githubFailureDetails(
  response: Response,
): Promise<{ documentationUrl: string | null; message: string | null }> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      documentationUrl: safeText(payload.documentation_url),
      message: safeText(payload.message),
    };
  } catch {
    return { documentationUrl: null, message: null };
  }
}

async function requireJson<T>(
  response: Response,
  operation: string,
  diagnosticContext: GitHubApiDiagnosticContext = {},
): Promise<T> {
  if (!response.ok) {
    const details = await githubFailureDetails(response);
    console.warn(
      JSON.stringify({
        githubApiDiagnostic: {
          acceptedPermissions: response.headers.get(
            'x-accepted-github-permissions',
          ),
          documentationUrl: details.documentationUrl,
          grantedPermissions: diagnosticContext.grantedPermissions ?? null,
          message: details.message,
          operation,
          rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
          rateLimitReset: response.headers.get('x-ratelimit-reset'),
          requestId: response.headers.get('x-github-request-id'),
          retryAfter: response.headers.get('retry-after'),
          status: response.status,
        },
      }),
    );
    throw new GitHubApiError(operation, response.status);
  }
  return (await response.json()) as T;
}

async function requireVoid(
  response: Response,
  operation: string,
  diagnosticContext: GitHubApiDiagnosticContext = {},
): Promise<void> {
  if (response.ok) {
    await response.body?.cancel();
    return;
  }
  await requireJson<unknown>(response, operation, diagnosticContext);
}

async function createInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number,
  fetcher: typeof fetch,
): Promise<InstallationToken> {
  const jwt = await createAppJwt(appId, privateKey);
  const response = await fetcher(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(jwt),
    },
  );
  const payload = await requireJson<Record<string, unknown>>(
    response,
    'create_installation_token',
  );
  const token = payload.token;
  const expiresAt = payload.expires_at;
  if (typeof token !== 'string' || typeof expiresAt !== 'string') {
    throw new Error('invalid_installation_token_response');
  }
  return {
    token,
    expiresAt,
    permissions: stringRecord(payload.permissions),
  };
}

function repositoryParts(repository: string): [string, string] {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('invalid_repository_name');
  }
  return [encodeURIComponent(parts[0]), encodeURIComponent(parts[1])];
}

function apiPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('invalid_github_api_path');
  }
  return `${GITHUB_API}${path}`;
}

export class GitHubInstallationClient {
  readonly expiresAt: string;
  readonly permissions: Readonly<Record<string, string>>;
  private readonly fetcher: typeof fetch;
  private readonly token: string;

  constructor(installation: InstallationToken, fetcher: typeof fetch) {
    this.token = installation.token;
    this.expiresAt = installation.expiresAt;
    this.permissions = installation.permissions;
    this.fetcher = fetcher;
  }

  async json<T>(
    path: string,
    operation: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetcher(apiPath(path), {
      ...init,
      headers: githubHeaders(this.token),
    });
    return requireJson<T>(response, operation, {
      grantedPermissions: { ...this.permissions },
    });
  }

  async void(
    path: string,
    operation: string,
    init: RequestInit = {},
  ): Promise<void> {
    const response = await this.fetcher(apiPath(path), {
      ...init,
      headers: githubHeaders(this.token),
    });
    return requireVoid(response, operation, {
      grantedPermissions: { ...this.permissions },
    });
  }

  async paginate<T>(
    path: string,
    operation: string,
    options?: {
      maxPages?: number;
      stopWhen?: (items: T[]) => boolean;
    },
  ): Promise<T[]> {
    const url = new URL(apiPath(path));
    url.searchParams.set('per_page', '100');
    const output: T[] = [];
    const maxPages = Math.max(
      1,
      Math.min(options?.maxPages ?? MAX_PAGES, 30),
    );

    for (let page = 1; page <= maxPages; page += 1) {
      url.searchParams.set('page', String(page));
      const response = await this.fetcher(url, {
        headers: githubHeaders(this.token),
      });
      const data = await requireJson<unknown>(response, operation, {
        grantedPermissions: { ...this.permissions },
      });
      if (!Array.isArray(data)) throw new Error(`${operation}_invalid_response`);
      output.push(...(data as T[]));
      if (options?.stopWhen?.(output)) return output;
      const link = response.headers.get('link');
      if (data.length < 100 || (link && !link.includes('rel="next"'))) {
        return output;
      }
    }
    throw new Error(`${operation}_pagination_limit`);
  }
}

export async function createInstallationClient(
  appId: string,
  privateKey: string,
  installationId: number,
  fetcher: typeof fetch = fetch,
): Promise<GitHubInstallationClient> {
  const installation = await createInstallationToken(
    appId,
    privateKey,
    installationId,
    fetcher,
  );
  return new GitHubInstallationClient(installation, fetcher);
}

function commentBody(delivery: string): string {
  const safeDelivery = delivery.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 100);
  return [
    TEST_COMMENT_MARKER,
    `<!-- kanarek-companion:delivery:${safeDelivery || 'unknown'} -->`,
    '🐤 Kanarek-companion działa. Zweryfikowany webhook, token instalacji i komentarz GitHub App są podłączone.',
  ].join('\n');
}

function nextCommentsPage(
  linkHeader: string | null,
  commentsUrl: string,
): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="next"$/);
    if (!match) continue;

    const next = new URL(match[1]);
    const expected = new URL(commentsUrl);
    if (next.origin !== expected.origin || next.pathname !== expected.pathname) {
      throw new Error('invalid_comments_pagination_url');
    }
    return next.toString();
  }
  return null;
}

function existingTestComment(
  comments: unknown[],
  appSlug: string,
): TestCommentResult | null {
  const expectedLogin = `${appSlug}[bot]`;
  for (const value of comments) {
    const comment = value as Record<string, unknown>;
    const user = comment.user as Record<string, unknown> | undefined;
    if (
      typeof comment.body === 'string' &&
      comment.body.includes(TEST_COMMENT_MARKER) &&
      typeof comment.id === 'number' &&
      typeof comment.html_url === 'string' &&
      user?.login === expectedLogin &&
      user.type === 'Bot'
    ) {
      return {
        commentId: comment.id,
        commentUrl: comment.html_url,
        created: false,
        expiresAt: '',
      };
    }
  }
  return null;
}

export async function checkInstallationAccess(
  appId: string,
  privateKey: string,
  installationId: number,
  fetcher: typeof fetch = fetch,
): Promise<InstallationAccessCheck> {
  const installation = await createInstallationToken(
    appId,
    privateKey,
    installationId,
    fetcher,
  );
  const repositoriesResponse = await fetcher(
    `${GITHUB_API}/installation/repositories?per_page=1`,
    { headers: githubHeaders(installation.token) },
  );
  const repositoriesPayload = await requireJson<Record<string, unknown>>(
    repositoriesResponse,
    'list_installation_repositories',
    { grantedPermissions: installation.permissions },
  );
  const repositoryCount = repositoriesPayload.total_count;
  if (typeof repositoryCount !== 'number') {
    throw new Error('invalid_repositories_response');
  }

  return { expiresAt: installation.expiresAt, repositoryCount };
}

export async function ensureTestComment(
  appId: string,
  appSlug: string,
  privateKey: string,
  installationId: number,
  repository: string,
  pullRequestNumber: number,
  delivery: string,
  fetcher: typeof fetch = fetch,
): Promise<TestCommentResult> {
  const installation = await createInstallationToken(
    appId,
    privateKey,
    installationId,
    fetcher,
  );
  const [owner, repo] = repositoryParts(repository);
  const commentsUrl = `${GITHUB_API}/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`;
  let pageUrl: string | null = `${commentsUrl}?per_page=100`;
  const visited = new Set<string>();

  while (pageUrl) {
    if (visited.has(pageUrl)) throw new Error('comments_pagination_loop');
    visited.add(pageUrl);

    const response = await fetcher(pageUrl, {
      headers: githubHeaders(installation.token),
    });
    const comments = await requireJson<unknown>(
      response,
      'list_issue_comments',
      { grantedPermissions: installation.permissions },
    );
    if (!Array.isArray(comments)) throw new Error('invalid_comments_response');

    const existing = existingTestComment(comments, appSlug);
    if (existing) {
      return { ...existing, expiresAt: installation.expiresAt };
    }
    pageUrl = nextCommentsPage(response.headers.get('link'), commentsUrl);
  }

  const created = await requireJson<Record<string, unknown>>(
    await fetcher(commentsUrl, {
      method: 'POST',
      headers: githubHeaders(installation.token),
      body: JSON.stringify({ body: commentBody(delivery) }),
    }),
    'create_issue_comment',
    { grantedPermissions: installation.permissions },
  );
  if (typeof created.id !== 'number' || typeof created.html_url !== 'string') {
    throw new Error('invalid_created_comment_response');
  }

  return {
    commentId: created.id,
    commentUrl: created.html_url,
    created: true,
    expiresAt: installation.expiresAt,
  };
}
