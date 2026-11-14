import type { ActionInvoke } from '../action-auth.ts';
import type { GithubGateway } from '../gptomek/github-gateway.ts';
import { SpecialistToolError, type JsonObject } from '../tools/common.ts';
import { operatorSurface, operatorToolNames } from '../operator/mcp-surface.ts';
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

const SPECIALIST_SERVER_INFO: JsonObject = {
  name: 'mechagremlin-specialists',
  title: 'MechaGremlin Specialist Tools',
  version: '1.0.0',
  description: 'Private bounded specialist tools shared by Gremlin Actions and MCP.',
};

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

function specialistSelection(names: readonly SpecialistToolName[]): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const name of names) {
    if (!isSpecialistToolName(name)) throw new Error(`unknown_specialist_tool:${String(name)}`);
    allowed.add(name);
  }
  return allowed;
}

export function selectedSpecialistSurface(
  env: SpecialistToolEnv,
  fetcher: typeof fetch,
  names: readonly SpecialistToolName[],
): McpSurface {
  const allowed = specialistSelection(names);
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
  return {
    path: MCP_PATH,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LEGACY_PROTOCOL_VERSION,
    stateless: true,
    toolNames: operatorToolNames(document),
  };
}

export function scopedMcpManifest(
  document: JsonObject,
  selectedSpecialistNames: readonly SpecialistToolName[],
): JsonObject {
  const allowed = specialistSelection(selectedSpecialistNames);
  const operatorNames = operatorToolNames(document);
  const specialistNames = specialistToolNames()
    .filter((name) => allowed.has(name))
    .sort();
  return {
    path: MCP_PATH,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LEGACY_PROTOCOL_VERSION,
    stateless: true,
    toolNames: [...operatorNames, ...specialistNames].sort(),
    operatorToolNames: operatorNames,
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
