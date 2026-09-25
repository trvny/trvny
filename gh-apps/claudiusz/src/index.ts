import { ToolError, type GitHubEnv } from './github.ts';
import { TOOLS, callTool } from './tools.ts';

export interface Env extends GitHubEnv {
  // Shared secret: the claude.ai connector URL path, or `Authorization: Bearer`.
  // Unset means every POST is rejected — this endpoint writes to GitHub.
  CLAUDIUSZ_MCP_TOKEN?: string;
}

interface RpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 16;
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = {
  name: 'claudiusz-mcp',
  title: 'Claudiusz69',
  version: '1.0.0',
  description: 'Comments, reactions and reviews on GitHub as claudiusz69[bot].',
};
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
};

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });
const err = (id: RpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code, message },
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

// Constant-time for equal lengths; the token has a fixed length, so leaking
// length says nothing.
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// claude.ai custom connectors take only a URL, so the token rides in the path
// (invocation logs are off in wrangler.jsonc for that reason). Bearer is kept
// for curl.
export function authorized(request: Request, env: Env): boolean {
  const expected = env.CLAUDIUSZ_MCP_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (header.startsWith('Bearer ') && secretsMatch(header.slice(7), expected)) return true;
  let path = new URL(request.url).pathname.slice(1);
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }
  return secretsMatch(path, expected);
}

async function handleRpc(req: RpcRequest, env: Env): Promise<object | null> {
  if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
    return err(null, -32600, 'Invalid request');
  }
  switch (req.method) {
    case 'initialize': {
      const requested = req.params?.protocolVersion;
      const protocolVersion =
        typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return ok(req.id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok(req.id, {});
    case 'tools/list':
      return ok(req.id, { tools: TOOLS });
    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      if (!TOOLS.some((tool) => tool.name === name)) return err(req.id, -32602, `Unknown tool: ${name}`);
      const rawArgs = req.params?.arguments;
      const args =
        rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
      try {
        const result = await callTool(env, name, args);
        return ok(req.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        const message = error instanceof ToolError ? error.message : `internal error: ${String(error)}`;
        if (!(error instanceof ToolError)) console.error(JSON.stringify({ tool: name, error: String(error) }));
        return ok(req.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return req.id === undefined ? null : err(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      return new Response('claudiusz-mcp. POST JSON-RPC to the tokenized URL.\n', {
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (request.method !== 'POST') return json(err(null, -32600, 'Method not allowed'), 405);

    if (!authorized(request, env)) {
      return json(err(null, -32001, 'Unauthorized'), 401, { 'WWW-Authenticate': 'Bearer realm="claudiusz-mcp"' });
    }

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(err(null, -32600, 'Request too large'), 413);

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return json(err(null, -32700, 'Parse error'));
    }

    if (Array.isArray(payload)) {
      if (payload.length > MAX_BATCH) return json(err(null, -32600, 'Batch too large'), 413);
      const responses = (await Promise.all(payload.map((entry) => handleRpc(entry as RpcRequest, env)))).filter(
        (entry): entry is object => entry !== null,
      );
      return responses.length ? json(responses) : new Response(null, { status: 202, headers: JSON_HEADERS });
    }

    const response = await handleRpc(payload as RpcRequest, env);
    return response ? json(response) : new Response(null, { status: 202, headers: JSON_HEADERS });
  },
} satisfies ExportedHandler<Env>;
