import type { ActionInvoke } from '../action-auth.ts';
import type { GithubGateway } from '../gptomek/github-gateway.ts';
import { SpecialistToolError, isObject, type JsonObject } from '../tools/common.ts';
import {
  invokeSpecialistTool,
  isSpecialistToolName,
  specialistToolDescriptors,
  specialistToolNames,
  type SpecialistToolEnv,
  type SpecialistToolName,
} from '../tools/registry.ts';
import {
  handleMcp,
  InvalidToolArgumentsError,
  LEGACY_PROTOCOL_VERSION,
  MCP_PATH,
  MCP_PROTOCOL_VERSION,
  type McpSurface,
} from './mcp-protocol.ts';

export { MCP_PATH, MCP_PROTOCOL_VERSION } from './mcp-protocol.ts';

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
  // Reuse the canonical public plugin artwork; no second icon asset or Worker route.
  icons: [{ src: 'https://raw.githubusercontent.com/trvny/trvny/main/gh-apps/gremlin/plugin/assets/gpt-icon.png', mimeType: 'image/png' }],
};

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

function specialistSelection(names: readonly SpecialistToolName[]): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const name of names) {
    if (!isSpecialistToolName(name)) throw new Error(`unknown_specialist_tool:${String(name)}`);
    allowed.add(name);
  }
  return allowed;
}

function selectedSpecialistSurface(
  env: SpecialistToolEnv,
  fetcher: typeof fetch,
  allowed: ReadonlySet<string>,
): McpSurface {
  const source = specialistSurface(env, fetcher);
  return {
    ...source,
    tools: () => source.tools().filter(
      (tool) => allowed.has(String(tool.name)),
    ),
    hasTool: (name) => allowed.has(name) && source.hasTool(name),
    callTool(name, args) {
      if (!allowed.has(name)) {
        throw new InvalidToolArgumentsError(name);
      }
      return source.callTool(name, args);
    },
  };
}

function combinedSurface(
  primary: McpSurface,
  secondary: McpSurface,
): McpSurface {
  const primaryTools = primary.tools();
  const secondaryTools = secondary.tools();
  const names = new Set<string>();
  for (const tool of [...primaryTools, ...secondaryTools]) {
    if (typeof tool.name !== 'string') continue;
    if (names.has(tool.name)) throw new Error(`duplicate_mcp_tool:${tool.name}`);
    names.add(tool.name);
  }
  const specialistLabel = secondaryTools.length === 0
    ? ''
    : secondaryTools.every((tool) => typeof tool.name === 'string' && tool.name.startsWith('feedseek_'))
      ? ' and Feedseek'
      : ' and selected specialist tools';
  return {
    serverInfo: OPERATOR_SERVER_INFO,
    instructions: `Guarded GPTomek workflows${specialistLabel}. Use direct provider apps for ordinary calls.`,
    serializeBatchToolCalls: true,
    tools: () => [...primaryTools, ...secondaryTools].map((tool) => ({ ...tool })),
    hasTool: (name) => primary.hasTool(name) || secondary.hasTool(name),
    callTool(name, args) {
      if (primary.hasTool(name)) return primary.callTool(name, args);
      if (secondary.hasTool(name)) return secondary.callTool(name, args);
      throw new InvalidToolArgumentsError(name);
    },
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
    serializeBatchToolCalls: true,
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

export function scopedMcpManifest(
  document: JsonObject,
  selectedSpecialistNames: readonly SpecialistToolName[],
): JsonObject {
  const allowed = specialistSelection(selectedSpecialistNames);
  const operatorToolNames = [...operatorRoutes(document).keys()].sort();
  const specialistNames = specialistToolNames()
    .filter((name) => allowed.has(name))
    .sort();
  return {
    path: MCP_PATH,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LEGACY_PROTOCOL_VERSION,
    stateless: true,
    toolNames: [...operatorToolNames, ...specialistNames].sort(),
    operatorToolNames,
    specialistToolNames: specialistNames,
  };
}

export async function handleSpecialistMcp(
  request: Request,
  env: SpecialistToolEnv,
  github: GithubGateway,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  return handleMcp(request, github, specialistSurface(env, fetcher));
}

export async function handleOperatorMcp(
  request: Request,
  document: JsonObject,
  invoke: ActionInvoke,
  github: GithubGateway,
): Promise<Response | null> {
  return handleMcp(request, github, operatorSurface(request, document, invoke));
}

export async function handleScopedMcp(
  request: Request,
  document: JsonObject,
  env: SpecialistToolEnv,
  invoke: ActionInvoke,
  github: GithubGateway,
  selectedSpecialistNames: readonly SpecialistToolName[],
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  return handleMcp(
    request,
    github,
    combinedSurface(
      operatorSurface(request, document, invoke),
      selectedSpecialistSurface(env, fetcher, specialistSelection(selectedSpecialistNames)),
    ),
  );
}
