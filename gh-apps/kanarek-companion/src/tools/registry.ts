import { searchContext7Docs, type Context7ToolEnv } from './context7.ts';
import {
  ENGRAM_CATEGORIES,
  getEngramStatus,
  searchEngramMemory,
  storeEngramMemory,
  type EngramToolEnv,
} from './engram.ts';
import { SpecialistToolError, isObject, type JsonObject } from './common.ts';

export interface SpecialistToolEnv extends EngramToolEnv, Context7ToolEnv {}

export interface SpecialistToolDefinition {
  actionOperationId: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
}

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
  }
}
