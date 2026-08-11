import {
  reusableQuip,
  type CompanionLanguage,
} from './companion-language.ts';
import type { CompanionEnv, QuipEntry } from './companion-types.ts';

const PAID_STATE_PREFIX = 'kanarek:companion:paid-state:v1:';
const PAID_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const HASH_RE = /^[a-f0-9]{16}$/;
const REPOSITORY_RE = /^[^/]+\/[^/]+$/;

function keyFor(
  repository: string,
  pullRequestNumber: number,
  stateHash: string,
): string | null {
  return REPOSITORY_RE.test(repository) &&
    Number.isInteger(pullRequestNumber) &&
    pullRequestNumber > 0 &&
    HASH_RE.test(stateHash)
    ? `${PAID_STATE_PREFIX}${repository}#${pullRequestNumber}:${stateHash}`
    : null;
}

export async function loadPaidState(
  env: CompanionEnv,
  repository: string,
  pullRequestNumber: number,
  stateHash: string,
  quipKey: string,
  language: CompanionLanguage,
): Promise<string | null> {
  const kv = env.KANAREK_QUIP_KV;
  const key = keyFor(repository, pullRequestNumber, stateHash);
  if (!kv || !key || !HASH_RE.test(quipKey)) return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      await kv.delete(key);
      return null;
    }
    const entry = parsed as Partial<QuipEntry>;
    if (entry.k !== quipKey) {
      await kv.delete(key);
      return null;
    }
    const quip = reusableQuip(entry.q, language);
    if (!quip) {
      await kv.delete(key);
      return null;
    }
    return quip;
  } catch (error) {
    console.warn(
      `Kanarek paid-state read failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return null;
  }
}

export async function storePaidState(
  env: CompanionEnv,
  repository: string,
  pullRequestNumber: number,
  stateHash: string,
  quipKey: string,
  quip: string,
  language: CompanionLanguage,
): Promise<boolean> {
  const kv = env.KANAREK_QUIP_KV;
  const key = keyFor(repository, pullRequestNumber, stateHash);
  const value = reusableQuip(quip, language);
  if (!kv || !key || !HASH_RE.test(quipKey) || !value) return false;
  try {
    await kv.put(
      key,
      JSON.stringify({ k: quipKey, q: value } satisfies QuipEntry),
      { expirationTtl: PAID_STATE_TTL_SECONDS },
    );
    return true;
  } catch (error) {
    console.warn(
      `Kanarek paid-state write failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return false;
  }
}

export async function deletePaidState(
  env: CompanionEnv,
  repository: string,
  pullRequestNumber: number,
  stateHash: string,
): Promise<boolean> {
  const kv = env.KANAREK_QUIP_KV;
  const key = keyFor(repository, pullRequestNumber, stateHash);
  if (!kv || !key) return false;
  try {
    await kv.delete(key);
    return true;
  } catch (error) {
    console.warn(
      `Kanarek paid-state cleanup failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return false;
  }
}
