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

export async function dispatchGrokReview(
  target: GrokDispatchTarget,
  env: GrokDispatchEnv,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  const installationId = await repositoryInstallationId(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    GROK_WORKFLOW_REPOSITORY,
    fetcher,
  );
  const client = await createInstallationClient(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    installationId,
    fetcher,
  );
  if (client.permissions.contents !== 'write') {
    throw new Error('grok_dispatch_contents_write_required');
  }
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
}
