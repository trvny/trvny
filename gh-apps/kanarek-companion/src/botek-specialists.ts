import { checks, pull, reviews } from './companion-github.ts';
import {
  createInstallationClient,
  type GitHubInstallationClient,
  gptomekInstallationIdFor,
} from './github-app.ts';
import { repositoryInScope, type JsonObject } from './tools/common.ts';
import {
  invokeSpecialistTool,
  type SpecialistToolEnv,
} from './tools/registry.ts';

export type BotekWatchEnv = SpecialistToolEnv & {
  GPTOMEK_APP_ID?: string;
  GPTOMEK_INSTALLATION_ID?: string;
  GPTOMEK_PRIVATE_KEY?: string;
};

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


function botekRepository(value: string): string {
  const repository = value.trim();
  if (!repositoryInScope(repository) || repository.split('/')[1].length > 100) {
    throw new Error('botek_repository_not_allowed');
  }
  return repository;
}

function positiveInteger(value: number, name: string, max = 1_000_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`invalid_${name}`);
  }
  return value;
}

async function botekGithubClient(
  env: BotekWatchEnv,
  fetcher: typeof fetch,
  repositoryName: string,
): Promise<GitHubInstallationClient> {
  const appId = env.GPTOMEK_APP_ID?.trim() ?? '';
  const privateKey = env.GPTOMEK_PRIVATE_KEY?.trim() ?? '';
  if (!appId || !privateKey) throw new Error('gptomek_not_configured');
  const installationId = await gptomekInstallationIdFor(
    env.GPTOMEK_INSTALLATION_ID,
    appId,
    privateKey,
    repositoryName,
    fetcher,
  );
  if (installationId === null) throw new Error('gptomek_not_configured');
  return createInstallationClient(appId, privateKey, installationId, fetcher);
}

export async function botekFeedseekRecent(
  env: BotekWatchEnv,
  input: { query?: string; since?: string; limit?: number; sources?: string[] },
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  return invokeSpecialistTool(
    'feedseek_recent',
    {
      query: input.query ?? '',
      ...(input.since ? { since: input.since } : {}),
      ...(input.sources?.length ? { sources: input.sources } : {}),
      limit: input.limit ?? 20,
    },
    env,
    fetcher,
  );
}

export async function botekGithubPullStatus(
  env: BotekWatchEnv,
  repositoryValue: string,
  numberValue: number,
  fetcher: typeof fetch = fetch,
  existingClient?: GitHubInstallationClient,
): Promise<JsonObject> {
  const repository = botekRepository(repositoryValue);
  const number = positiveInteger(numberValue, 'pull_request_number');
  const client = existingClient ?? await botekGithubClient(env, fetcher, repository);
  const pr = await pull(client, repository, number);
  const [ci, reviewState] = await Promise.all([
    checks(client, repository, pr.head.sha),
    reviews(client, repository, number),
  ]);
  return {
    ok: true,
    repository,
    number,
    title: typeof pr.title === 'string' ? pr.title.slice(0, 300) : null,
    state: pr.state,
    merged: pr.merged,
    draft: pr.draft,
    headSha: pr.head.sha,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    ci: {
      total: ci.total,
      pending: ci.pending.length,
      failed: ci.failed.length,
      passed: ci.passed.length,
    },
    reviews: reviewState,
  };
}
