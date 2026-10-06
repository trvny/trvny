import { authorizeOperator, type ActionInvoke } from './action-auth.ts';
import { SpecialistToolError, isObject, type JsonObject } from './tools/common.ts';
import {
  invokeSpecialistTool,
  isSpecialistToolName,
  specialistToolDescriptors,
  specialistToolNames,
  type SpecialistToolEnv,
} from './tools/registry.ts';

export const MCP_PATH = '/mcp';
export const MCP_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION]);
const MAX_REQUEST_BYTES = 64_000;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const SPECIALIST_SERVER_INFO: JsonObject = {
  name: 'mechagremlin-specialists',
  title: 'MechaGremlin Specialist Tools',
  version: '1.0.0',
  description: 'Private bounded specialist tools shared by Gremlin Actions and MCP.',
};

const OPERATOR_SERVER_INFO: JsonObject = {
  name: 'mechagremlin',
  title: 'MechaGremlin',
  version: '1.0.0',
  description: 'Guarded Gremlin operator tools backed by the maintained Action runtime.',
};

type RpcId = string | number | null;
interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface McpSurface {
  serverInfo: JsonObject;
  instructions: string;
  tools(): JsonObject[];
  hasTool(name: string): boolean;
  callTool(name: string, args: unknown): Promise<JsonObject>;
}

interface OperatorRoute {
  name: string;
  method: string;
  path: string;
  description: string;
  inputSchema: JsonObject;
  pathFields: Set<string>;
  queryFields: Set<string>;
  bodyFields: Set<string>;
  requiredFields: Set<string>;
  hasRequestBody: boolean;
  bodyAsValue: boolean;
}

class InvalidToolArgumentsError extends Error {}

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

async function handleMcp(
  request: Request,
  invoke: ActionInvoke,
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

  const authFailure = await authorizeOperator(request, invoke);
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
    const responses = (
      await Promise.all(
        payload.map((entry) =>
          isObject(entry)
            ? handleRpc(request, entry, protocolVersion, surface)
            : Promise.resolve(rpcError(null, -32600, 'Invalid Request')),
        ),
      )
    ).filter((entry): entry is JsonObject => Boolean(entry));
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

function specialistSurface(
  env: SpecialistToolEnv,
  fetcher: typeof fetch,
): McpSurface {
  return {
    serverInfo: SPECIALIST_SERVER_INFO,
    instructions:
      'Private MechaGremlin specialist tools. Use Context7 for current library docs and Engram for durable personal memory.',
    tools: () => specialistToolDescriptors().map((tool) => ({ ...tool })),
    hasTool: isSpecialistToolName,
    async callTool(name, args) {
      try {
        if (!isSpecialistToolName(name)) throw new SpecialistToolError('unknown_tool');
        const structured = await invokeSpecialistTool(name, args, env, fetcher);
        return {
          content: [{ type: 'text', text: JSON.stringify(structured) }],
          structuredContent: structured,
          isError: false,
        };
      } catch (error) {
        if (error instanceof SpecialistToolError) {
          return {
            content: [{ type: 'text', text: error.code }],
            structuredContent: { ok: false, error: error.code },
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: 'specialist_tool_error' }],
          structuredContent: { ok: false, error: 'specialist_tool_error' },
          isError: true,
        };
      }
    },
  };
}

function parameterEntries(pathItem: JsonObject, operation: JsonObject): JsonObject[] {
  const values = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  return values.filter(isObject);
}

function requestBodySchema(operation: JsonObject): JsonObject | null {
  const requestBody = isObject(operation.requestBody) ? operation.requestBody : null;
  const content = requestBody && isObject(requestBody.content) ? requestBody.content : null;
  const jsonContent = content && isObject(content['application/json'])
    ? content['application/json']
    : null;
  return jsonContent && isObject(jsonContent.schema) ? jsonContent.schema : null;
}

function addSchemaProperty(
  properties: JsonObject,
  name: string,
  schema: unknown,
): void {
  if (!(name in properties)) properties[name] = isObject(schema) ? schema : {};
}

function operatorRoutes(document: JsonObject): Map<string, OperatorRoute> {
  if (!isObject(document.paths)) throw new Error('invalid_openapi_paths');
  const routes = new Map<string, OperatorRoute>();

  for (const [path, rawPathItem] of Object.entries(document.paths)) {
    if (!isObject(rawPathItem)) continue;
    for (const [rawMethod, rawOperation] of Object.entries(rawPathItem)) {
      if (!HTTP_METHODS.has(rawMethod) || !isObject(rawOperation)) continue;
      if (typeof rawOperation.operationId !== 'string') continue;

      const properties: JsonObject = {};
      const requiredFields = new Set<string>();
      const pathFields = new Set<string>();
      const queryFields = new Set<string>();
      const bodyFields = new Set<string>();

      for (const parameter of parameterEntries(rawPathItem, rawOperation)) {
        if (typeof parameter.name !== 'string') continue;
        if (parameter.in !== 'path' && parameter.in !== 'query') continue;
        addSchemaProperty(properties, parameter.name, parameter.schema);
        if (parameter.required === true) requiredFields.add(parameter.name);
        if (parameter.in === 'path') pathFields.add(parameter.name);
        if (parameter.in === 'query') queryFields.add(parameter.name);
      }

      const bodySchema = requestBodySchema(rawOperation);
      let bodyAsValue = false;
      if (bodySchema) {
        const bodyProperties = isObject(bodySchema.properties) ? bodySchema.properties : null;
        if (bodyProperties) {
          for (const [name, schema] of Object.entries(bodyProperties)) {
            addSchemaProperty(properties, name, schema);
            bodyFields.add(name);
          }
          if (Array.isArray(bodySchema.required)) {
            for (const name of bodySchema.required) {
              if (typeof name === 'string') requiredFields.add(name);
            }
          }
        } else if (bodySchema.type !== 'object') {
          properties.body = bodySchema;
          bodyAsValue = true;
          if (isObject(rawOperation.requestBody) && rawOperation.requestBody.required === true) {
            requiredFields.add('body');
          }
        }
      }

      const inputSchema: JsonObject = { type: 'object', properties };
      if (requiredFields.size) inputSchema.required = [...requiredFields];

      const description =
        typeof rawOperation.description === 'string'
          ? rawOperation.description
          : typeof rawOperation.summary === 'string'
            ? rawOperation.summary
            : rawOperation.operationId;

      routes.set(rawOperation.operationId, {
        name: rawOperation.operationId,
        method: rawMethod.toUpperCase(),
        path,
        description,
        inputSchema,
        pathFields,
        queryFields,
        bodyFields,
        requiredFields,
        hasRequestBody: Boolean(bodySchema),
        bodyAsValue,
      });
    }
  }
  return routes;
}

