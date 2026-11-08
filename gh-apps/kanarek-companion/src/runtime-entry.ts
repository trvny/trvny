import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  botekEngramSearch,
  botekEngramStatus,
  botekEngramStore,
  botekFeedseekRecent,
  botekGithubPullStatus,
  type BotekEngramStoreInput,
} from './specialists/botek-specialists.ts';
import { createAppJwt, createInstallationClient, repositoryInstallationId } from '../../core/github-app.ts';
import { githubReadAllowed } from './gptomek/github-gateway.ts';
import { requestGrokReview } from './companion/xai-review-rpc.ts';
import runtime, { actionFetch, type RuntimeEnv } from './runtime.ts';
import type { JsonObject } from './tools/common.ts';

export {
  actionFetch,
  AnchorMutationReplayStore,
  CommentProbeLock,
  OperatorCheckpointStore,
  ReviewProviderCooldownStore,
  WebhookReviewJob,
} from './runtime.ts';

export class BotekSpecialistEntrypoint extends WorkerEntrypoint<RuntimeEnv> {
  async engramStatus(): Promise<JsonObject> {
    return botekEngramStatus(this.env, actionFetch);
  }

  async engramSearch(query: string, limit = 6): Promise<JsonObject> {
    return botekEngramSearch(this.env, query, limit, actionFetch);
  }

  async engramStore(input: BotekEngramStoreInput): Promise<JsonObject> {
    return botekEngramStore(this.env, input, actionFetch);
  }

  async feedseekRecent(input: {
    query?: string;
    since?: string;
    limit?: number;
    sources?: string[];
  }): Promise<JsonObject> {
    return botekFeedseekRecent(this.env, input, actionFetch);
  }

  async githubPullStatus(repository: string, number: number): Promise<JsonObject> {
    return botekGithubPullStatus(this.env, repository, number, actionFetch);
  }
}

// GPTomek App JWT minting for Workers bound without the PEM (Gremlin), so the
// key lives here only. Service-binding RPC; not reachable from the internet.
export class GptomekSignerEntrypoint extends WorkerEntrypoint<RuntimeEnv> {
  async gptomekAppJwt(): Promise<string> {
    const appId = this.env.GPTOMEK_APP_ID?.trim();
    const privateKey = this.env.GPTOMEK_PRIVATE_KEY?.trim();
    if (!appId || !privateKey) throw new Error('gptomek_not_configured');
    return createAppJwt(appId, privateKey);
  }
}

export class KanarekXaiReviewRpc extends WorkerEntrypoint<RuntimeEnv> {
  async completeReview(input: unknown, deadlineAt: number) {
    return requestGrokReview(input, this.env.XAI_API_KEY, fetch, deadlineAt, async (repository) => {
      const install = await repositoryInstallationId(
        this.env.GITHUB_APP_ID, this.env.GITHUB_PRIVATE_KEY, repository, fetch);
      const client = await createInstallationClient(
        this.env.GITHUB_APP_ID, this.env.GITHUB_PRIVATE_KEY, install, fetch);
      return { read: async (path: string) => {
        const repoPath = '/repos/' + repository + '/';
        const search = path.startsWith('/search/code?') ?
          new URL(path, 'https://api.github.com').searchParams.get('q') : null;
        const exactSearch = search !== null && search.endsWith(' repo:' + repository) &&
          search.split(/\s+/).filter((part) => part.startsWith('repo:')).length === 1;
        if (!githubReadAllowed(path) || (!path.startsWith(repoPath) && !exactSearch)) {
          throw new Error('grok_agent_read_out_of_scope');
        }
        return client.json(path, 'grok_agent_scoped_read');
      } };
    });
  }
}

export default runtime;
