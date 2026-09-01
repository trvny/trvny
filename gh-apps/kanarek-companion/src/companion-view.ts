import { encoded } from './quip.ts';
import type { BranchState, CiState, CompanionEnv, PullRequest, QuipEntry, ReviewState, StatusState } from './companion-types.ts';

export const MARKER = '<!-- kanarek-pr-companion:v1 -->';
const ROOT_LABELS = new Map([
  ['app', 'App'],
  ['src', 'Source'],
  ['lib', 'Library'],
  ['server', 'Backend'],
  ['backend', 'Backend'],
  ['api', 'API'],
  ['web', 'Frontend'],
  ['frontend', 'Frontend'],
  ['site', 'Frontend'],
  ['worker', 'Worker'],
  ['workers', 'Worker'],
  ['android', 'Android'],
  ['ios', 'iOS'],
  ['test', 'Tests'],
  ['tests', 'Tests'],
  ['spec', 'Tests'],
  ['scripts', 'Tools'],
  ['tools', 'Tools'],
  ['config', 'Configuration'],
  ['public', 'Assets'],
  ['assets', 'Assets'],
]);

function code(value: unknown): string {
  return `\`${String(value).replaceAll('`', 'ˋ')}\``;
}

/**
 * Reduces "how far behind the base branch we are" to whether we are behind.
 *
 * The exact count was the largest source of comment churn. It changes for every
 * open pull request at once every time anything merges to the base, so a busy
 * afternoon rewrote every companion comment repeatedly without any of those
 * rewrites saying something new about the pull request being rewritten.
 *
 * The count is not worth that: GitHub already shows it on the branch itself,
 * and what the comment is for is a glance. As a state, a pull request falls
 * behind once and stays there, so merges stop moving it at all.
 */
export function behindState(behind: number | null): 'unknown' | 'current' | 'behind' {
  if (behind === null) return 'unknown';
  return behind > 0 ? 'behind' : 'current';
}

