import { aiPercent, decoded, hash, sanitize } from './quip.ts';
import type { CompanionEnv, IssueComment, QuipEntry } from './companion-types.ts';

export const BANK_KEY = 'kanarek:companion:quip-bank:v1';
export const STATE_RE = /<!-- kanarek-state:([a-f0-9]+) -->/;
export const QUIP_KEY_RE = /<!-- kanarek-quip-key:([a-f0-9]+) -->/;
export const QUIP_RE = /<!-- kanarek-quip:([A-Za-z0-9_-]+) -->/;
const POOL_RE = /<!-- kanarek-pool:([A-Za-z0-9_-]+) -->/;
export const SOURCE_RE = /<!-- kanarek-source:(ai|pool|preset) -->/;
const LIVE_STATUSES = new Set(['ready', 'blocked']);
const POOL_LIMIT = 24;
const BANK_LIMIT = 256;

function entriesFromValue(value: unknown): QuipEntry[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      const candidate = entry as { k?: unknown; q?: unknown };
      return {
        k:
          typeof candidate.k === 'string' && /^[a-f0-9]{16}$/.test(candidate.k)
            ? candidate.k
            : '',
        q: sanitize(candidate.q),
      };
    })
    .filter((entry) => entry.k && entry.q.length >= 12)
    .slice(0, BANK_LIMIT);
}

function mergeEntries(...groups: QuipEntry[][]): QuipEntry[] {
  const result: QuipEntry[] = [];
  const seen = new Set<string>();
  for (const entry of groups.flat()) {
    const normalized = entriesFromValue([entry])[0];
    if (!normalized) continue;
    const identity = `${normalized.k}\u0000${normalized.q}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length >= BANK_LIMIT) break;
  }
  return result;
}

export function poolEntries(body: string | null | undefined): QuipEntry[] {
  const encodedPool = body?.match(POOL_RE)?.[1];
  if (!encodedPool) return [];
  try {
    const parsed = JSON.parse(decoded(encodedPool)) as unknown;
    return entriesFromValue(parsed).slice(0, POOL_LIMIT);
  } catch {
    return [];
  }
}

export function rememberQuip(
  pool: QuipEntry[],
  key: string | undefined,
  quip: string,
  source: string,
): QuipEntry[] {
  const value = sanitize(quip);
  if (
    !['ai', 'pool'].includes(source) ||
    !/^[a-f0-9]{16}$/.test(key ?? '') ||
    value.length < 12
  ) {
    return pool;
  }
  return [
    { k: key ?? '', q: value },
    ...pool.filter((entry) => entry.k !== key || entry.q !== value),
  ].slice(0, POOL_LIMIT);
}

function quipsFromComment(body: string | null | undefined, quipKey: string): string[] {
  const values = poolEntries(body)
    .filter((entry) => entry.k === quipKey)
    .map((entry) => entry.q);
  const source = body?.match(SOURCE_RE)?.[1];
  if (
    ['ai', 'pool'].includes(source ?? '') &&
    body?.match(QUIP_KEY_RE)?.[1] === quipKey
  ) {
    const current = sanitize(decoded(body.match(QUIP_RE)?.[1] ?? ''));
    if (current.length >= 12) values.unshift(current);
  }
  return values;
}

export async function shouldUsePool(
  number: number,
  quipKey: string,
  stateKey: string,
  env: CompanionEnv,
): Promise<boolean> {
  if (env.KANAREK_AI_ENABLED === 'false' || !LIVE_STATUSES.has(stateKey)) {
    return false;
  }
  const bucket =
    Number.parseInt((await hash(`${number}:${quipKey}`)).slice(0, 8), 16) % 100;
  return bucket < aiPercent(env);
}

export async function loadBank(env: CompanionEnv): Promise<QuipEntry[]> {
  if (!env.KANAREK_QUIP_KV) return [];
  try {
    return entriesFromValue(await env.KANAREK_QUIP_KV.get(BANK_KEY));
  } catch (error) {
    console.warn(
      `Kanarek quip bank unavailable: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return [];
  }
}

export async function storeBank(
  env: CompanionEnv,
  entries: QuipEntry[],
): Promise<void> {
  if (!env.KANAREK_QUIP_KV || !entries.length) return;
  try {
    const current = entriesFromValue(await env.KANAREK_QUIP_KV.get(BANK_KEY));
    const merged = mergeEntries(entries, current);
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      await env.KANAREK_QUIP_KV.put(BANK_KEY, JSON.stringify(merged));
    }
  } catch (error) {
    console.warn(
      `Kanarek quip bank update failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
  }
}

export async function pooledQuip(
  quipKey: string,
  stateHash: string,
  oldComments: IssueComment[],
  bank: QuipEntry[],
  excluded: string,
): Promise<string | null> {
  const candidates = [
    ...oldComments.flatMap((item) => quipsFromComment(item.body, quipKey)),
    ...bank.filter((entry) => entry.k === quipKey).map((entry) => entry.q),
  ];
  const unique = [...new Set(candidates)].filter((candidate) => candidate !== excluded);
  if (!unique.length) return null;
  const index =
    Number.parseInt((await hash(`${stateHash}:pool`)).slice(0, 8), 16) % unique.length;
  return unique[index];
}

