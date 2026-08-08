import { createInstallationClient } from './github-app.ts';
import {
  loadBank,
  poolEntries,
  pooledQuip,
  QUIP_KEY_RE,
  QUIP_RE,
  rememberQuip,
  shouldUsePool,
  SOURCE_RE,
  STATE_RE,
  storeBank,
} from './companion-bank.ts';
import {
  comments,
  comparison,
  files,
  pull,
  reviews,
  checks,
  upsert,
} from './companion-github.ts';
import {
  areas,
  blockerKinds,
  render,
  requireCi,
  size,
  status,
} from './companion-view.ts';
import { aiQuip, decoded, hash, preset, sanitize, shouldAskAi } from './quip.ts';
import type { CompanionEnv, CompanionResult, CompanionTarget, QuipEntry } from './companion-types.ts';

export { associatedPullRequestNumbers } from './companion-github.ts';
export { areas, blockerKinds, MARKER, render, size, status } from './companion-view.ts';
export type { CompanionEnv, CompanionResult, CompanionTarget } from './companion-types.ts';

export async function refreshCompanion(
  target: CompanionTarget,
  env: CompanionEnv,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<CompanionResult> {
  const client = await createInstallationClient(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    target.installationId,
    fetcher,
  );
  const pr = await pull(client, target.repository, target.pullRequestNumber);
  const ciRequired = requireCi(env, target.repository);
  const [changedFiles, branch, ci, review, oldComments] = await Promise.all([
    files(client, target.repository, target.pullRequestNumber),
    comparison(client, target.repository, pr),
    checks(client, target.repository, pr.head.sha),
    reviews(client, target.repository, target.pullRequestNumber),
    comments(client, target.repository, target.pullRequestNumber),
  ]);
  const projectAreas = areas(changedFiles);
  const prSize = size(pr);
  const current = status(pr, branch, ci, review, ciRequired);
  const kinds = blockerKinds(pr, branch, ci, review, ciRequired);
  const quipFacts = {
    status: current.key,
    blockers: kinds,
    area: projectAreas[0] ?? 'Pozostałe',
    size: prSize.key,
  };
  const quipKey = await hash(quipFacts);
  const stateHash = await hash({
    ...quipFacts,
    head: pr.head.sha,
    behind: branch.behind,
    checks: {
      failed: ci.failed.length,
      pending: ci.pending.length,
      passed: ci.passed.length,
      total: ci.total,
    },
    reviews: review,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    merged: pr.merged,
    autoMerge: pr.auto_merge?.merge_method ?? null,
    files: pr.changed_files,
  });
  const previous = oldComments[0];
  const previousState = previous?.body?.match(STATE_RE)?.[1];
  const previousKey = previous?.body?.match(QUIP_KEY_RE)?.[1];
  const previousSource = previous?.body?.match(SOURCE_RE)?.[1] ?? 'preset';
  const previousQuip = sanitize(
    decoded(previous?.body?.match(QUIP_RE)?.[1] ?? ''),
  );
  let pool = rememberQuip(
    poolEntries(previous?.body),
    previousKey,
    previousQuip,
    previousSource,
  );
  const sameSnapshot = previousState === stateHash;
  let quip = sameSnapshot ? previousQuip : '';
  let source: 'ai' | 'pool' | 'preset' =
    sameSnapshot && ['ai', 'pool', 'preset'].includes(previousSource)
      ? (previousSource as 'ai' | 'pool' | 'preset')
      : 'preset';
  let bank: QuipEntry[] = [];

  if (!quip && (await shouldUsePool(target.pullRequestNumber, quipKey, current.key, env))) {
    bank = await loadBank(env);
    quip =
      (await pooledQuip(
        quipKey,
        stateHash,
        oldComments,
        bank,
        previousQuip,
      )) ?? '';
    if (quip) source = 'pool';
  }
  if (
    !quip &&
    (await shouldAskAi(target.pullRequestNumber, quipKey, current.key, env))
  ) {
    const facts = [
      `status=${current.key}`,
      `blockers=${kinds.join(',') || 'none'}`,
      `area=${quipFacts.area}`,
      `size=${prSize.key}`,
      `previous_quip=${previousQuip || 'none'}`,
    ].join('; ');
    quip = (await aiQuip(facts, env, fetcher)) ?? '';
    if (quip) source = 'ai';
  }
  if (!quip) {
    quip = await preset(current.key, `${target.pullRequestNumber}:${stateHash}`, previousQuip);
    source = 'preset';
  }
  pool = rememberQuip(pool, quipKey, quip, source);

  const body = render(
    pr,
    branch,
    ci,
    review,
    projectAreas,
    current,
    quip,
    stateHash,
    quipKey,
    source,
    pool,
    ciRequired,
  );
  const result = await upsert(
    client,
    env.GITHUB_APP_SLUG,
    target.repository,
    target.pullRequestNumber,
    body,
    oldComments,
  );

  if (source === 'ai' || source === 'pool') {
    const reusable = rememberQuip(bank, quipKey, quip, source);
    await storeBank(env, reusable);
  }

  return {
    changed: result.changed,
    commentId: result.commentId,
    quipSource: source,
    state: current.key,
  };
}