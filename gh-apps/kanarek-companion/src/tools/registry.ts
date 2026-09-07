import { searchContext7Docs, type Context7ToolEnv } from './context7.ts';
import {
  ENGRAM_CATEGORIES,
  getEngramStatus,
  searchEngramMemory,
  storeEngramMemory,
  type EngramToolEnv,
} from './engram.ts';
import {
  fetchFeedseekEntry,
  getRecentFeedseekEntries,
  searchFeedseek,
} from './feedseek.ts';
import { SpecialistToolError, isObject, type JsonObject } from './common.ts';

export interface SpecialistToolEnv extends EngramToolEnv, Context7ToolEnv {}

export interface SpecialistToolDefinition {
  actionOperationId: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
}

const READ_ONLY_EXTERNAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  untrustedContentHint: true,
};

export const SPECIALIST_TOOLS = {
  engram_status: {
    actionOperationId: 'getEngramStatus',
    title: 'Engram status',
    description: 'Check whether the private Engram memory bridge is configured and reachable.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  engram_search: {
    actionOperationId: 'searchEngramMemory',
    title: 'Search Engram memory',
    description: 'Search durable private personal memory for preferences, facts and decisions.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2_000 },
        limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  engram_store: {
    actionOperationId: 'storeEngramMemory',
    title: 'Store Engram memory',
    description: 'Store one durable preference, fact, entity or decision in private Engram memory.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 8_000 },
        category: { type: 'string', enum: [...ENGRAM_CATEGORIES], default: 'other' },
        importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
        metadata: { type: 'object', properties: {} },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  context7_search: {
    actionOperationId: 'searchContext7Docs',
    title: 'Search Context7 documentation',
    description:
      'Resolve a software library and fetch current bounded documentation snippets from Context7.',
    inputSchema: {
      type: 'object',
      required: ['libraryName', 'query'],
      properties: {
        libraryName: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Library or framework name, for example React, Wrangler, or Model Context Protocol.',
        },
        query: { type: 'string', minLength: 1, maxLength: 3_000 },
        libraryId: {
          type: 'string',
          minLength: 3,
          maxLength: 320,
          description: 'Optional exact Context7 library ID. Omit to resolve from libraryName and query.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  feedseek_search: {
    actionOperationId: 'searchFeedseek',
    title: 'Search Feedseek',
    description: 'Search the current Feedseek news and feed index by topic without copying its index into Gremlin.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2_000, default: '' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_EXTERNAL,
  },
  feedseek_fetch: {
    actionOperationId: 'fetchFeedseekEntry',
    title: 'Fetch Feedseek entry',
    description: 'Fetch one Feedseek result by the opaque immutable id returned by Feedseek search or recent.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 2_000 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_EXTERNAL,
  },
  feedseek_recent: {
    actionOperationId: 'getRecentFeedseekEntries',
    title: 'Get recent Feedseek entries',
    description: 'Get compact current Feedseek digest candidates filtered by time, topic and source keys.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', format: 'date-time', maxLength: 64 },
        query: { type: 'string', maxLength: 2_000, default: '' },
        sources: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 120 },
          maxItems: 20,
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_EXTERNAL,
  },
} as const satisfies Record<string, SpecialistToolDefinition>;

export type SpecialistToolName = keyof typeof SPECIALIST_TOOLS;

export function isSpecialistToolName(value: unknown): value is SpecialistToolName {
  return typeof value === 'string' && Object.hasOwn(SPECIALIST_TOOLS, value);
}

export function specialistToolNames(): SpecialistToolName[] {
  return Object.keys(SPECIALIST_TOOLS) as SpecialistToolName[];
}

export function specialistToolDescriptors(): JsonObject[] {
  return specialistToolNames().map((name) => {
    const definition = SPECIALIST_TOOLS[name];
    return {
      name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
    };
  });
}

export async function invokeSpecialistTool(
  name: SpecialistToolName,
  input: unknown,
  env: SpecialistToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  const args = input === undefined ? {} : input;
  if (!isObject(args)) throw new SpecialistToolError('invalid_tool_arguments');

  switch (name) {
    case 'engram_status':
      return getEngramStatus(env, fetcher);
    case 'engram_search':
      return searchEngramMemory(args, env, fetcher);
    case 'engram_store':
      return storeEngramMemory(args, env, fetcher);
    case 'context7_search':
      return searchContext7Docs(args, env, fetcher);
    case 'feedseek_search':
      return searchFeedseek(args, fetcher);
    case 'feedseek_fetch':
      return fetchFeedseekEntry(args, fetcher);
    case 'feedseek_recent':
      return getRecentFeedseekEntries(args, fetcher);
  }
}
