import { GitHubApiError } from '../../../core/github-app.ts';
import type { CompanionEnv, CompanionResult, CompanionTarget } from '../companion/companion-types.ts';
import { json } from '../json-response.ts';
import { GPTOMEK_CONTROL_ISSUE, commentBodySha256, markGptomekWebhookFailure } from './gptomek-issue.ts';
import { GPTOMEK_CONTROL_REPOSITORY } from './gptomek-control.ts';

export const GPTOMEK_WEBHOOK_PATH = '/webhooks/gptomek';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RECEIPT_MS = MAX_AGE_MS + 24 * 60 * 60 * 1000;
const RETRY_MS = [10_000, 60_000, 300_000, 900_000, 1800_000, 3600_000];
const JOB_KEY = 'job';

export interface GptomekWebhookEnv extends CompanionEnv {
  COMPANION_LOCK: DurableObjectNamespace;
  GPTOMEK_WEBHOOK_SECRET?: string;
  GPTOMEK_WEBHOOK_PRIMARY?: string;
  GPTOMEK_WEBHOOK_JOBS?: DurableObjectNamespace;
}

interface JobTarget {
  commentId: number;
  bodySha256: string;
  installationId: number;
}
type Job = JobTarget & {
  phase: 'execute' | 'cleanup' | 'failure' | 'done' | 'stopped';
  attempts: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export async function gptomekWebhookTarget(
  event: string | null, payload: unknown, env: GptomekWebhookEnv,
): Promise<JobTarget | null> {
  const p = object(payload);
  const issue = object(p.issue);
  const comment = object(p.comment);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  const created = typeof comment.created_at === 'string' ? Date.parse(comment.created_at) : NaN;
  if (event !== 'issue_comment' || p.action !== 'created' ||
      object(p.repository).full_name !== GPTOMEK_CONTROL_REPOSITORY ||
      issue.number !== GPTOMEK_CONTROL_ISSUE || issue.state !== 'open' || 'pull_request' in issue ||
      object(issue.user).login !== 'trvny' || object(p.sender).login !== 'trvny' ||
      object(comment.user).login !== 'trvny' || !positiveId(comment.id) ||
      !positiveId(installationId) || object(p.installation).id !== installationId ||
      !Number.isFinite(created) || created < Date.now() - MAX_AGE_MS ||
      comment.created_at !== comment.updated_at || typeof comment.body !== 'string' ||
      !/^\s*\x60{3}gptomek[ \t]*\r?\n/.test(comment.body)) return null;
  return { commentId: comment.id, installationId, bodySha256: await commentBodySha256(comment.body) };
}

function validJobTarget(value: unknown): value is JobTarget {
  const p = object(value);
  return positiveId(p.commentId) && positiveId(p.installationId) &&
    typeof p.bodySha256 === 'string' && /^[a-f0-9]{64}$/.test(p.bodySha256);
}

// One object per comment. Only the existing mailbox lock executes commands.
export class GptomekWebhookJob {
  constructor(private readonly state: DurableObjectState, private readonly env: GptomekWebhookEnv) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (!validJobTarget(input)) return json({ error: 'invalid_webhook_job' }, 400);
    const previous = await this.state.storage.get<Job>(JOB_KEY);
    if (previous) {
      if (previous.bodySha256 !== input.bodySha256) return json({ error: 'comment_changed' }, 409);
      return json({ ok: true, duplicate: true });
    }
    await Promise.all([
      this.state.storage.put(JOB_KEY, { ...input, phase: 'execute', attempts: 0 } satisfies Job),
      this.state.storage.setAlarm(Date.now()),
    ]);
    return json({ ok: true, duplicate: false });
  }

  private async refresh(job: Job): Promise<CompanionResult> {
    const target: CompanionTarget = {
      delivery: 'gptomek-webhook:' + job.commentId + ':' + crypto.randomUUID(),
      repository: GPTOMEK_CONTROL_REPOSITORY,
      pullRequestNumber: GPTOMEK_CONTROL_ISSUE,
      installationId: job.installationId,
      sourceEvent: 'gptomek_comment',
      commentId: job.commentId,
      expectedCommentBodySha256: job.bodySha256,
      cleanupComment: job.phase === 'cleanup',
    };
    const id = this.env.COMPANION_LOCK.idFromName(target.repository + '#' + target.pullRequestNumber);
    const response = await this.env.COMPANION_LOCK.get(id).fetch('https://kanarek-companion.internal/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target),
    });
    const payload = await response.json() as { ok?: boolean; result?: CompanionResult };
    if (!response.ok || !payload.ok || !payload.result) throw new Error('mailbox_refresh_unconfirmed');
    return payload.result;
  }

  private async persist(job: Job, delay: number): Promise<void> {
    await Promise.all([
      this.state.storage.put(JOB_KEY, job),
      this.state.storage.setAlarm(Date.now() + delay),
    ]);
  }

  async alarm(): Promise<void> {
    const job = await this.state.storage.get<Job>(JOB_KEY);
    if (!job) return;
    if (job.phase === 'done' || job.phase === 'stopped') {
      await this.state.storage.delete(JOB_KEY);
      return;
    }
    // Re-arm before I/O; survive a reset between a side effect and persistence.
    await this.state.storage.setAlarm(Date.now() + RETRY_MS[0]);
    try {
      let phase: Job['phase'] = 'done';
      if (job.phase === 'failure') {
        await markGptomekWebhookFailure(job.commentId, job.bodySha256, this.env);
      } else {
        const result = await this.refresh(job);
        if (result.state === 'gptomek-comment-ok') {
          if (job.phase === 'execute') phase = 'cleanup';
          else if (result.commentCleanup === 'failed') throw new Error('comment_cleanup_failed');
          else if (result.commentCleanup !== 'deleted' && result.commentCleanup !== 'preserved') {
            throw new Error('comment_cleanup_unconfirmed');
          }
        } else if (result.state === 'gptomek-comment-error' && job.phase === 'execute') {
          phase = 'failure';
        } else if (!['gptomek-comment-missing', 'gptomek-comment-stale'].includes(result.state)) {
          throw new Error('unexpected_mailbox_state');
        }
      }
      await this.persist({ ...job, phase, attempts: 0 }, phase === 'done' ? RECEIPT_MS : 0);
      console.log(JSON.stringify({ gptomek: 'webhook_phase', commentId: job.commentId, phase }));
    } catch (error) {
      const attempts = job.attempts + 1;
      const stopped = attempts > RETRY_MS.length;
      const failure = error instanceof GitHubApiError ? error.operation + ':' + error.status
        : error instanceof Error ? error.message : 'unknown_error';
      console.warn(JSON.stringify({ gptomek: 'webhook_retry', commentId: job.commentId,
        phase: job.phase, attempts, stopped, failure }));
      await this.persist({ ...job, attempts, phase: stopped ? 'stopped' : job.phase },
        stopped ? RECEIPT_MS : RETRY_MS[attempts - 1]);
    }
  }
}
