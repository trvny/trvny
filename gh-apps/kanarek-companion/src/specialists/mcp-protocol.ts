import { authorizeOperator } from '../action-auth.ts';
import type { GithubGateway } from '../gptomek/github-gateway.ts';
import { isObject, type JsonObject } from '../tools/common.ts';

export const MCP_PATH = '/mcp';
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION]);
const MAX_REQUEST_BYTES = 64_000;

type RpcId = string | number | null;
interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface McpSurface {
  serverInfo: JsonObject;
  instructions: string;
  serializeBatchToolCalls?: boolean;
  tools(): JsonObject[];
  hasTool(name: string): boolean;
  callTool(name: string, args: unknown): Promise<JsonObject>;
}

export class InvalidToolArgumentsError extends Error {}

function id(value: unknown): RpcId {
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : null;
}

function rpcResult(requestId: RpcId, result: JsonObject): JsonObject {
  return { jsonrpc: '2.0', id: requestId, result };
}

function rpcError(requestId: RpcId, code: number, message: string): JsonObject {
  return { jsonrpc: '2.0', id: requestId, error: { code, message } };
}

function headers(protocolVersion = MCP_PROTOCOL_VERSION): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'mcp-protocol-version': protocolVersion,
  });
}

function json(body: unknown, status = 200, protocolVersion = MCP_PROTOCOL_VERSION): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(protocolVersion) });
}

function requestProtocolVersion(request: Request, rpc: RpcRequest): string {
  const header = request.headers.get('mcp-protocol-version')?.trim();
  if (header) return header;
  if (rpc.method === 'initialize' && isObject(rpc.params) && typeof rpc.params.protocolVersion === 'string') {
    return rpc.params.protocolVersion;
  }
  if (isObject(rpc.params) && isObject(rpc.params._meta)) {
    const version = rpc.params._meta['io.modelcontextprotocol/protocolVersion'];
    if (typeof version === 'string') return version;
  }
  return LEGACY_PROTOCOL_VERSION;
}

function isSupportedProtocolVersion(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.has(version);
}

function isCurrent(version: string): boolean {
  return version === MCP_PROTOCOL_VERSION;
}

function complete(version: string, result: JsonObject): JsonObject {
  return isCurrent(version) ? { resultType: 'complete', ...result } : result;
}

function discoverResult(surface: McpSurface): JsonObject {
  return {
    resultType: 'complete',
    supportedVersions: [MCP_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION],
    capabilities: { tools: { listChanged: false } },
    _meta: {
      'io.modelcontextprotocol/serverInfo': surface.serverInfo,
    },
    ttlMs: 300_000,
    cacheScope: 'private',
  };
}

function initializeResult(version: string, surface: McpSurface): JsonObject {
  const negotiated = version === LEGACY_PROTOCOL_VERSION ? version : MCP_PROTOCOL_VERSION;
  return {
    protocolVersion: negotiated,
    capabilities: { tools: { listChanged: false } },
    serverInfo: surface.serverInfo,
    instructions: surface.instructions,
  };
}

function toolListResult(version: string, surface: McpSurface): JsonObject {
  return complete(version, {
    tools: surface.tools(),
    ttlMs: 300_000,
    cacheScope: 'private',
  });
}

function mirroredHeaderMismatch(request: Request, rpc: RpcRequest): string | null {
  const method = request.headers.get('mcp-method');
  if (method && method !== rpc.method) return 'mcp_method_header_mismatch';
  if (rpc.method === 'tools/call' && isObject(rpc.params) && typeof rpc.params.name === 'string') {
    const name = request.headers.get('mcp-name');
    if (name && name !== rpc.params.name) return 'mcp_name_header_mismatch';
  }
  return null;
}

async function handleRpc(
  request: Request,
  rpc: RpcRequest,
  version: string,
  surface: McpSurface,
): Promise<JsonObject | null> {
  const requestId = id(rpc.id);
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return rpcError(requestId, -32600, 'Invalid Request');
  }

  const mismatch = mirroredHeaderMismatch(request, rpc);
  if (mismatch) return rpcError(requestId, -32600, mismatch);

  switch (rpc.method) {
    case 'server/discover':
      return rpcResult(requestId, discoverResult(surface));
    case 'initialize':
      return rpcResult(requestId, initializeResult(version, surface));
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(requestId, {});
    case 'tools/list':
      return rpcResult(requestId, toolListResult(version, surface));
    case 'tools/call': {
      if (
        !isObject(rpc.params) ||
        typeof rpc.params.name !== 'string' ||
        !surface.hasTool(rpc.params.name)
      ) {
        return rpcError(requestId, -32602, 'Unknown tool');
      }
      try {
        const result = await surface.callTool(rpc.params.name, rpc.params.arguments);
        return rpcResult(requestId, complete(version, result));
      } catch (error) {
        if (error instanceof InvalidToolArgumentsError) {
          return rpcError(requestId, -32602, 'Invalid tool arguments');
        }
        return rpcError(requestId, -32603, 'Internal error');
      }
    }
    default:
      return rpcError(requestId, -32601, 'Method not found');
  }
}

export async function handleMcp(
  request: Request,
  github: GithubGateway,
  surface: McpSurface,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers':
          'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
        'access-control-max-age': '86400',
      },
    });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const authFailure = await authorizeOperator(github);
  if (authFailure) return authFailure;

  const text = await request.clone().text();
  if (text.length > MAX_REQUEST_BYTES) {
    return json(rpcError(null, -32600, 'Request too large'), 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'));
  }

  if (Array.isArray(payload)) {
    const firstRpc = payload.find(isObject) ?? {};
    const protocolVersion = requestProtocolVersion(request, firstRpc);
    if (!isSupportedProtocolVersion(protocolVersion)) {
      return json(rpcError(null, -32600, 'Unsupported MCP protocol version'), 400);
    }
    const hasMixedVersions = payload.some(
      (entry) => isObject(entry) && requestProtocolVersion(request, entry) !== protocolVersion,
    );
    if (hasMixedVersions) {
      return json(rpcError(null, -32600, 'Mixed MCP protocol versions'), 400, protocolVersion);
    }
    const runEntry = (entry: unknown) =>
      isObject(entry)
        ? handleRpc(request, entry, protocolVersion, surface)
        : Promise.resolve(rpcError(null, -32600, 'Invalid Request'));
    const batchResults: Array<JsonObject | null> = [];
    if (surface.serializeBatchToolCalls) {
      for (const entry of payload) batchResults.push(await runEntry(entry));
    } else {
      batchResults.push(...await Promise.all(payload.map(runEntry)));
    }
    const responses = batchResults.filter((entry): entry is JsonObject => Boolean(entry));
    if (!responses.length) return new Response(null, { status: 202, headers: headers(protocolVersion) });
    return json(responses, 200, protocolVersion);
  }

  if (!isObject(payload)) return json(rpcError(null, -32600, 'Invalid Request'));
  const protocolVersion = requestProtocolVersion(request, payload);
  if (!isSupportedProtocolVersion(protocolVersion)) {
    return json(rpcError(id(payload.id), -32600, 'Unsupported MCP protocol version'), 400);
  }
  const response = await handleRpc(request, payload, protocolVersion, surface);
  if (!response) return new Response(null, { status: 202, headers: headers(protocolVersion) });
  return json(response, 200, protocolVersion);
}
