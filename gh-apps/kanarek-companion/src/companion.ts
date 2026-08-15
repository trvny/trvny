import { createInstallationClient } from './github-app.ts';
import { handleGptomekControl } from './gptomek.ts';
import {
  bankContext,
  canUsePool,
  loadBank,
  maintainBank,
  poolEntries,
  pooledQuip,
  QUIP_KEY_RE,
  QUIP_RE,
  rememberQuip,
  shouldAskAiForBank,
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
  reusableQuip,
} from './companion-language.ts';
import {
  deletePaidState,
  loadPaidState,
  storePaidState,
} from './companion-paid.ts';
import { syncReaction } from './companion-reactions.ts';
import {
  branchUpdatePermissionWarning,
  shouldUpdateBranch,
  updateBranch,
} from './companion-update.ts';
import {
  areas,
  behindState,
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
import type { BankContext } from './companion-bank.ts';
import type {
  CompanionEnv,
  CompanionResult,
  CompanionTarget,
  PullRequest,
  QuipEntry,
} from './companion-types.ts';

const COMMENT_STATE_RE = /<!-- kanarek-state:([a-f0-9]{16}) -->/;
const LEGACY_RECEIPT_FALLBACK_UNTIL = Date.UTC(2026, 7, 19);

type QuipFacts = {
  status: string;
  blockers: string[];
  area: string;
  size: string;
  language: string;
};

type CommentStateInput = {
  head: string;
  behind: number | null;
  reviews: { approvals: number; changes: number };
  autoMerge: string | null;
  files: number;
};

export async function commentStateHash(
  quipFacts: QuipFacts,
  state: CommentStateInput,
): Promise<string> {
  if (quipFacts.status === 'merged' || quipFacts.status === 'closed') {
    return hash({
      ...quipFacts,
      files: state.files,
    });
  }
  return hash({
    ...quipFacts,
    // Hash the same value the badge renders. Hashing the exact count while
    // rendering a state would churn the hash without changing the body.
    behind: behindState(state.behind),
    reviews: state.reviews,
    autoMerge: state.autoMerge,
    files: state.files,
  });
}

export { associatedPullRequestNumbers } from './companion-github.ts';
export { contextLanguage } from './companion-language.ts';
export { reactionForState } from './companion-reactions.ts';
export { shouldUpdateBranch } from './companion-update.ts';
export {
  areas,
  behindState,
  blockerKinds,
  MARKER,
  render,
  size,
  status,
} from './companion-view.ts';
export type {
  CompanionEnv,
  CompanionResult,
  CompanionTarget,
} from './companion-types.ts';

export function isCompanionDisabled(pr: Pick<PullRequest, 'labels'>): boolean {
  return Boolean(
    pr.labels?.some((label) => label.name?.trim().toLowerCase() === 'no-goblin'),
  );
}

export function shouldCheckPaidReceipt(
  stateKey: string,
  quip: string,
  previousSource: string,
  previousStateHash: string | undefined,
  stateHash: string,
): boolean {
  return (
    canUsePool(stateKey) &&
    (!quip || (previousSource === 'ai' && previousStateHash === stateHash))
  );
}

export function paidQuipForBank(
  pendingPaidQuip: string | null,
  sameQuipState: boolean,
  source: string,
  quip: string,
): string | null {
  return pendingPaidQuip ?? (!sameQuipState && source === 'ai' ? quip : null);
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

  const bankMaintenance = maintainBank(env);
  const ciRequired = requireCi(env, target.repository);
  const [changedFiles, branch, ci, review, oldComments] = await Promise.all([
    files(client, target.repository, target.pullRequestNumber),
    comparison(client, target.repository, pr),
    checks(client, target.repository, pr.head.sha),
    reviews(client, target.repository, target.pullRequestNumber),
    comments(client, target.repository, target.pullRequestNumber),
  ]);
  const projectAreas = areas(changedFiles, target.repository);
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
  const quipFacts: QuipFacts = {
    status: current.key,
    blockers: kinds,
    area: projectAreas[0] ?? 'Other',
    size: prSize.key,
    language,
  };
  const quipKey = await hash(quipFacts);
  const stateInput: CommentStateInput = {
    head: pr.head.sha,
    behind: branch.behind,
    reviews: review,
    autoMerge: pr.auto_merge?.merge_method ?? null,
    files: pr.changed_files,
  };
  const stateHash = await commentStateHash(quipFacts, stateInput);
  const receiptHash = await hash({ state: stateHash, head: stateInput.head });
  const previous = oldComments[0];
  const previousKey = previous?.body?.match(QUIP_KEY_RE)?.[1];
  const previousStateHash = previous?.body?.match(COMMENT_STATE_RE)?.[1];
  const previousSource = previous?.body?.match(SOURCE_RE)?.[1] ?? 'preset';
  const previousQuip = sanitize(
    decoded(previous?.body?.match(QUIP_RE)?.[1] ?? ''),
  );
  const previousLearnedQuip = ['ai', 'pool'].includes(previousSource)
    ? reusableQuip(previousQuip, language) ?? ''
    : previousQuip;
  let pool = rememberQuip(
    poolEntries(previous?.body),
    previousKey,
    previousLearnedQuip,
    previousSource,
  );
  const sameQuipState =
    previousKey === quipKey && Boolean(previousLearnedQuip);
  let quip = sameQuipState ? previousLearnedQuip : '';
  let source: 'ai' | 'pool' | 'preset' =
    sameQuipState && ['ai', 'pool', 'preset'].includes(previousSource)
      ? (previousSource as 'ai' | 'pool' | 'preset')
      : 'preset';
  let bank: QuipEntry[] = [];
  let poolAttempted = false;
  let measuredBank: BankContext | undefined;
  let pendingPaidQuip: string | null = null;
  let paidReceiptStored: boolean | null = null;
  let paidReceiptHash = receiptHash;
  let paidBankedBeforeGithub = false;
  let paidRecovered = false;
  const tryPool = async (): Promise<void> => {
    if (poolAttempted || !canUsePool(current.key)) return;
    poolAttempted = true;
    bank = await loadBank(env, quipKey, stateHash, measuredBank, language);
    const pooled = await pooledQuip(
      quipKey,
      stateHash,
      oldComments,
      bank,
      previousLearnedQuip,
      language,
    );
    if (pooled) {
      quip = pooled;
      source = 'pool';
    }
  };

  const checkCurrentReceipt = shouldCheckPaidReceipt(
    current.key,
    quip,
    previousSource,
    previousStateHash,
    stateHash,
  );
  const checkLegacyReceipt = Date.now() < LEGACY_RECEIPT_FALLBACK_UNTIL;
  if (checkCurrentReceipt || checkLegacyReceipt) {
    let recovered = checkCurrentReceipt
      ? await loadPaidState(
          env,
          target.repository,
          target.pullRequestNumber,
          receiptHash,
          quipKey,
          language,
        )
      : null;
    if (!recovered && checkLegacyReceipt) {
      const legacyReceiptHash = await hash({
        ...quipFacts,
        head: stateInput.head,
        behind: stateInput.behind,
        reviews: stateInput.reviews,
        autoMerge: stateInput.autoMerge,
        files: stateInput.files,
      });
      recovered = await loadPaidState(
        env,
        target.repository,
        target.pullRequestNumber,
        legacyReceiptHash,
        quipKey,
        language,
      );
      if (recovered) paidReceiptHash = legacyReceiptHash;
    }
    if (recovered) {
      pendingPaidQuip = recovered;
      paidRecovered = true;
      paidReceiptStored = true;
      if (!quip) {
        quip = recovered;
        source = 'ai';
      }
    }
  }

  let aiSelected = false;
  if (!quip) {
    const baseAiSelected = await shouldAskAi(
      target.pullRequestNumber,
      quipKey,
      current.key,
      env,
    );
    if (baseAiSelected) {
      measuredBank = await bankContext(env, quipKey, language);
      aiSelected = await shouldAskAiForBank(
        target.pullRequestNumber,
        quipKey,
        current.key,
        env,
        measuredBank,
      );
    }
    if (!aiSelected) await tryPool();
  }
  if (!quip && aiSelected) {
    const facts = quipPromptInput({
      language,
      status: current.key,
      blockers: kinds,
      area: quipFacts.area,
      size: prSize.key,
      previousQuip: previousLearnedQuip || null,
      context: {
        title: sanitize(pr.title ?? '') || null,
        body: sanitize(pr.body ?? '') || null,
      },
    });
    const generated = reusableQuip(await aiQuip(facts, env, fetcher), language);
    if (generated) {
      quip = generated;
      source = 'ai';
      pendingPaidQuip = quip;
      paidReceiptStored = await storePaidState(
        env,
        target.repository,
        target.pullRequestNumber,
        receiptHash,
        quipKey,
        quip,
        language,
      );
      if (!paidReceiptStored) {
        await bankMaintenance;
        paidBankedBeforeGithub = await storeBank(env, [
          { k: quipKey, q: quip },
        ]);
      }
      console.info(
        JSON.stringify({
          event: 'kanarek_ai_persistence',
          banked_before_github: paidBankedBeforeGithub,
          receipt_stored: paidReceiptStored,
          quip_key: quipKey,
        }),
      );
    }
  }
  if (!quip) await tryPool();
  if (!quip) {
    quip = await contextualPreset(
      current.key,
      `${target.pullRequestNumber}:${stateHash}`,
      previousLearnedQuip,
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

  await bankMaintenance;
  const bankHasQuip = bank.some(
    (entry) => entry.k === quipKey && entry.q === quip,
  );
  const paidQuipToBank = paidQuipForBank(
    pendingPaidQuip,
    sameQuipState,
    source,
    quip,
  );
  const bankHasPaidQuip =
    paidQuipToBank !== null &&
    bank.some((entry) => entry.k === quipKey && entry.q === paidQuipToBank);
  if (paidQuipToBank && !paidBankedBeforeGithub && !bankHasPaidQuip) {
    const retained = await storeBank(env, [{ k: quipKey, q: paidQuipToBank }]);
    if (retained && paidReceiptStored) {
      await deletePaidState(
        env,
        target.repository,
        target.pullRequestNumber,
        paidReceiptHash,
      );
    }
    console.info(
      JSON.stringify({
        event: paidRecovered ? 'kanarek_ai_recovered' : 'kanarek_ai_bank',
        retained,
        receipt_stored: retained ? false : paidReceiptStored,
        quip_key: quipKey,
      }),
    );
  }
  if (!sameQuipState && source === 'pool' && !bankHasQuip) {
    await storeBank(env, [{ k: quipKey, q: quip }]);
  }

  if (branchUpdateEligible && !branchUpdateWarning) {
    await updateBranch(
      client,
      target.repository,
      target.pullRequestNumber,
      pr.head.sha,
    );
  }

  return {
    changed: result.changed,
    commentId: result.commentId,
    quipSource: source,
    state: current.key,
  };
}
