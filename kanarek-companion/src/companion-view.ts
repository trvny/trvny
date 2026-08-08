import { encoded } from './quip.ts';
import type { BranchState, CiState, CompanionEnv, PullRequest, QuipEntry, ReviewState, StatusState } from './companion-types.ts';

export const MARKER = '<!-- kanarek-pr-companion:v1 -->';
const ROOT_LABELS = new Map([
  ['app', 'Aplikacja'],
  ['src', 'Kod źródłowy'],
  ['lib', 'Biblioteka'],
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
  ['test', 'Testy'],
  ['tests', 'Testy'],
  ['spec', 'Testy'],
  ['scripts', 'Narzędzia'],
  ['tools', 'Narzędzia'],
  ['config', 'Konfiguracja'],
  ['public', 'Zasoby'],
  ['assets', 'Zasoby'],
]);

function code(value: unknown): string {
  return `\`${String(value).replaceAll('`', 'ˋ')}\``;
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
  if (!value) return 'Pozostałe';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function areaFor(file: string): string {
  if (file.startsWith('kanarek/app/')) return 'Kanarek Android';
  if (file.startsWith('kanarek/worker/')) return 'Kanarek Worker';
  if (file.startsWith('kanarek/')) return 'Kanarek';
  if (file.startsWith('feedseek/')) return 'Feedseek';
  if (file.startsWith('.github/')) return 'Automatyka GitHub';
  if (file.startsWith('docs/') || file.endsWith('.md')) return 'Dokumentacja';
  if (!file.includes('/')) return 'Repo root';
  return rootLabel(file.split('/')[0]);
}

export function areas(files: string[]): string[] {
  return [...new Set(files.map(areaFor))];
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
  if (pr.merged) return { key: 'merged', title: '🟣 scalony', blockers: [] };
  if (pr.state === 'closed') {
    return { key: 'closed', title: '⚫ zamknięty', blockers: [] };
  }
  if (pr.draft) {
    return { key: 'draft', title: '📝 szkic', blockers: ['PR jest szkicem'] };
  }

  const blockers: string[] = [];
  if (branch.behind !== null && branch.behind > 0) blockers.push(`${branch.behind} za ${pr.base.ref}`);
  if (branch.behind === null) blockers.push('nieznany stan gałęzi');
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    blockers.push('konflikty scalania');
  }
  if (pr.mergeable === null) blockers.push('GitHub liczy scalalność');
  if (ciRequired && ci.total === 0) blockers.push('brak wyników CI');
  if (ci.pending.length) blockers.push(`${ci.pending.length} kontroli w toku`);
  if (ci.failed.length) blockers.push(`${ci.failed.length} kontroli z błędem`);
  if (review.changes) blockers.push('review żąda zmian');
  if (pr.mergeable_state === 'blocked' && blockers.length === 0) {
    blockers.push('GitHub oznacza PR jako blocked');
  }

  if (ci.failed.length || pr.mergeable_state === 'dirty') {
    return { key: 'blocked', title: '🔴 blokada', blockers };
  }
  if (blockers.length) return { key: 'waiting', title: '🟡 czeka', blockers };
  return { key: 'ready', title: '🟢 gotowy', blockers: [] };
}

export function blockerKinds(
  pr: Pick<PullRequest, 'mergeable' | 'mergeable_state'>,
  branch: BranchState,
  ci: CiState,
  review: ReviewState,
  ciRequired = true,
): string[] {
  const kinds = [
    branch.behind !== null && branch.behind > 0 ? 'behind' : null,
    branch.behind === null ? 'branch-unknown' : null,
    pr.mergeable === false || pr.mergeable_state === 'dirty'
      ? 'conflict'
      : null,
    pr.mergeable === null ? 'mergeability-pending' : null,
    ciRequired && ci.total === 0 ? 'ci-missing' : null,
    ci.pending.length ? 'ci-pending' : null,
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
  if (pr.state === 'closed') return 'gałąź ⚫';
  if (branch.behind === 0) return `${code(pr.base.ref)} ✅`;
  if (branch.behind !== null && branch.behind > 0) return `${code(pr.base.ref)} −${branch.behind}`;
  return 'gałąź ?';
}

function checksBadge(ci: CiState, ciRequired: boolean): string {
  if (ci.total === 0 && !ciRequired) return 'CI ➖';
  if (ci.total === 0) return 'CI ⚪';
  if (ci.failed.length) return `CI 🔴 ${ci.failed.length}`;
  if (ci.pending.length) return `CI 🟡 ${ci.pending.length}`;
  return `CI ✅ ${ci.passed.length}/${ci.total}`;
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
): string {
  const badges = [
    branchBadge(pr, branch),
    checksBadge(ci, ciRequired),
    reviewBadge(review),
  ];
  if (pr.auto_merge && !pr.merged && pr.state !== 'closed') {
    badges.push('auto-merge ✅');
  }
  const details = current.blockers.filter((item) =>
    [
      'konflikty scalania',
      'GitHub liczy scalalność',
      'GitHub oznacza PR jako blocked',
    ].includes(item),
  );
  const blockers = details.length
    ? `\n\n<sub>${details.join(' · ')}</sub>`
    : '';
  const scope =
    [
      ...new Set(
        projectAreas.map((area) =>
          area === 'Automatyka GitHub' ? 'Kanarek' : area,
        ),
      ),
    ].join(', ') || 'Pozostałe';

  return `${MARKER}
<!-- kanarek-state:${stateHash} -->
<!-- kanarek-quip-key:${quipKey} -->
<!-- kanarek-quip:${encoded(quip)} -->
<!-- kanarek-pool:${encoded(JSON.stringify(pool))} -->
<!-- kanarek-source:${source} -->
### 🐤 Kanarek · ${current.title}

${badges.filter(Boolean).join(' · ')}${blockers}

> ${quip}

<sub>${scope} · ${pr.changed_files} pl. · ${code(pr.head.sha.slice(0, 8))}</sub>`;
}
