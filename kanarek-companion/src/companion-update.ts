import { repoParts } from './companion-github.ts';
import { GitHubApiError, type GitHubInstallationClient } from './github-app.ts';
import type {
  BranchState,
  CiState,
  CompanionEnv,
  PullRequest,
  ReviewState,
} from './companion-types.ts';

const WRITE_PERMISSIONS = new Set(['admin', 'write']);

export function shouldUpdateBranch(
  pr: PullRequest,
  branch: BranchState,
  ci: CiState,
  review: ReviewState,
  repository: string,
  ciRequired: boolean,
  env: Pick<CompanionEnv, 'KANAREK_UPDATE_BRANCH'>,
): boolean {
  if (env.KANAREK_UPDATE_BRANCH === 'false') return false;
  if (pr.state !== 'open' || pr.draft || pr.merged) return false;
  if (branch.behind === null || branch.behind <= 0) return false;
  if (pr.head.repo?.full_name !== repository) return false;
  if (pr.mergeable !== true || pr.mergeable_state === 'dirty') return false;
  if (ci.pending.length || ci.failed.length) return false;
  if (ciRequired && ci.total === 0) return false;
  if (review.changes > 0) return false;
  return true;
}

export async function updateBranch(
  client: GitHubInstallationClient,
  repository: string,
  pullRequestNumber: number,
  expectedHeadSha: string,
): Promise<boolean> {
  const permission = client.permissions.pull_requests;
  if (!permission || !WRITE_PERMISSIONS.has(permission)) return false;

  const [owner, repo] = repoParts(repository);
  try {
    await client.json<unknown>(
      `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/update-branch`,
      'update_pull_request_branch',
      {
        method: 'PUT',
        body: JSON.stringify({ expected_head_sha: expectedHeadSha }),
      },
    );
    console.log(
      JSON.stringify({
        companionBranchUpdate: 'accepted',
        expectedHeadSha,
        pullRequestNumber,
        repository,
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof GitHubApiError) {
      console.warn(
        JSON.stringify({
          companionBranchUpdate: 'skipped',
          pullRequestNumber,
          repository,
          status: error.status,
        }),
      );
      return false;
    }
    throw error;
  }
}
