import {
  createInstallationClient,
  GitHubApiError,
  type GitHubInstallationClient,
} from './github-app.ts';
import { MARKER } from './companion-view.ts';
import type {
  BranchState,
  CheckRun,
  CiState,
  CommitStatus,
  CompanionEnv,
  IssueComment,
  PullRequest,
  Review,
  ReviewState,
} from './companion-types.ts';

const FAIL = new Set([
  'action_required',
  'cancelled',
  'failure',
  'stale',
  'startup_failure',
  'timed_out',
]);
const PASS = new Set(['neutral', 'skipped', 'success']);

function repoParts(repository: string): [string, string] {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('invalid_repository_name');
  }
  return [encodeURIComponent(parts[0]), encodeURIComponent(parts[1])];
}

export async function pull(
  client: GitHubInstallationClient,
  repository: string,
  number: number,
): Promise<PullRequest> {
  const [owner, repo] = repoParts(repository);
  const path = `/repos/${owner}/${repo}/pulls/${number}`;
  let result = await client.json<PullRequest>(path, 'get_pull_request');
  if (result.state === 'open' && result.mergeable === null) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    result = await client.json<PullRequest>(path, 'get_pull_request');
  }
  return result;
}

export async function comparison(
  client: GitHubInstallationClient,
  repository: string,
  pr: PullRequest,
): Promise<BranchState> {
  const [owner, repo] = repoParts(repository);
  try {
    const result = await client.json<{ behind_by?: unknown }>(
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(pr.base.ref)}...${pr.head.sha}`,
      'compare_pull_request_branch',
    );
    return { behind: typeof result.behind_by === 'number' ? result.behind_by : null };
  } catch (error) {
    if (error instanceof GitHubApiError) return { behind: null };
    throw error;
  }
}

async function checkRuns(
  client: GitHubInstallationClient,
  repository: string,
  sha: string,
): Promise<CheckRun[]> {
  const [owner, repo] = repoParts(repository);
  const output: CheckRun[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await client.json<{ check_runs?: unknown }>(
      `/repos/${owner}/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`,
      'list_check_runs',
    );
    const values = Array.isArray(response.check_runs)
      ? (response.check_runs as CheckRun[])
      : [];
    output.push(...values);
    if (values.length < 100) return output;
  }
  throw new Error('list_check_runs_pagination_limit');
}

async function commitStatuses(
  client: GitHubInstallationClient,
  repository: string,
  sha: string,
): Promise<CommitStatus[]> {
  const [owner, repo] = repoParts(repository);
  const output: CommitStatus[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await client.json<{ statuses?: unknown }>(
      `/repos/${owner}/${repo}/commits/${sha}/status?per_page=100&page=${page}`,
      'list_commit_statuses',
    );
    const values = Array.isArray(response.statuses)
      ? (response.statuses as CommitStatus[])
      : [];
    output.push(...values);
    if (values.length < 100) return output;
  }
  throw new Error('list_commit_statuses_pagination_limit');
}

export async function checks(
  client: GitHubInstallationClient,
  repository: string,
  sha: string,
): Promise<CiState> {
  const [runs, statuses] = await Promise.all([
    checkRuns(client, repository, sha),
    commitStatuses(client, repository, sha),
  ]);
  const pending: Array<CheckRun | CommitStatus> = [
    ...runs.filter((item) => item.status !== 'completed'),
    ...statuses.filter((item) => item.state === 'pending'),
  ];
  const failed: Array<CheckRun | CommitStatus> = [
    ...runs.filter(
      (item) =>
        item.status === 'completed' &&
        (!item.conclusion || FAIL.has(item.conclusion)),
    ),
    ...runs.filter(
      (item) =>
        item.status === 'completed' &&
        item.conclusion &&
        !PASS.has(item.conclusion) &&
        !FAIL.has(item.conclusion),
    ),
    ...statuses.filter((item) => ['error', 'failure'].includes(item.state)),
  ];
  const passed: Array<CheckRun | CommitStatus> = [
    ...runs.filter(
      (item) => item.status === 'completed' && Boolean(item.conclusion) && PASS.has(item.conclusion ?? ''),
    ),
    ...statuses.filter((item) => item.state === 'success'),
  ];
  return { pending, failed, passed, total: runs.length + statuses.length };
}

export async function reviews(
  client: GitHubInstallationClient,
  repository: string,
  number: number,
): Promise<ReviewState> {
  const [owner, repo] = repoParts(repository);
  const all = await client.paginate<Review>(
    `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    'list_pull_request_reviews',
  );
  const latest = new Map<string, string>();
  for (const review of all) {
    const login = review.user?.login;
    if (
      login &&
      ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)
    ) {
      latest.set(login, review.state);
    }
  }
  const states = [...latest.values()];
  return {
    approvals: states.filter((value) => value === 'APPROVED').length,
    changes: states.filter((value) => value === 'CHANGES_REQUESTED').length,
  };
}

