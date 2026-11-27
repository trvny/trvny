// Memory of what Kanarek already posted on a pull request. Without it every new head is
// reviewed from scratch and a rebutted finding comes back. Two layers: the prompt carries the
// earlier findings with their replies, and a finding anchored on an already commented line is
// not published again.
import type { GitHubInstallationClient } from '../../../core/github-app.ts';
import { repoPath } from '../tools/common.ts';
import { objectValue, type ReviewFile } from './webhook-review-context.ts';
import { patchRightSideSource, type ReviewFinding } from './webhook-review-judge.ts';

const MAX_COMMENTS_SCANNED = 300;
const MAX_PRIOR_FINDINGS = 20;
const MAX_REPLIES = 2;
const MAX_TITLE_CHARS = 160;
const MAX_REPLY_CHARS = 300;
const MAX_LINE_CHARS = 300;
// "}" or "return;" recurs all over a file and says nothing about which defect was reported.
const MIN_ANCHOR_CHARS = 12;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface PriorFinding {
  path: string;
  /** Normalized text of the commented line; '' when GitHub gave no usable hunk. */
  line: string;
  title: string;
  replies: string[];
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, MAX_LINE_CHARS);
}

// A review comment's hunk ends on the commented line.
function commentedLine(diffHunk: unknown): string {
  if (typeof diffHunk !== 'string') return '';
  const last = diffHunk.replace(/\n+$/u, '').split('\n').at(-1) ?? '';
  return last.startsWith('+') || last.startsWith(' ') ? normalizeLine(last.slice(1)) : '';
}

export function priorFindingsFromComments(
  comments: readonly unknown[],
  appSlug: string,
): PriorFinding[] {
  const items = comments.map(objectValue);
  const login = (item: Record<string, unknown>) => objectValue(item.user).login;
  const own = `${appSlug}[bot]`;
  const findings = new Map<number, PriorFinding & { id: number }>();
  for (const item of items) {
    if (login(item) !== own || item.in_reply_to_id || typeof item.id !== 'number' ||
        typeof item.path !== 'string' || typeof item.body !== 'string') continue;
    findings.set(item.id, {
      id: item.id,
      path: item.path,
      line: commentedLine(item.diff_hunk),
      title: item.body.split('\n', 1)[0].slice(0, MAX_TITLE_CHARS),
      replies: [],
    });
  }
  // Replies go into a prompt: only people with a stake in the repository, and installed apps.
  for (const item of [...items].sort((a, b) => Number(a.id) - Number(b.id))) {
    const parent = typeof item.in_reply_to_id === 'number' ? findings.get(item.in_reply_to_id) : undefined;
    if (!parent || login(item) === own || typeof item.body !== 'string' ||
        parent.replies.length >= MAX_REPLIES) continue;
    const trusted = objectValue(item.user).type === 'Bot' ||
      TRUSTED_ASSOCIATIONS.has(String(item.author_association));
    if (trusted) parent.replies.push(item.body.slice(0, MAX_REPLY_CHARS));
  }
  return [...findings.values()]
    .sort((a, b) => b.id - a.id)
    .map(({ id: _id, ...finding }) => finding);
}

// Fail-soft: a review without memory repeats itself; a failed review is worse.
export async function fetchPriorFindings(
  client: Pick<GitHubInstallationClient, 'paginate'>,
  repository: string,
  number: number,
  appSlug: string,
): Promise<PriorFinding[]> {
  try {
    const comments = await client.paginate<unknown>(
      `/repos/${repoPath(repository)}/pulls/${number}/comments?sort=created&direction=desc`,
      'webhook_review_list_review_comments',
      { stopWhen: (items) => items.length >= MAX_COMMENTS_SCANNED },
    );
    return priorFindingsFromComments(comments, appSlug);
  } catch (error) {
    console.warn(JSON.stringify({ // skipcq: JS-0002 Cloudflare Worker runtime observability.
      kanarekWebhookReview: 'prior_findings_unavailable',
      repository,
      pullRequestNumber: number,
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return [];
  }
}

export function priorFindingsForPrompt(prior: readonly PriorFinding[]): PriorFinding[] {
  return prior.slice(0, MAX_PRIOR_FINDINGS);
}

/** Path and line text of every commented line that is distinctive enough to match on. */
export function priorAnchors(prior: readonly PriorFinding[]): string[] {
  return [...new Set(prior
    .filter((finding) => finding.line.length >= MIN_ANCHOR_CHARS)
    .map((finding) => `${finding.path}\n${finding.line}`))];
}

export function dropRepeatedFindings(
  findings: ReviewFinding[],
  files: ReviewFile[],
  anchors: readonly string[],
): { fresh: ReviewFinding[]; repeated: number } {
  const seen = new Set(anchors);
  const fresh = findings.filter((finding) => {
    const patch = files.find((file) => file.path === finding.path)?.patch;
    const source = patch
      ? patchRightSideSource(patch).find((line) => line.line === finding.line)
      : undefined;
    return !source || !seen.has(`${finding.path}\n${normalizeLine(source.text)}`);
  });
  return { fresh, repeated: findings.length - fresh.length };
}
