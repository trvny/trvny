import {
  runFreeReviewWebhook,
  type FreeReviewEnv,
  type FreeReviewResult,
} from './free-review.ts';

const JOB_KEY = 'free-review-job';
const STATUS_KEY = 'free-review-status';
const SHA_RE = /^[0-9a-f]{40}$/i;

interface FreeReviewJobEnv extends FreeReviewEnv {
  FREE_REVIEW_QUEUE?: DurableObjectNamespace;
}

interface StoredJob {
  body: string;
  headSha: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function targetFromPayload(payload: Record<string, unknown>): {
  headSha: string;
  number: number;
  repository: string;
} | null {
  const repository = objectValue(payload.repository);
  const pullRequest = objectValue(payload.pull_request);
  const head = objectValue(pullRequest.head);
  const fullName =
    typeof repository.full_name === 'string' ? repository.full_name : '';
  const number = typeof payload.number === 'number' ? payload.number : 0;
  const headSha = typeof head.sha === 'string' ? head.sha.toLowerCase() : '';
  return fullName && number > 0 && SHA_RE.test(headSha)
    ? { repository: fullName, number, headSha }
    : null;
}

async function queueReview(
  request: Request,
  env: FreeReviewJobEnv,
): Promise<void> {
  const queue = env.FREE_REVIEW_QUEUE;
  if (!queue) throw new Error('free_review_queue_not_configured');

  let payload: Record<string, unknown>;
  try {
    payload = objectValue(await request.clone().json());
  } catch {
    return;
  }
  const target = targetFromPayload(payload);
  if (!target) return;

  const id = queue.idFromName(
    `${target.repository}#${target.number}:${target.headSha}`,
  );
  const response = await queue.get(id).fetch(
    'https://kanarek-companion.internal/free-review/enqueue',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      body: await request.text(),
    },
  );
  if (!response.ok) {
    throw new Error(`free_review_enqueue_failed_${response.status}`);
  }
}

export function scheduleFreeReviewWebhook(
  request: Request,
  env: FreeReviewJobEnv,
  ctx?: ExecutionContext,
): void {
  const task = queueReview(request, env).catch((error) => {
    console.error(
      JSON.stringify({
        freeReview: 'enqueue_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
  });
  if (ctx) ctx.waitUntil(task);
  else void task;
}

export class FreeReviewJob {
  private readonly env: FreeReviewJobEnv;
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: FreeReviewJobEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/free-review/enqueue'
    ) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    if ((await this.state.storage.get<string>(STATUS_KEY)) !== undefined) {
      return Response.json({ ok: true, duplicate: true });
    }

    const body = await request.text();
    let payload: Record<string, unknown>;
    try {
      payload = objectValue(JSON.parse(body));
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const target = targetFromPayload(payload);
    if (!target) {
      return Response.json({ error: 'invalid_target' }, { status: 400 });
    }

    const job: StoredJob = { body, headSha: target.headSha };
    await this.state.storage.put({
      [JOB_KEY]: job,
      [STATUS_KEY]: 'queued',
    });
    await this.state.storage.setAlarm(Date.now() + 1);
    return Response.json({ ok: true, queued: true });
  }

  async alarm(): Promise<void> {
    const job = await this.state.storage.get<StoredJob>(JOB_KEY);
    if (!job) {
      await this.state.storage.delete(STATUS_KEY);
      return;
    }

    await this.state.storage.put(STATUS_KEY, 'running');
    let result: FreeReviewResult | null = null;
    try {
      result = await runFreeReviewWebhook(
        new Request('https://kanarek-companion.internal/free-review/run', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'pull_request',
          },
          body: job.body,
        }),
        this.env,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          freeReview: 'alarm_failed',
          headSha: job.headSha,
          error: error instanceof Error ? error.message : 'unknown_error',
        }),
      );
      throw error;
    }

    console.log(
      JSON.stringify({
        freeReview: 'alarm_complete',
        headSha: job.headSha,
        reviewed: result?.reviewed ?? false,
        provider: result?.provider ?? null,
        findingCount: result?.findingCount ?? 0,
        skipped: result?.skipped ?? null,
      }),
    );
    await this.state.storage.deleteAll();
  }
}
