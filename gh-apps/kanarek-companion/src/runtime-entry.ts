import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  botekEngramSearch,
  botekEngramStatus,
  botekEngramStore,
  botekFeedseekRecent,
  botekGithubPullStatus,
  type BotekEngramStoreInput,
} from './botek-specialists.ts';
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

export default runtime;
