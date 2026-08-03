const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';

export interface InstallationAccessCheck {
  expiresAt: string;
  repositoryCount: number;
}

export class GitHubApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with status ${status}`);
    this.name = 'GitHubApiError';
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

function bytesToBase64Url(value: Uint8Array<ArrayBuffer>): string {
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
  const isPkcs1 = pem.includes('-----BEGIN RSA PRIVATE KEY-----');
  const isPkcs8 = pem.includes('-----BEGIN PRIVATE KEY-----');
  if (!isPkcs1 && !isPkcs8) throw new Error('invalid_private_key_format');

  const base64 = pem
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
    exp: nowSeconds + 540,
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
    'User-Agent': 'kanarek-companion',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

async function requireJson(
  response: Response,
  operation: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  return (await response.json()) as Record<string, unknown>;
}

export async function checkInstallationAccess(
  appId: string,
  privateKey: string,
  installationId: number,
  fetcher: typeof fetch = fetch,
): Promise<InstallationAccessCheck> {
  const jwt = await createAppJwt(appId, privateKey);
  const tokenResponse = await fetcher(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(jwt),
    },
  );
  const tokenPayload = await requireJson(
    tokenResponse,
    'create_installation_token',
  );
  const token = tokenPayload.token;
  const expiresAt = tokenPayload.expires_at;
  if (typeof token !== 'string' || typeof expiresAt !== 'string') {
    throw new Error('invalid_installation_token_response');
  }

  const repositoriesResponse = await fetcher(
    `${GITHUB_API}/installation/repositories?per_page=1`,
    { headers: githubHeaders(token) },
  );
  const repositoriesPayload = await requireJson(
    repositoriesResponse,
    'list_installation_repositories',
  );
  const repositoryCount = repositoriesPayload.total_count;
  if (typeof repositoryCount !== 'number') {
    throw new Error('invalid_repositories_response');
  }

  return { expiresAt, repositoryCount };
}
