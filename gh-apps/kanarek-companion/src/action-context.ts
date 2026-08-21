import { AsyncLocalStorage } from 'node:async_hooks';

import { paginateReviewThreadsGraphql } from './review-thread-pagination.ts';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const USER_CACHE_TTL_MS = 15_000;
const INSTALLATION_REFRESH_MARGIN_MS = 5 * 60_000;
const MAX_USER_CACHE = 32;
const MAX_INSTALLATION_CACHE = 16;

type StoredResponse = {
  body: string;
  headers: [string, string][];
  status: number;
  statusText: string;
};

type CacheEntry = {
  response: StoredResponse;
  reusableUntil: number;
};

type RequestMemoStore = {
  reads: Map<string, Promise<StoredResponse>>;
};

const requestMemoStorage = new AsyncLocalStorage<RequestMemoStore>();

export function runWithActionRequestContext<T>(callback: () => T): T {
  return requestMemoStorage.run({ reads: new Map() }, callback);
}

function restoreResponse(value: StoredResponse): Response {
  return new Response(value.body || null, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });
}

function storedHeaders(headers: Headers): [string, string][] {
  const blocked = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
  return [...headers.entries()].filter(([name]) => !blocked.has(name.toLowerCase()));
}

async function storeResponse(response: Response): Promise<StoredResponse> {
  return {
    body: await response.text(),
    headers: storedHeaders(response.headers),
    status: response.status,
    statusText: response.statusText,
  };
}

function trimCache<K, V>(cache: Map<K, V>, max: number): void {
  while (cache.size >= max) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function bearerValue(request: Request): string | null {
  const value = request.headers.get('authorization')?.trim() ?? '';
  return /^Bearer\s+\S+$/i.test(value) ? value : null;
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

function appIssuer(request: Request): string | null {
  const authorization = bearerValue(request);
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return null;
  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;
  try {
    const value = JSON.parse(decoded) as Record<string, unknown>;
    return typeof value.iss === 'string' || typeof value.iss === 'number'
      ? String(value.iss)
      : null;
  } catch {
    return null;
  }
}

function installationReuseUntil(value: StoredResponse): number | null {
  if (value.status < 200 || value.status >= 300) return null;
  try {
    const payload = JSON.parse(value.body) as Record<string, unknown>;
    if (typeof payload.expires_at !== 'string' || typeof payload.token !== 'string') return null;
    const expiresAt = Date.parse(payload.expires_at);
    if (!Number.isFinite(expiresAt)) return null;
    const reusableUntil = expiresAt - INSTALLATION_REFRESH_MARGIN_MS;
    return reusableUntil > Date.now() ? reusableUntil : null;
  } catch {
    return null;
  }
}

function installationTokenMatch(request: Request, url: URL): RegExpMatchArray | null {
  if (request.method !== 'POST' || request.body !== null) return null;
  return url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
}

function requestMemoKey(request: Request, url: URL): string {
  const headers = [
    ['authorization', request.headers.get('authorization') ?? ''],
    ['accept', request.headers.get('accept') ?? ''],
    ['x-github-api-version', request.headers.get('x-github-api-version') ?? ''],
    ['if-none-match', request.headers.get('if-none-match') ?? ''],
    ['if-modified-since', request.headers.get('if-modified-since') ?? ''],
  ];
  return `${url.toString()}\n${headers.map(([key, value]) => `${key}:${value}`).join('\n')}`;
}

export function createActionFetch(upstream: typeof fetch): typeof fetch {
  const userCache = new Map<string, CacheEntry>();
  const userInFlight = new Map<string, Promise<StoredResponse>>();
  const installationCache = new Map<string, CacheEntry>();
  const installationInFlight = new Map<string, Promise<StoredResponse>>();

  const githubRequest = async (request: Request, url: URL): Promise<Response> => {
    const paginatedReviewThreads = await paginateReviewThreadsGraphql(request, upstream);
    if (paginatedReviewThreads) return paginatedReviewThreads;

    const authorization = bearerValue(request);
    if (request.method === 'GET' && url.pathname === '/user' && authorization) {
      const cached = userCache.get(authorization);
      if (cached && cached.reusableUntil > Date.now()) return restoreResponse(cached.response);
      if (cached) userCache.delete(authorization);

      let pending = userInFlight.get(authorization);
      if (!pending) {
        pending = upstream(request).then(storeResponse);
        userInFlight.set(authorization, pending);
      }
      try {
        const response = await pending;
        if (response.status >= 200 && response.status < 300) {
          trimCache(userCache, MAX_USER_CACHE);
          userCache.set(authorization, {
            response,
            reusableUntil: Date.now() + USER_CACHE_TTL_MS,
          });
        }
        return restoreResponse(response);
      } finally {
        userInFlight.delete(authorization);
      }
    }

    const installationMatch = installationTokenMatch(request, url);
    const issuer = installationMatch ? appIssuer(request) : null;
    if (installationMatch && issuer) {
      const key = `${issuer}:${installationMatch[1]}`;
      const cached = installationCache.get(key);
      if (cached && cached.reusableUntil > Date.now()) return restoreResponse(cached.response);
      if (cached) installationCache.delete(key);

      let pending = installationInFlight.get(key);
      if (!pending) {
        pending = upstream(request).then(storeResponse);
        installationInFlight.set(key, pending);
      }
      try {
        const response = await pending;
        const reusableUntil = installationReuseUntil(response);
        if (reusableUntil) {
          trimCache(installationCache, MAX_INSTALLATION_CACHE);
          installationCache.set(key, { response, reusableUntil });
        }
        return restoreResponse(response);
      } finally {
        installationInFlight.delete(key);
      }
    }

    return upstream(request);
  };

  const optimized: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== GITHUB_API_ORIGIN) return upstream(request);

    const requestMemo = requestMemoStorage.getStore();
    const installationMatch = installationTokenMatch(request, url);
    if (requestMemo && request.method !== 'GET' && !installationMatch) {
      requestMemo.reads.clear();
    }

    if (requestMemo && request.method === 'GET') {
      const key = requestMemoKey(request, url);
      let pending = requestMemo.reads.get(key);
      if (!pending) {
        pending = githubRequest(request, url).then(storeResponse);
        requestMemo.reads.set(key, pending);
      }
      try {
        return restoreResponse(await pending);
      } catch (error) {
        if (requestMemo.reads.get(key) === pending) requestMemo.reads.delete(key);
        throw error;
      }
    }

    return githubRequest(request, url);
  };

  return optimized;
}

export const actionFetch: typeof fetch = createActionFetch((input, init) => fetch(input, init));
