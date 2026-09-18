import type { JsonObject } from './tools/common.ts';
import {
  invokeSpecialistTool,
  type SpecialistToolEnv,
} from './tools/registry.ts';

export type BotekEngramStoreInput = {
  text: string;
  category?: 'preference' | 'fact' | 'decision' | 'entity' | 'other';
  importance?: number;
  metadata?: JsonObject;
};

export async function botekEngramStatus(
  env: SpecialistToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  return invokeSpecialistTool('engram_status', {}, env, fetcher);
}

export async function botekEngramSearch(
  env: SpecialistToolEnv,
  query: string,
  limit = 6,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  return invokeSpecialistTool('engram_search', { query, limit }, env, fetcher);
}

export async function botekEngramStore(
  env: SpecialistToolEnv,
  input: BotekEngramStoreInput,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  return invokeSpecialistTool(
    'engram_store',
    {
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        client: 'botek',
      },
    },
    env,
    fetcher,
  );
}
