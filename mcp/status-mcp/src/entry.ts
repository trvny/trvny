import worker from "./index";

interface Env {
  TVPI: Fetcher;
  WEATHER: Fetcher;
  AUTKA: Fetcher;
  // Shared secret the caller sends as `Authorization: Bearer <token>`. Set with
  // `wrangler secret put STATUS_MCP_TOKEN`. When it is missing every request is
  // rejected: this endpoint is reachable from the open internet and drives the
  // other Workers through service bindings, so failing closed is the only safe
  // default.
  STATUS_MCP_TOKEN?: string;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_BATCH_SIZE = 16;
const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const PROJECTS = new Set(["tvpi", "feeds", "weather", "autka"]);
const pending = new Map<string, Promise<unknown | null>>();

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Compares without an early return, so the time taken does not reveal how many
// leading characters were right. Length is allowed to leak; the token is a
// fixed-length random string, so that tells an attacker nothing.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.STATUS_MCP_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return secretsMatch(header.slice(prefix.length), expected);
}

async function readTextLimited(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel("request too large");
        throw new Error("request too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function statusKey(payload: RpcRequest): { key: string; ttl: number } | null {
  if (payload.method !== "tools/call" || payload.params?.name !== "status") return null;

  const args = payload.params.arguments;
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return null;

  const values = (args ?? {}) as Record<string, unknown>;
  const project = values.project;
  if (project !== undefined && (typeof project !== "string" || !PROJECTS.has(project))) return null;
  if (values.deep !== undefined && typeof values.deep !== "boolean") return null;

  const deep = values.deep === true;
  return {
    key: `${project ?? "all"}:${deep ? "deep" : "normal"}`,
    ttl: deep ? 300 : 60,
  };
}

function rebuildRequest(request: Request, body: string): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
  });
}

async function runInner(request: Request, body: string, env: Env): Promise<Response> {
  return worker.fetch(rebuildRequest(request, body), env);
}

async function getStatusResult(
  cacheKey: string,
  ttl: number,
  request: Request,
  body: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<unknown | null> {
  const cache = caches.default;
  const key = new Request(`https://status-mcp-cache.invalid/${encodeURIComponent(cacheKey)}`);
  const cached = await cache.match(key);
  if (cached) return cached.json();

  const existing = pending.get(cacheKey);
  if (existing) return existing;

  const work = (async () => {
    const response = await runInner(request, body, env);
    if (!response.ok) return null;

    const payload = (await response.json()) as { result?: unknown };
    if (payload.result === undefined) return null;

    const stored = new Response(JSON.stringify(payload.result), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(key, stored));
    return payload.result;
  })();

  pending.set(cacheKey, work);
  try {
    return await work;
  } finally {
    pending.delete(cacheKey);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Non-POST is the CORS preflight and a static banner. Neither reaches a
    // service binding, so both stay open; gating them would only break the
    // preflight that clients send before they can present a token at all.
    if (request.method !== "POST") return worker.fetch(request, env);

    if (!authorized(request, env)) {
      return new Response(JSON.stringify(rpcError(null, -32001, "Unauthorized")), {
        status: 401,
        headers: { ...JSON_HEADERS, "WWW-Authenticate": 'Bearer realm="status-mcp"' },
      });
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return json(rpcError(null, -32600, "Request too large"), 413);

    let body: string;
    try {
      body = await readTextLimited(request);
    } catch (error) {
      if (error instanceof Error && error.message === "request too large") {
        return json(rpcError(null, -32600, "Request too large"), 413);
      }
      return json(rpcError(null, -32700, "Parse error"));
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return runInner(request, body, env);
    }

    if (Array.isArray(payload)) {
      if (payload.length > MAX_BATCH_SIZE) return json(rpcError(null, -32600, "Batch too large"), 413);
      return runInner(request, body, env);
    }

    if (!payload || typeof payload !== "object") return runInner(request, body, env);

    const rpc = payload as RpcRequest;
    const status = statusKey(rpc);
    if (!status) return runInner(request, body, env);

    const result = await getStatusResult(status.key, status.ttl, request, body, env, ctx);
    if (result === null) return runInner(request, body, env);
    return json({ jsonrpc: "2.0", id: rpc.id, result });
  },
} satisfies ExportedHandler<Env>;