function operatorToolDescriptors(routes: Map<string, OperatorRoute>): JsonObject[] {
  return [...routes.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((route) => ({
      name: route.name,
      description: route.description,
      inputSchema: route.inputSchema,
    }));
}

function queryValue(url: URL, name: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) queryValue(url, name, entry);
    return;
  }
  if (typeof value === 'object') {
    url.searchParams.append(name, JSON.stringify(value));
    return;
  }
  url.searchParams.append(name, String(value));
}

function operatorRequest(source: Request, route: OperatorRoute, args: JsonObject): Request {
  for (const name of route.requiredFields) {
    if (args[name] === undefined || args[name] === null) {
      throw new InvalidToolArgumentsError(name);
    }
  }

  let pathname = route.path;
  for (const name of route.pathFields) {
    const value = args[name];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new InvalidToolArgumentsError(name);
    }
    pathname = pathname.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  for (const name of route.queryFields) queryValue(url, name, args[name]);

  let body: unknown;
  if (route.hasRequestBody) {
    if (route.bodyAsValue) {
      body = args.body;
    } else {
      const objectBody: JsonObject = {};
      for (const name of route.bodyFields) {
        if (args[name] !== undefined) objectBody[name] = args[name];
      }
      body = objectBody;
    }
  }

  const requestHeaders = new Headers(source.headers);
  requestHeaders.delete('content-length');
  requestHeaders.delete('mcp-method');
  requestHeaders.delete('mcp-name');
  requestHeaders.delete('mcp-protocol-version');
  if (route.hasRequestBody) requestHeaders.set('content-type', 'application/json');

  return new Request(url, {
    method: route.method,
    headers: requestHeaders,
    body: route.hasRequestBody ? JSON.stringify(body ?? {}) : undefined,
  });
}

async function operatorToolResult(
  source: Request,
  route: OperatorRoute,
  args: unknown,
  invoke: ActionInvoke,
): Promise<JsonObject> {
  if (args !== undefined && !isObject(args)) throw new InvalidToolArgumentsError('arguments');
  const response = await invoke(operatorRequest(source, route, isObject(args) ? args : {}));
  const text = await response.clone().text();

  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const structuredContent = isObject(parsed)
    ? parsed
    : {
        ok: response.ok,
        status: response.status,
        content: parsed ?? text,
      };
  const displayText = text || JSON.stringify(structuredContent);

  return {
    content: [{ type: 'text', text: displayText }],
    structuredContent,
    isError: !response.ok,
  };
}

function operatorSurface(
  source: Request,
  document: JsonObject,
  invoke: ActionInvoke,
): McpSurface {
  const routes = operatorRoutes(document);
  return {
    serverInfo: OPERATOR_SERVER_INFO,
    instructions:
      'Guarded MechaGremlin operator tools. Prefer high-level operations, preserve existing policy checks, and verify remote side effects before claiming success.',
    tools: () => operatorToolDescriptors(routes),
    hasTool: (name) => routes.has(name),
    callTool(name, args) {
      const route = routes.get(name);
      if (!route) throw new InvalidToolArgumentsError(name);
      return operatorToolResult(source, route, args, invoke);
    },
  };
}

export function mcpManifest(): JsonObject {
  return {
    path: MCP_PATH,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LEGACY_PROTOCOL_VERSION,
    stateless: true,
    toolNames: specialistToolNames(),
  };
}

export function operatorMcpManifest(document: JsonObject): JsonObject {
  const routes = operatorRoutes(document);
  return {
    path: MCP_PATH,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LEGACY_PROTOCOL_VERSION,
    stateless: true,
    toolNames: [...routes.keys()].sort(),
  };
}

export async function handleSpecialistMcp(
  request: Request,
  env: SpecialistToolEnv,
  invoke: ActionInvoke,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  return handleMcp(request, invoke, specialistSurface(env, fetcher));
}

export async function handleOperatorMcp(
  request: Request,
  document: JsonObject,
  invoke: ActionInvoke,
): Promise<Response | null> {
  return handleMcp(request, invoke, operatorSurface(request, document, invoke));
}
