// Memory of what Kanarek already posted on a pull request. Without it every new head is
// reviewed from scratch and a rebutted finding comes back. Two layers: the prompt carries the
// earlier findings with their replies, and a finding anchored on an already commented spot is
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
  /** Normalized line above it in the same hunk: tells equal lines apart. */
  before: string;
  title: string;
  replies: string[];
}

// Never truncated here: an edit far into a long line makes it a different line.
function normalizeLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

// A review comment's hunk ends on the commented line.
function commentedSpot(diffHunk: unknown): { line: string; before: string } {
  const none = { line: '', before: '' };
  if (typeof diffHunk !== 'string') return none;
  const rows = diffHunk.replace(/\n+$/u, '').split('\n');
  const isRight = (row: string) => row.startsWith('+') || row.startsWith(' ');
  if (!isRight(rows.at(-1) ?? '')) return none;
  const [line, before = ''] = rows.filter(isRight).reverse().map((row) => normalizeLine(row.slice(1)));
  return { line, before };
}

function anchorKey(path: string, before: string, line: string): string {
  return `${path}\n${before}\n${line}`;
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
      ...commentedSpot(item.diff_hunk),
      title: item.body.split('\n', 1)[0].slice(0, MAX_TITLE_CHARS),
      replies: [],
    });
  }
  // Replies go into a prompt: only people with a stake in the repository, and installed apps.
  for (const item of [...items].sort((a, b) => Number(a.id) - Number(b.id))) {
    const parent = typeof item.in_reply_to_id === 'number' ? findings.get(item.in_reply_to_id) : undefined;
    if (!parent || login(item) === own || typeof item.body !== 'string') continue;
    const trusted = objectValue(item.user).type === 'Bot' ||
      TRUSTED_ASSOCIATIONS.has(String(item.author_association));
    // Oldest first, so the newest ones survive: a later correction beats the first answer.
    if (trusted) parent.replies = [...parent.replies, item.body.slice(0, MAX_REPLY_CHARS)].slice(-MAX_REPLIES);
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

export function priorFindingsForPrompt(prior: readonly PriorFinding[]) {
  return prior.slice(0, MAX_PRIOR_FINDINGS).map(({ path, line, title, replies }) => (
    { path, line: line.slice(0, MAX_LINE_CHARS), title, replies }
  ));
}

/** Every commented spot distinctive enough to match on. */
export function priorAnchors(prior: readonly PriorFinding[]): string[] {
  return [...new Set(prior
    .filter((finding) => finding.line.length >= MIN_ANCHOR_CHARS)
    .map((finding) => anchorKey(finding.path, finding.before, finding.line)))];
}

export function dropRepeatedFindings(
  findings: ReviewFinding[],
  files: ReviewFile[],
  anchors: readonly string[],
): { fresh: ReviewFinding[]; repeated: number } {
  const seen = new Set(anchors);
  const fresh = findings.filter((finding) => {
    const patch = files.find((file) => file.path === finding.path)?.patch;
    if (!patch) return true;
    const source = patchRightSideSource(patch);
    const keys = source.map((row, index) => {
      const above = source[index - 1];
      const before = above?.line === row.line - 1 ? normalizeLine(above.text) : '';
      return anchorKey(finding.path, before, normalizeLine(row.text));
    });
    const key = keys[source.findIndex((row) => row.line === finding.line)];
    // Two equal spots in one patch cannot be told apart, so nothing is withheld.
    return !key || !seen.has(key) || keys.indexOf(key) !== keys.lastIndexOf(key);
  });
  return { fresh, repeated: findings.length - fresh.length };
}
