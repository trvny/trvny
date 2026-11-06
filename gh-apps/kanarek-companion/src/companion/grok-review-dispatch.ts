import {
  createInstallationClient,
  repositoryInstallationId,
} from '../../../core/github-app.ts';

const GROK_WORKFLOW_REPOSITORY = 'travnie/.github';
const GROK_DISPATCH_EVENT = 'grok-pr-review';
const REVIEW_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);
const SHA_RE = /^[0-9a-f]{40}$/i;

interface GrokDispatchEnv {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GPTOMEK_APP_ID?: string;
  GPTOMEK_PRIVATE_KEY?: string;
}

export interface GrokDispatchTarget {
  repository: string;
  number: number;
  head_sha: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function grokDispatchTarget(
  event: string | null,
  payload: Record<string, unknown>,
): GrokDispatchTarget | null {
  if (event !== 'pull_request' || !REVIEW_ACTIONS.has(String(payload.action || ''))) {
    return null;
  }

  const pr = objectValue(payload.pull_request);
  const head = objectValue(pr.head);
  const author = objectValue(pr.user);
  const repository = objectValue(payload.repository);
  const headRepo = objectValue(head.repo);
  const labels = Array.isArray(pr.labels) ? pr.labels : [];
  const fullName = repository.full_name;
  const number = payload.number;
  const headSha = head.sha;

  if (typeof fullName !== 'string' ||
    !/^(?:trvny|travnie)\/[A-Za-z0-9_.-]+$/.test(fullName) ||
    !Number.isSafeInteger(number) || (number as number) <= 0 ||
    typeof headSha !== 'string' || !SHA_RE.test(headSha) ||
    pr.draft === true ||
    headRepo.full_name !== fullName ||
    (author.type === 'Bot' || (typeof author.login === 'string' && /\[bot\]$/i.test(author.login))) ||
    labels.some((label) => String(objectValue(label).name || '').toLowerCase() === 'no-goblin')) {
    return null;
  }

  return { repository: fullName, number: number as number, head_sha: headSha.toLowerCase() };
}

async function dispatchThroughApp(
  target: GrokDispatchTarget,
  appId: string,
  privateKey: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  const installationId = await repositoryInstallationId(
    appId,
    privateKey,
    GROK_WORKFLOW_REPOSITORY,
    fetcher,
  );
  const client = await createInstallationClient(
    appId,
    privateKey,
    installationId,
    fetcher,
  );
  if (client.permissions.contents !== 'write') return false;
  await client.void(
    '/repos/travnie/.github/dispatches',
    'dispatch_grok_pr_review',
    {
      method: 'POST',
      body: JSON.stringify({
        event_type: GROK_DISPATCH_EVENT,
        client_payload: target,
      }),
    },
  );
  return true;
}

export async function dispatchGrokReview(
  target: GrokDispatchTarget,
  env: GrokDispatchEnv,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  if (await dispatchThroughApp(
    target,
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    fetcher,
  )) return;

  // Dispatch transport only. Reviews still publish as Kanarek, not GPTomek.
  if (env.GPTOMEK_APP_ID && env.GPTOMEK_PRIVATE_KEY &&
      await dispatchThroughApp(
        target,
        env.GPTOMEK_APP_ID,
        env.GPTOMEK_PRIVATE_KEY,
        fetcher,
      )) {
    console.info(JSON.stringify({ grokReviewDispatch: 'fallback_transport' }));
    return;
  }

  throw new Error('grok_dispatch_contents_write_required');
}
