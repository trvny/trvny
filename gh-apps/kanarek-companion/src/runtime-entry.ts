import { WorkerEntrypoint, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runFreeReviewWorkflowPrototype, runFreeReviewWorkflowSmoke } from './companion/review-workflow.ts';
import { assertFreeReviewWorkflowJob, type StoredJob } from './companion/webhook-review.ts';
import { requestManagedReviewAuthorization, reviewWorkflowCompletion, reviewWorkflowInstanceId, type ManagedWorkflowParams } from './companion/review-workflow-lifecycle.ts';
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
import { requestGrokReview, requestGrokReviewOnce } from './companion/xai-review-rpc.ts';
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
  async completeReviewOnce(input: unknown, deadlineAt: number) {
    return requestGrokReviewOnce(input, this.env.XAI_API_KEY, fetch, deadlineAt);
  }

  async completeReview(input: unknown, deadlineAt: number) {
    return requestGrokReview(input, this.env.XAI_API_KEY, fetch, deadlineAt, async (repository) => {
      const boundedFetch: typeof fetch = (url, init = {}) => {
        const remaining = deadlineAt - Date.now() - 5_000;
        if (remaining <= 0) throw new Error('grok_agent_github_deadline');
        return fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(30_000, remaining)) });
      };
      const install = await repositoryInstallationId(
        this.env.GITHUB_APP_ID, this.env.GITHUB_PRIVATE_KEY, repository, boundedFetch);
      const client = await createInstallationClient(
        this.env.GITHUB_APP_ID, this.env.GITHUB_PRIVATE_KEY, install, boundedFetch);
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

// Draft workflow. Only manual invocation; production webhooks still use the DO.
type PrototypeParams = StoredJob | { mode: 'binding-smoke' } | ManagedWorkflowParams;

async function managedReviewAuthorized(env: RuntimeEnv, job: StoredJob, signal: AbortSignal): Promise<boolean> {
  const queue = env.KANAREK_REVIEW_JOBS;
  if (!queue || env.KANAREK_REVIEW_WORKFLOW_MANAGED_ENABLED !== 'true' || signal.aborted) return false;
  const stub = queue.get(queue.idFromName(`${job.target.repository}#${job.target.number}`));
  return requestManagedReviewAuthorization((requestSignal) => stub.fetch(
    'https://kanarek-review.internal/workflow/authorize', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job), signal: requestSignal,
    },
  ), signal);
}

export class KanarekFreeReviewPrototype extends WorkflowEntrypoint<RuntimeEnv, PrototypeParams> {
  async run(event: WorkflowEvent<PrototypeParams>, step: WorkflowStep) {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && 'mode' in payload && payload.mode === 'binding-smoke') {
      return runFreeReviewWorkflowSmoke(this.env, step);
    }
    if (payload && typeof payload === 'object' && 'mode' in payload && payload.mode === 'managed') {
      assertFreeReviewWorkflowJob(payload.job, this.env);
      if (event.instanceId !== await reviewWorkflowInstanceId(payload.job.target)) {
        throw new Error('review_workflow_instance_identity_mismatch');
      }
      const result = await runFreeReviewWorkflowPrototype(payload.job, this.env, step, undefined,
        (signal) => managedReviewAuthorized(this.env, payload.job, signal));
      const receipt = reviewWorkflowCompletion(result);
      if (!receipt) throw new Error('review_workflow_invalid_completion');
      // Retry storage only, never inference or publication.
      const stored = await step.do('persist-completion-receipt', {
        retries: { limit: 3, delay: '5 seconds' }, timeout: '1 minute',
      }, async () => {
        const queue = this.env.KANAREK_REVIEW_JOBS;
        if (!queue || this.env.KANAREK_REVIEW_WORKFLOW_MANAGED_ENABLED !== 'true') {
          throw new Error('review_workflow_completion_unavailable');
        }
        const { repository, number } = payload.job.target;
        const stub = queue.get(queue.idFromName(`${repository}#${number}`));
        const response = await stub.fetch('https://kanarek-review.internal/workflow/complete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job: payload.job, receipt }), signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('review_workflow_completion_unavailable');
        }
        const body = await response.json() as { stored?: boolean };
        if (typeof body.stored !== 'boolean') throw new Error('review_workflow_completion_invalid_response');
        return body.stored;
      });
      if (!stored) {
        return { mode: 'prototype', status: 'skipped', reason: 'managed_workflow_completion_revoked' } as const;
      }
      return result;
    }
    return runFreeReviewWorkflowPrototype(payload as StoredJob, this.env, step);
  }
}

// Private service-binding RPC only. No public route or automatic trigger.
export class KanarekReviewWorkflowControl extends WorkerEntrypoint<RuntimeEnv> {
  async manage(action: 'start' | 'status' | 'cancel' | 'resume', job: StoredJob) {
    assertFreeReviewWorkflowJob(job, this.env);
    if (this.env.KANAREK_REVIEW_WORKFLOW_MANAGED_ENABLED !== 'true') {
      throw new Error('review_workflow_control_disabled');
    }
    const queue = this.env.KANAREK_REVIEW_JOBS;
    if (!queue) throw new Error('review_workflow_control_unconfigured');
    const stub = queue.get(queue.idFromName(`${job.target.repository}#${job.target.number}`));
    const response = await stub.fetch(`https://kanarek-review.internal/workflow/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job),
    });
    return { status: response.status, body: await response.json() as JsonObject | null };
  }
}

export { GptomekWebhookJob } from './gptomek/gptomek-webhook.ts';

export default runtime;