export function requireCi(env: CompanionEnv, repository: string): boolean {
  if (env.KANAREK_REQUIRE_CI === 'false') return false;
  const excluded = new Set(
    String(env.KANAREK_NO_CI_REPOS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return !excluded.has(repository);
}

function rootLabel(root: string): string {
  const known = ROOT_LABELS.get(root.toLowerCase());
  if (known) return known;
  const value = root
    .replace(/[._-]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  if (!value) return 'Other';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function areaFor(file: string, repository = ''): string {
  const repo = repository.toLowerCase();

  if (repo === 'twojstar/kanarek') {
    if (file.startsWith('.github/')) return 'GitHub automation';
    if (file.startsWith('docs/') || file.endsWith('.md')) return 'Documentation';
    if (file.startsWith('app/')) return 'Kanarek Android';
    if (file.startsWith('worker/')) return 'Kanarek Worker';
    return 'Kanarek';
  }
  if (repo === 'trvny/feedseek') {
    if (file.startsWith('.github/')) return 'GitHub automation';
    if (file.startsWith('docs/') || file.endsWith('.md')) return 'Documentation';
    return 'Feedseek';
  }

  if (file.startsWith('.github/')) return 'GitHub automation';
  if (file.startsWith('docs/') || file.endsWith('.md')) return 'Documentation';
  if (!file.includes('/')) return 'Repo root';
  return rootLabel(file.split('/')[0]);
}

export function areas(files: string[], repository = ''): string[] {
  return [...new Set(files.map((file) => areaFor(file, repository)))];
}

export function size(pr: Pick<PullRequest, 'additions' | 'deletions' | 'changed_files'>): { key: string } {
  const lines = pr.additions + pr.deletions;
  if (pr.changed_files <= 3 && lines <= 60) return { key: 'tiny' };
  if (pr.changed_files <= 10 && lines <= 350) return { key: 'small' };
  if (pr.changed_files <= 30 && lines <= 1200) return { key: 'medium' };
  return { key: 'large' };
}

export function status(
  pr: Pick<PullRequest, 'draft' | 'mergeable' | 'mergeable_state' | 'merged' | 'state' | 'base'>,
  branch: BranchState,
  ci: CiState,
  review: ReviewState,
  ciRequired = true,
): StatusState {
  if (pr.merged) return { key: 'merged', title: '🟣 merged', blockers: [] };
  if (pr.state === 'closed') {
    return { key: 'closed', title: '⚫ closed', blockers: [] };
  }
  if (pr.draft) {
    return { key: 'draft', title: '📝 draft', blockers: ['PR is a draft'] };
  }

  const blockers: string[] = [];
  if (branch.behind !== null && branch.behind > 0) blockers.push(`${branch.behind} behind ${pr.base.ref}`);
  if (branch.behind === null) blockers.push('branch state unknown');
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    blockers.push('merge conflicts');
  }
  if (pr.mergeable === null) blockers.push('GitHub is calculating mergeability');
  if (ciRequired && ci.total === 0) blockers.push('no CI results');
  if (ci.pending.length) blockers.push(`${ci.pending.length} checks pending`);
  if (ci.failed.length) blockers.push(`${ci.failed.length} checks failed`);
  if (review.changes) blockers.push('review requested changes');
  if (pr.mergeable_state === 'blocked' && blockers.length === 0) {
    blockers.push('GitHub marks the PR as blocked');
  }

  if (ci.failed.length || pr.mergeable_state === 'dirty') {
    return { key: 'blocked', title: '🔴 blocked', blockers };
  }
  if (blockers.length) return { key: 'waiting', title: '🟡 waiting', blockers };
  return { key: 'ready', title: '🟢 ready', blockers: [] };
}

export function blockerKinds(
  pr: Pick<PullRequest, 'mergeable' | 'mergeable_state' | 'merged' | 'state'>,
  branch: BranchState,
  ci: CiState,
  review: ReviewState,
  ciRequired = true,
): string[] {
  if (pr.merged || pr.state === 'closed') return [];

  const kinds = [
    branch.behind !== null && branch.behind > 0 ? 'behind' : null,
    branch.behind === null ? 'branch-unknown' : null,
    pr.mergeable === false || pr.mergeable_state === 'dirty'
      ? 'conflict'
      : null,
    pr.mergeable === null ? 'mergeability-pending' : null,
    ciRequired && (ci.total === 0 || ci.pending.length)
      ? 'ci-missing'
      : !ciRequired && ci.pending.length
        ? 'ci-pending'
        : null,
    ci.failed.length ? 'ci-failed' : null,
    review.changes ? 'review-changes' : null,
  ].filter((value): value is string => Boolean(value));
  if (pr.mergeable_state === 'blocked' && kinds.length === 0) {
    kinds.push('merge-state-blocked');
  }
  return kinds;
}

function branchBadge(pr: PullRequest, branch: BranchState): string {
  if (pr.merged) return `${code(pr.base.ref)} ✅`;
  if (pr.state === 'closed') return 'branch ⚫';
  const state = behindState(branch.behind);
  if (state === 'current') return `${code(pr.base.ref)} ✅`;
  if (state === 'behind') return `${code(pr.base.ref)} ↓`;
  return 'branch ?';
}

function checksBadge(ci: CiState, ciRequired: boolean): string {
  if (ci.total === 0 && !ciRequired) return 'CI ➖';
  if (ci.total === 0) return 'CI 🟡';
  if (ci.failed.length) return 'CI 🔴';
  if (ci.pending.length) return 'CI 🟡';
  return 'CI ✅';
}

function reviewBadge(review: ReviewState): string | null {
  if (review.changes) return `review 🔴 ${review.changes}`;
  if (review.approvals) return `review ✅ ${review.approvals}`;
  return null;
}

export function render(
  pr: PullRequest,
  branch: BranchState,
  ci: CiState,
  review: ReviewState,
  projectAreas: string[],
  current: StatusState,
  quip: string,
  stateHash: string,
  quipKey: string,
  source: 'ai' | 'pool' | 'preset',
  pool: QuipEntry[],
  ciRequired = true,
  branchUpdateWarning: string | null = null,
): string {
  const terminal = pr.merged || pr.state === 'closed';
  const badges = terminal
    ? [branchBadge(pr, branch)]
    : [
        branchBadge(pr, branch),
        checksBadge(ci, ciRequired),
        reviewBadge(review),
      ];
  if (pr.auto_merge && !terminal) {
    badges.push('auto-merge ✅');
  }
  const details = current.blockers.filter((item) =>
    [
      'merge conflicts',
      'GitHub is calculating mergeability',
      'GitHub marks the PR as blocked',
    ].includes(item),
  );
  const blockers = details.length
    ? `\n\n<sub>${details.join(' · ')}</sub>`
    : '';
  const updateWarning = branchUpdateWarning
    ? `\n\n<sub>${branchUpdateWarning}</sub>`
    : '';
  const scope =
    [
      ...new Set(
        projectAreas.map((area) =>
          area === 'GitHub automation' ? 'Kanarek' : area,
        ),
      ),
    ].join(', ') || 'Other';

  return `${MARKER}
<!-- kanarek-state:${stateHash} -->
<!-- kanarek-quip-key:${quipKey} -->
<!-- kanarek-quip:${encoded(quip)} -->
<!-- kanarek-pool:${encoded(JSON.stringify(pool))} -->
<!-- kanarek-source:${source} -->
### 🐤 Kanarek · ${current.title}

${badges.filter(Boolean).join(' · ')}${blockers}${updateWarning}

> ${quip}

<sub>${scope} · ${pr.changed_files} files</sub>`;
}