export async function comments(
  client: GitHubInstallationClient,
  repository: string,
  number: number,
): Promise<IssueComment[]> {
  const [owner, repo] = repoParts(repository);
  const all = await client.paginate<IssueComment>(
    `/repos/${owner}/${repo}/issues/${number}/comments`,
    'list_issue_comments',
  );
  return all
    .filter((item) => item.user?.type === 'Bot' && item.body?.includes(MARKER))
    .sort((left, right) =>
      String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')),
    );
}

export async function files(
  client: GitHubInstallationClient,
  repository: string,
  number: number,
): Promise<string[]> {
  const [owner, repo] = repoParts(repository);
  const all = await client.paginate<{ filename?: unknown }>(
    `/repos/${owner}/${repo}/pulls/${number}/files`,
    'list_pull_request_files',
  );
  return all
    .map((item) => item.filename)
    .filter((value): value is string => typeof value === 'string');
}

export async function upsert(
  client: GitHubInstallationClient,
  appSlug: string,
  repository: string,
  number: number,
  body: string,
  found: IssueComment[],
): Promise<{ changed: boolean; commentId: number | null }> {
  const [owner, repo] = repoParts(repository);
  const ownLogin = `${appSlug}[bot]`;
  const own = found.filter((item) => item.user?.login === ownLogin);
  const legacy = found.filter((item) => item.user?.login === 'github-actions[bot]');
  const stale = [...own.slice(1), ...legacy];
  if (own[0]?.body === body) {
    for (const duplicate of stale) {
      await client.void(
        `/repos/${owner}/${repo}/issues/comments/${duplicate.id}`,
        'delete_issue_comment',
        { method: 'DELETE' },
      );
    }
    return { changed: stale.length > 0, commentId: own[0].id };
  }

  let commentId: number;
  if (own[0]) {
    const updated = await client.json<{ id?: unknown }>(
      `/repos/${owner}/${repo}/issues/comments/${own[0].id}`,
      'update_issue_comment',
      { method: 'PATCH', body: JSON.stringify({ body }) },
    );
    if (typeof updated.id !== 'number') throw new Error('invalid_updated_comment');
    commentId = updated.id;
  } else {
    const created = await client.json<{ id?: unknown }>(
      `/repos/${owner}/${repo}/issues/${number}/comments`,
      'create_issue_comment',
      { method: 'POST', body: JSON.stringify({ body }) },
    );
    if (typeof created.id !== 'number') throw new Error('invalid_created_comment');
    commentId = created.id;
  }

  for (const duplicate of stale) {
    await client.void(
      `/repos/${owner}/${repo}/issues/comments/${duplicate.id}`,
      'delete_issue_comment',
      { method: 'DELETE' },
    );
  }
  return { changed: true, commentId };
}

export async function associatedPullRequestNumbers(
  env: Pick<CompanionEnv, 'GITHUB_APP_ID' | 'GITHUB_PRIVATE_KEY'>,
  installationId: number,
  repository: string,
  sha: string,
  fetcher: typeof fetch = fetch,
): Promise<number[]> {
  const client = await createInstallationClient(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    installationId,
    fetcher,
  );
  const [owner, repo] = repoParts(repository);
  const pulls = await client.paginate<{ number?: unknown }>(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/pulls`,
    'list_pull_requests_for_commit',
  );
  return [...new Set(
    pulls
      .map((item) => item.number)
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0),
  )];
}

