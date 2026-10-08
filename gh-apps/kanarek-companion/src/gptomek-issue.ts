import type {
  CompanionEnv,
  CompanionResult,
  CompanionTarget,
} from './companion-types.ts';
import {
  handleGptomekCommentCommand,
  handleGptomekMailboxCommand,
} from './gptomek.ts';
import { createInstallationClient, GitHubApiError } from './github-app.ts';
import {
  GPTOMEK_CONTROL_ISSUE,
  GPTOMEK_CONTROL_REPOSITORY,
} from './gptomek-control.ts';

const CONTROL_REPOSITORY = GPTOMEK_CONTROL_REPOSITORY;
export { GPTOMEK_CONTROL_ISSUE };
export const GPTOMEK_WAKE_LABEL = 'gptomek-wake';
const COMMAND_MARKER = '<!-- gptomek-command:';
const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

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

function issueFailure(error: unknown): Record<string, unknown> {
  if (error instanceof GitHubApiError) {
    return { operation: error.operation, status: error.status };
  }
  if (error instanceof Error) return { reason: error.message };
  return { reason: 'unknown_error' };
}

export function isGptomekControlIssueEvent(
  metadata: WebhookMetadataLike,
  payload: Record<string, unknown>,
): boolean {
  const controlIssue = issue(payload);
  const changes = payload.changes as { body?: unknown } | undefined;
  const sender = payload.sender as { login?: unknown } | undefined;
  const label = payload.label as { name?: unknown } | undefined;
  const wake =
    (metadata.action === 'edited' && changes?.body !== undefined) ||
    ((metadata.action === 'labeled' || metadata.action === 'unlabeled') &&
      label?.name === GPTOMEK_WAKE_LABEL);
  return (
    metadata.event === 'issues' &&
    wake &&
    metadata.repository === CONTROL_REPOSITORY &&
    controlIssue?.number === GPTOMEK_CONTROL_ISSUE &&
    controlIssue.state === 'open' &&
    controlIssue.user?.login === 'trvny' &&
    sender?.login === 'trvny' &&
    typeof controlIssue.body === 'string' &&
    controlIssue.body.includes(COMMAND_MARKER)
  );
}

async function controlClient(
  env: CompanionEnv,
  fetcher: typeof fetch,
) {
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new Error('invalid_gptomek_installation_id');
  }
  return createInstallationClient(
    String(env.GPTOMEK_APP_ID ?? ''),
    String(env.GPTOMEK_PRIVATE_KEY ?? ''),
    installationId,
    fetcher,
  );
}

async function currentIssue(
  env: CompanionEnv,
  fetcher: typeof fetch,
): Promise<{ body: string | null; user: { login: string } }> {
  const client = await controlClient(env, fetcher);
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
    controlIssue.state !== 'open' ||
    controlIssue.user?.login !== 'trvny'
  ) {
    throw new Error('invalid_gptomek_control_issue');
  }
  return {
    body: typeof controlIssue.body === 'string' ? controlIssue.body : null,
    user: { login: 'trvny' },
  };
}

async function currentIssueComment(
  commentId: number,
  env: CompanionEnv,
  fetcher: typeof fetch,
): Promise<{ body: string; id: number }> {
  const client = await controlClient(env, fetcher);
  const comment = await client.json<{
    body?: unknown;
    id?: unknown;
    issue_url?: unknown;
    user?: { login?: unknown };
  }>(
    `/repos/${CONTROL_REPOSITORY}/issues/comments/${commentId}`,
    'gptomek_get_control_comment',
  );
  const issueUrl = `https://api.github.com/repos/${CONTROL_REPOSITORY}/issues/${GPTOMEK_CONTROL_ISSUE}`;
  if (
    comment.id !== commentId ||
    comment.issue_url !== issueUrl ||
    comment.user?.login !== 'trvny' ||
    typeof comment.body !== 'string'
  ) {
    throw new Error('invalid_gptomek_control_comment');
  }
  return { body: comment.body, id: commentId };
}

export async function handleGptomekCommentControl(
  target: CompanionTarget,
  env: CompanionEnv,
  fetcher: typeof fetch = runtimeFetch,
): Promise<CompanionResult> {
  if (
    target.repository !== CONTROL_REPOSITORY ||
    target.pullRequestNumber !== GPTOMEK_CONTROL_ISSUE ||
    target.sourceEvent !== 'gptomek_comment' ||
    typeof target.commentId !== 'number' ||
    !Number.isInteger(target.commentId) ||
    target.commentId <= 0
  ) {
    throw new Error('invalid_gptomek_comment_target');
  }

  try {
    const comment = await currentIssueComment(target.commentId, env, fetcher);
    const result = await handleGptomekCommentCommand(comment.body, env, fetcher);
    return {
      changed: result.handled,
      commentId: target.commentId,
      quipSource: 'preset',
      state: result.result?.ok ? 'gptomek-comment-ok' : 'gptomek-comment-error',
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        gptomek: 'comment_control_failed',
        commentId: target.commentId,
        failure: issueFailure(error),
        issueNumber: target.pullRequestNumber,
        repository: target.repository,
      }),
    );
    throw error;
  }
}

export async function handleGptomekIssueControl(
  target: CompanionTarget,
  env: CompanionEnv,
  fetcher: typeof fetch = runtimeFetch,
): Promise<CompanionResult> {
  if (
    target.repository !== CONTROL_REPOSITORY ||
    target.pullRequestNumber !== GPTOMEK_CONTROL_ISSUE ||
    target.sourceEvent !== 'issues'
  ) {
    throw new Error('invalid_gptomek_issue_target');
  }

  try {
    const controlIssue = await currentIssue(env, fetcher);
    const result = await handleGptomekMailboxCommand(
      controlIssue.body,
      `/repos/${CONTROL_REPOSITORY}/issues/${GPTOMEK_CONTROL_ISSUE}`,
      env,
      fetcher,
    );
    return {
      changed: result.handled,
      commentId: null,
      quipSource: 'preset',
      state: 'gptomek-control',
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        gptomek: 'issue_control_failed',
        failure: issueFailure(error),
        issueNumber: target.pullRequestNumber,
        repository: target.repository,
      }),
    );
    throw error;
  }
}
