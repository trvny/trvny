import { createInstallationClient } from './github-app.ts';
import { handleGptomekControl } from './gptomek.ts';
import {
  loadBank,
  poolEntries,
  pooledQuip,
  QUIP_KEY_RE,
  QUIP_RE,
  rememberQuip,
  shouldUsePool,
  SOURCE_RE,
  storeBank,
} from './companion-bank.ts';
import {
  clearCompanionComments,
  comments,
  comparison,
  files,
  pull,
  reviews,
  checks,
  upsert,
} from './companion-github.ts';
import {
  contextLanguage,
  contextualPreset,
  matchesLanguage,
} from './companion-language.ts';
import { syncReaction } from './companion-reactions.ts';
import {
  branchUpdatePermissionWarning,
  shouldUpdateBranch,
  updateBranch,
} from './companion-update.ts';
import {
  areas,
  blockerKinds,
  render,
  requireCi,
  size,
  status,
} from './companion-view.ts';
import {
  aiQuip,
  decoded,
  hash,
  quipPromptInput,
  sanitize,
  shouldAskAi,
} from './quip.ts';
import type { CompanionEnv, CompanionResult, CompanionTarget, PullRequest, QuipEntry } from './companion-types.ts';

export { associatedPullRequestNumbers } from './companion-github.ts';
export { contextLanguage } from './companion-language.ts';
export { reactionForState } from './companion-reactions.ts';
export { shouldUpdateBranch } from './companion-update.ts';
export { areas, blockerKinds, MARKER, render, size, status } from './companion-view.ts';
export type { CompanionEnv, CompanionResult, CompanionTarget } from './companion-types.ts';

export function isCompanionDisabled(pr: Pick<PullRequest, 'labels'>): boolean {
  return Boolean(
    pr.labels?.some((label) => label.name?.trim().toLowerCase() === 'no-goblin'),
  );
}

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
  const gptomek = await handleGptomekControl(target, pr, env, fetcher);
  if (gptomek.control) {
    return {
      changed: gptomek.handled,
      commentId: null,
      quipSource: 'preset',
      state: 'gptomek-control',
    };
  }
  if (isCompanionDisabled(pr)) {
    const oldComments = await comments(
      client,
      target.repository,
      target.pullRequestNumber,
    );
    const [commentChanged, reactionChanged] = await Promise.all([
      clearCompanionComments(
        client,
        env.GITHUB_APP_SLUG,
        target.repository,
        oldComments,
      ),
      syncReaction(
        client,
        env.GITHUB_APP_SLUG,
        target.repository,
        target.pullRequestNumber,
        'disabled',
      ),
    ]);
    return {
      changed: commentChanged || reactionChanged,
      commentId: null,
      quipSource: 'preset',
      state: 'disabled',
    };
  }

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
  const branchUpdateEligible = shouldUpdateBranch(
    pr,
    branch,
    ci,
    review,
    target.repository,
    ciRequired,
    env,
  );
  const branchUpdateWarning = branchUpdateEligible
    ? branchUpdatePermissionWarning(client)
    : null;
  const language = contextLanguage(`${pr.title ?? ''}\n${pr.body ?? ''}`);
  const quipFacts = {
    status: current.key,
    blockers: kinds,
    area: projectAreas[0] ?? 'Other',
    size: prSize.key,
    language,
  };
  const quipKey = await hash(quipFacts);
  const stateHash = await hash({
    ...quipFacts,
    head: pr.head.sha,
    behind: branch.behind,
    reviews: review,
    autoMerge: pr.auto_merge?.merge_method ?? null,
    files: pr.changed_files,
  });
  const previous = oldComments[0];
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
  const sameQuipState = previousKey === quipKey && Boolean(previousQuip);
  let quip = sameQuipState ? previousQuip : '';
  let source: 'ai' | 'pool' | 'preset' =
    sameQuipState && ['ai', 'pool', 'preset'].includes(previousSource)
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
    const facts = quipPromptInput({
      language,
      status: current.key,
      blockers: kinds,
      area: quipFacts.area,
      size: prSize.key,
      previousQuip: previousQuip || null,
      context: {
        title: sanitize(pr.title ?? '') || null,
        body: sanitize(pr.body ?? '') || null,
      },
    });
    const generated = (await aiQuip(facts, env, fetcher)) ?? '';
    if (generated && matchesLanguage(generated, language)) {
      quip = generated;
      source = 'ai';
    }
  }
  if (!quip) {
    quip = await contextualPreset(
      current.key,
      `${target.pullRequestNumber}:${stateHash}`,
      previousQuip,
      language,
    );
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
    branchUpdateWarning,
  );
  const result = await upsert(
    client,
    env.GITHUB_APP_SLUG,
    target.repository,
    target.pullRequestNumber,
    body,
    oldComments,
  );
  if (result.changed) {
    await syncReaction(
      client,
      env.GITHUB_APP_SLUG,
      target.repository,
      target.pullRequestNumber,
      current.key,
    );
  }

  if (branchUpdateEligible && !branchUpdateWarning) {
    await updateBranch(
      client,
      target.repository,
      target.pullRequestNumber,
      pr.head.sha,
    );
  }

  if (!sameQuipState && (source === 'ai' || source === 'pool')) {
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