import type { GitHubInstallationClient } from '../../../core/github-app.ts';

const FINDINGS = 'AI review 🐤 findings';
const POSTED = 'AI review ✅ posted';
const RESOLVED = 'AI review ✅ resolved';
const MAX_THREAD_PAGES = 10;

type Review = {
  author?: { login?: string | null; __typename?: string } | null;
  body?: string | null;
  commit?: { oid?: string | null } | null;
};

type Thread = {
  isResolved?: boolean;
  comments?: { nodes?: Array<{ pullRequestReview?: Review | null } | null> | null };
};

type ThreadConnection = {
  nodes?: Array<Thread | null> | null;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

type ThreadResponse = {
  errors?: unknown[];
  data?: {
    repository?: {
      pullRequest?: { headRefOid?: string; reviewThreads?: ThreadConnection };
    } | null;
  };
};

function isOwnReview(review: Review | null | undefined, headSha: string, appSlug: string): boolean {
  const author = review?.author;
  if (!author || author.__typename !== 'Bot') return false;
  if (author.login?.replace(/\\[bot\\]$/u, '') !== appSlug) return false;
  if (review?.commit?.oid?.toLowerCase() !== headSha.toLowerCase()) return false;
  const marker = review.body?.match(/^<!-- kanarek-review:([a-f0-9]{40}):[a-f0-9]{40} -->\\r?\\n/iu);
  return marker?.[1]?.toLowerCase() === headSha.toLowerCase();
}

// Historical job outcome is not live thread state. Keep the original badge
// on incomplete, missing or stale evidence; never claim all resolved by absence.
export async function liveReviewBadge(
  client: Pick<GitHubInstallationClient, 'json'>,
  repository: string,
  number: number,
  headSha: string,
  appSlug: string,
  fallback: string | null,
): Promise<string | null> {
  if (fallback !== FINDINGS && fallback !== POSTED) return fallback;
  const [owner, name] = repository.split('/');
  if (!owner || !name) return fallback;
  let after: string | null = null;
  let matched = false;
  try {
    for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
      const response: ThreadResponse = await client.json<ThreadResponse>(
        '/graphql',
        'companion_review_threads',
        {
          method: 'POST',
          body: JSON.stringify({
            query: `query($owner: String!, $name: String!, $number: Int!, $after: String) {
              repository(owner: $owner, name: $name) {
                pullRequest(number: $number) {
                  headRefOid
                  reviewThreads(first: 100, after: $after) {
                    nodes {
                      isResolved
                      comments(first: 1) {
                        nodes { pullRequestReview { author { login __typename } body commit { oid } } }
                      }
                    }
                    pageInfo { hasNextPage endCursor }
                  }
                }
              }
            }`,
            variables: { owner, name, number, after },
          }),
        },
      );
      const pr = response.data?.repository?.pullRequest;
      const threads = pr?.reviewThreads;
      const info = threads?.pageInfo;
      if (response.errors?.length || pr?.headRefOid?.toLowerCase() !== headSha.toLowerCase() ||
          !Array.isArray(threads?.nodes) || typeof info?.hasNextPage !== 'boolean') return fallback;
      for (const thread of threads.nodes) {
        if (!thread || typeof thread.isResolved !== 'boolean' || !Array.isArray(thread.comments?.nodes)) {
          return fallback;
        }
        const review = thread.comments.nodes[0]?.pullRequestReview;
        if (!isOwnReview(review, headSha, appSlug)) continue;
        matched = true;
        if (!thread.isResolved) return FINDINGS;
      }
      if (!info.hasNextPage) return matched ? RESOLVED : fallback;
      if (!info.endCursor || info.endCursor === after) return fallback;
      after = info.endCursor;
    }
  } catch {
    return fallback;
  }
  return fallback;
}
