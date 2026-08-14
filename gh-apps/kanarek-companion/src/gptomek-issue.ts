import type {
  CompanionEnv,
  CompanionResult,
  CompanionTarget,
  PullRequest,
} from './companion-types.ts';
import { handleGptomekControl } from './gptomek.ts';
import { createInstallationClient } from './github-app.ts';

const CONTROL_REPOSITORY = 'trvny/trvny';
const LEGACY_CONTROL_PULL_REQUEST = 176;
export const GPTOMEK_CONTROL_ISSUE = 203;
const COMMAND_MARKER = '<!-- gptomek-command:';

interface WebhookMetadataLike {
  action: string | null;
  event: string | null;
  repository: string | null;
}

interface IssuePayload {
  body?: unknown;
  number?: unknown;
  state?: unknown;
  user?: { login?: unknown };
}

function issue(payload: Record<string, unknown>): IssuePayload | undefined {
  const value = payload.issue;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as IssuePayload)
    : undefined;
}

export function isGptomekControlIssueEdit(
  metadata: WebhookMetadataLike,
  payload: Record<string, unknown>,
): boolean {
  const controlIssue = issue(payload);
  const changes = payload.changes as { body?: unknown } | undefined;
  const sender = payload.sender as { login?: unknown } | undefined;
  return (
    metadata.event === 'issues' &&
    metadata.action === 'edited' &&
    metadata.repository === CONTROL_REPOSITORY &&
    controlIssue?.number === GPTOMEK_CONTROL_ISSUE &&
    controlIssue.state === 'closed' &&
    controlIssue.user?.login === 'trvny' &&
    sender?.login === 'trvny' &&
    changes?.body !== undefined &&
    typeof controlIssue.body === 'string' &&
    controlIssue.body.includes(COMMAND_MARKER)
  );
}

function issueMailboxFetcher(fetcher: typeof fetch): typeof fetch {
  const legacyPath = `/repos/${CONTROL_REPOSITORY}/pulls/${LEGACY_CONTROL_PULL_REQUEST}`;
  const issuePath = `/repos/${CONTROL_REPOSITORY}/issues/${GPTOMEK_CONTROL_ISSUE}`;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'PATCH' && url.pathname === legacyPath) {
      url.pathname = issuePath;
      return input instanceof Request
        ? fetcher(new Request(url, input), init)
        : fetcher(url, init);
    }
    return fetcher(input, init);
  }) as typeof fetch;
}

async function currentIssue(
  env: CompanionEnv,
  fetcher: typeof fetch,
): Promise<Pick<PullRequest, 'body' | 'user'>> {
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new Error('invalid_gptomek_installation_id');
  }
  const client = await createInstallationClient(
    String(env.GPTOMEK_APP_ID ?? ''),
    String(env.GPTOMEK_PRIVATE_KEY ?? ''),
    installationId,
    fetcher,
  );
  const controlIssue = await client.json<{
    body?: unknown;
    number?: unknown;
    state?: unknown;
    user?: { login?: unknown };
  }>(
    `/repos/${CONTROL_REPOSITORY}/issues/${GPTOMEK_CONTROL_ISSUE}`,
    'gptomek_get_control_issue',
  );
  if (
    controlIssue.number !== GPTOMEK_CONTROL_ISSUE ||
    controlIssue.state !== 'closed' ||
    controlIssue.user?.login !== 'trvny'
  ) {
    throw new Error('invalid_gptomek_control_issue');
  }
  return {
    body: typeof controlIssue.body === 'string' ? controlIssue.body : null,
    user: { login: 'trvny' },
  };
}

export async function handleGptomekIssueControl(
  target: CompanionTarget,
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
): Promise<CompanionResult> {
  if (
    target.repository !== CONTROL_REPOSITORY ||
    target.pullRequestNumber !== GPTOMEK_CONTROL_ISSUE ||
    target.sourceEvent !== 'issues'
  ) {
    throw new Error('invalid_gptomek_issue_target');
  }

  const controlIssue = await currentIssue(env, fetcher);
  const legacyTarget: CompanionTarget = {
    ...target,
    pullRequestNumber: LEGACY_CONTROL_PULL_REQUEST,
  };
  const result = await handleGptomekControl(
    legacyTarget,
    controlIssue as PullRequest,
    env,
    issueMailboxFetcher(fetcher),
  );
  return {
    changed: result.handled,
    commentId: null,
    quipSource: 'preset',
    state: 'gptomek-control',
  };
}
