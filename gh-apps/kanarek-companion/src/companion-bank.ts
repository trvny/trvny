import { aiPercent, decoded, hash, sanitize, shouldAskAi, validQuipLength } from './quip.ts';
import { matchesLanguage, type CompanionLanguage } from './companion-language.ts';
import type { CompanionEnv, IssueComment, QuipEntry } from './companion-types.ts';

export const BANK_KEY = 'kanarek:companion:quip-bank:v1';
export const QUIP_KEY_RE = /<!-- kanarek-quip-key:([a-f0-9]+) -->/;
export const QUIP_RE = /<!-- kanarek-quip:([A-Za-z0-9_-]+) -->/;
const POOL_RE = /<!-- kanarek-pool:([A-Za-z0-9_-]+) -->/;
export const SOURCE_RE = /<!-- kanarek-source:(ai|pool|preset) -->/;
const LIVE_STATUSES = new Set(['ready', 'blocked']);
const POOL_LIMIT = 24;
export const BANK_LIMIT = 256;
const GLOBAL_BANK_LIMIT = 4_096;
const MIGRATION_LIMIT = 200;
const PRUNE_LIMIT = 24;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const ENTRY_PREFIX = `${BANK_KEY}:entry:`;
const MAINTENANCE_KEY = `${BANK_KEY}:maintenance:last`;
const ENTRY_KEY_RE = new RegExp(
  `^${ENTRY_PREFIX}([a-f0-9]{16}):([a-f0-9]{16})$`,
);

interface BankKey {
  expiration?: number;
  name: string;
}

export interface BankCapacity {
  available: boolean;
  limit: number;
  size: number;
}

export interface BankContext extends BankCapacity {
  keys: string[];
  legacy: QuipEntry[];
}

interface EntryKeyParts {
  identity: string;
  quipKey: string;
}

interface MigrationCursor {
  expiration: number;
  name: string;
}

interface MaintenanceState {
  cursor: MigrationCursor | null;
  last: number;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function entryKeyParts(name: string): EntryKeyParts | null {
  const match = name.match(ENTRY_KEY_RE);
  return match ? { quipKey: match[1], identity: match[2] } : null;
}

function maintenanceState(value: string | null): MaintenanceState {
  if (!value) return { cursor: null, last: 0 };
  try {
    const parsed = JSON.parse(value) as Partial<MaintenanceState>;
    const cursor = parsed.cursor as Partial<MigrationCursor> | null | undefined;
    return {
      last: typeof parsed.last === 'number' && Number.isFinite(parsed.last) ? parsed.last : 0,
      cursor:
        cursor &&
        typeof cursor.expiration === 'number' &&
        Number.isFinite(cursor.expiration) &&
        typeof cursor.name === 'string'
          ? { expiration: cursor.expiration, name: cursor.name }
          : null,
    };
  } catch {
    return {
      cursor: null,
      last: Number.parseInt(value, 10) || 0,
    };
  }
}

function migrationPosition(key: BankKey): MigrationCursor {
  return { expiration: key.expiration ?? 0, name: key.name };
}

function afterMigrationCursor(key: BankKey, cursor: MigrationCursor): boolean {
  const expiration = key.expiration ?? 0;
  return (
    expiration > cursor.expiration ||
    (expiration === cursor.expiration && compareNames(key.name, cursor.name) > 0)
  );
}

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
    .filter((entry) => entry.k && validQuipLength(entry.q))
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
    !validQuipLength(value)
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
    if (validQuipLength(current)) values.unshift(current);
  }
  return values;
}

export function canUsePool(stateKey: string): boolean {
  return LIVE_STATUSES.has(stateKey);
}

function retainedContextLimit(keys: BankKey[], quipKey: string): number {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const parts = entryKeyParts(key.name);
    if (!parts) continue;
    counts.set(parts.quipKey, (counts.get(parts.quipKey) ?? 0) + 1);
  }
  counts.set(quipKey, BANK_LIMIT);
  const groups = [...counts.entries()].sort(([left], [right]) =>
    compareNames(left, right),
  );
  let retained = 0;
  let target = 0;
  for (let index = 0; index < BANK_LIMIT && retained < GLOBAL_BANK_LIMIT; index += 1) {
    let added = false;
    for (const [key, count] of groups) {
      if (count <= index) continue;
      retained += 1;
      added = true;
      if (key === quipKey) target += 1;
      if (retained >= GLOBAL_BANK_LIMIT) break;
    }
    if (!added) break;
  }
  return target;
}

export async function bankContext(
  env: CompanionEnv,
  quipKey: string,
  language?: CompanionLanguage,
): Promise<BankContext> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv) {
    return { available: false, keys: [], legacy: [], limit: BANK_LIMIT, size: 0 };
  }
  try {
    const [allKeys, legacyValue] = await Promise.all([
      listBankKeys(env),
      kv.get(BANK_KEY),
    ]);
    const retained = retainedBankNames(allKeys);
    const retainedKeys = allKeys.filter((key) => retained.has(key.name));
    const currentKeys = retainedKeys.filter(
      (key) => entryKeyParts(key.name)?.quipKey === quipKey,
    );
    const identities = new Set(
      currentKeys
        .map((key) => entryKeyParts(key.name)?.identity)
        .filter((value): value is string => Boolean(value)),
    );
    const legacy = mergeEntries(
      entriesFromValue(legacyValue).filter(
        (entry) =>
          entry.k === quipKey && (!language || matchesLanguage(entry.q, language)),
      ),
    );
    let uniqueLegacy = 0;
    for (const entry of legacy) {
      const identity = await hash(`${entry.k}\u0000${entry.q}`);
      if (identities.has(identity)) continue;
      identities.add(identity);
      uniqueLegacy += 1;
    }
    const limit = retainedContextLimit(retainedKeys, quipKey);
    return {
      available: true,
      keys: currentKeys.map((key) => key.name),
      legacy,
      limit,
      size: Math.min(limit, currentKeys.length + uniqueLegacy),
    };
  } catch (error) {
    console.warn(
      `Kanarek quip bank capacity unavailable: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return { available: false, keys: [], legacy: [], limit: BANK_LIMIT, size: 0 };
  }
}

export async function bankCapacity(
  env: CompanionEnv,
  quipKey: string,
): Promise<BankCapacity> {
  const context = await bankContext(env, quipKey);
  return {
    available: context.available,
    limit: context.limit,
    size: context.size,
  };
}

export function effectiveAiPercent(
  env: CompanionEnv,
  capacity: BankCapacity,
): number {
  const configured = aiPercent(env);
  if (!capacity.available || configured <= 0 || capacity.limit <= 0) return 0;
  const limit = Math.max(1, Math.min(BANK_LIMIT, Math.floor(capacity.limit)));
  const size = Math.max(0, Math.min(limit, Math.floor(capacity.size)));
  const remaining = limit - size;
  if (!remaining) return 0;
  return Math.ceil((configured * remaining) / limit);
}

export async function shouldAskAiForBank(
  number: number,
  quipKey: string,
  stateKey: string,
  env: CompanionEnv,
  capacity: BankCapacity,
): Promise<boolean> {
  const percent = effectiveAiPercent(env, capacity);
  return shouldAskAi(number, quipKey, stateKey, {
    ...env,
    KANAREK_AI_PERCENT: String(percent),
  });
}

export async function shouldUsePool(
  number: number,
  quipKey: string,
  stateKey: string,
  env: CompanionEnv,
  capacity: BankCapacity = {
    available: true,
    limit: BANK_LIMIT,
    size: 0,
  },
): Promise<boolean> {
  return (
    canUsePool(stateKey) &&
    !(await shouldAskAiForBank(number, quipKey, stateKey, env, capacity))
  );
}

async function loadEntryBank(
  env: CompanionEnv,
  quipKey: string,
  stateHash: string,
  listedKeys?: string[],
  language?: CompanionLanguage,
): Promise<QuipEntry[]> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv) return [];
  const keys =
    listedKeys ??
    (await kv.list({
      prefix: `${ENTRY_PREFIX}${quipKey}:`,
      limit: BANK_LIMIT,
    })).keys.map((key) => key.name);
  if (!keys.length) return [];
  const offset = Number.parseInt(stateHash.slice(0, 8), 16) % keys.length;
  const selected = [...keys.slice(offset), ...keys.slice(0, offset)].slice(
    0,
    POOL_LIMIT,
  );
  const values = await Promise.all(selected.map((key) => kv.get(key)));
  const entries: QuipEntry[] = [];
  const invalid: string[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const value = values[index];
    if (value === null) continue;
    const parsed = entriesFromValue(value).filter(
      (entry) =>
        entry.k === quipKey && (!language || matchesLanguage(entry.q, language)),
    );
    if (!parsed.length) invalid.push(selected[index]);
    else entries.push(...parsed);
  }
  if (invalid.length) {
    const cleanup = await Promise.allSettled(invalid.map((key) => kv.delete(key)));
    const removed = cleanup.filter((result) => result.status === 'fulfilled').length;
    console.info(
      JSON.stringify({
        event: 'kanarek_bank_cleanup',
        removed,
        failed: cleanup.length - removed,
      }),
    );
  }
  return mergeEntries(entries);
}

async function listBankKeys(env: CompanionEnv): Promise<BankKey[]> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv) return [];
  const keys: BankKey[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: ENTRY_PREFIX, limit: 1_000, cursor });
    keys.push(
      ...page.keys.map((key) => ({
        name: key.name,
        expiration: key.expiration,
      })),
    );
    if (page.list_complete) break;
    if (!page.cursor) throw new Error('quip_bank_list_missing_cursor');
    cursor = page.cursor;
  } while (cursor);

  return [...new Map(keys.map((key) => [key.name, key])).values()];
}

function retainedBankNames(keys: BankKey[]): Set<string> {
  const grouped = new Map<
    string,
    Array<{ key: BankKey; parts: EntryKeyParts }>
  >();
  for (const key of keys) {
    const parts = entryKeyParts(key.name);
    if (!parts) continue;
    const group = grouped.get(parts.quipKey) ?? [];
    group.push({ key, parts });
    grouped.set(parts.quipKey, group);
  }
  const groups = [...grouped.entries()]
    .sort(([left], [right]) => compareNames(left, right))
    .map(([, group]) =>
      group.sort(
        (left, right) =>
          compareNames(left.parts.identity, right.parts.identity) ||
          compareNames(left.key.name, right.key.name),
      ),
    );
  const retained = new Set<string>();
  for (let index = 0; index < BANK_LIMIT && retained.size < GLOBAL_BANK_LIMIT; index += 1) {
    let added = false;
    for (const group of groups) {
      const candidate = group[index];
      if (!candidate) continue;
      retained.add(candidate.key.name);
      added = true;
      if (retained.size >= GLOBAL_BANK_LIMIT) break;
    }
    if (!added) break;
  }
  return retained;
}

async function pruneBank(
  kv: KVNamespace,
  keys: BankKey[],
  limit = PRUNE_LIMIT,
): Promise<number> {
  const retained = retainedBankNames(keys);
  const removable = keys
    .filter((key) => ENTRY_KEY_RE.test(key.name) && !retained.has(key.name))
    .sort((left, right) => compareNames(left.name, right.name))
    .slice(0, limit);
  await Promise.all(removable.map((key) => kv.delete(key.name)));
  return removable.length;
}

export async function maintainBank(
  env: CompanionEnv,
  force = false,
): Promise<{ migrated: number; pruned: number; skipped: boolean }> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv) return { migrated: 0, pruned: 0, skipped: true };
  try {
    const now = Date.now();
    const state = maintenanceState(await kv.get(MAINTENANCE_KEY));
    if (!force && !state.cursor && now - state.last < MAINTENANCE_INTERVAL_MS) {
      return { migrated: 0, pruned: 0, skipped: true };
    }

    const keys = await listBankKeys(env);
    const retained = retainedBankNames(keys);
    const expiring = keys
      .filter(
        (key) => retained.has(key.name) && key.expiration !== undefined,
      )
      .sort(
        (left, right) =>
          (left.expiration ?? Number.MAX_SAFE_INTEGER) -
            (right.expiration ?? Number.MAX_SAFE_INTEGER) ||
          compareNames(left.name, right.name),
      );
    const pending = state.cursor
      ? expiring.filter((key) => afterMigrationCursor(key, state.cursor as MigrationCursor))
      : expiring;
    const batch = pending.slice(0, MIGRATION_LIMIT);
    const results = await Promise.allSettled(
      batch.map(async (key) => {
        const value = await kv.get(key.name);
        if (value === null) return false;
        const expectedKey = entryKeyParts(key.name)?.quipKey;
        const reusable = entriesFromValue(value).some(
          (entry) => entry.k === expectedKey,
        );
        if (!reusable) {
          await kv.delete(key.name);
          return false;
        }
        await kv.put(key.name, value);
        return true;
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(
          `Kanarek quip bank TTL migration failed: ${result.reason instanceof Error ? result.reason.message : 'unknown_error'}`,
        );
      }
    }
    const firstFailure = results.findIndex((result) => result.status === 'rejected');
    const processed = firstFailure >= 0 ? firstFailure : results.length;
    const migrated = results.filter(
      (result) => result.status === 'fulfilled' && result.value,
    ).length;
    const cursor =
      processed > 0 ? migrationPosition(batch[processed - 1]) : state.cursor;
    const migrationIncomplete = pending.length > processed;
    await kv.put(
      MAINTENANCE_KEY,
      JSON.stringify({
        cursor: migrationIncomplete ? cursor : null,
        last: migrationIncomplete ? state.last : now,
      } satisfies MaintenanceState),
    );
    return { migrated, pruned: await pruneBank(kv, keys), skipped: false };
  } catch (error) {
    console.warn(
      `Kanarek quip bank maintenance failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return { migrated: 0, pruned: 0, skipped: false };
  }
}

export async function loadBank(
  env: CompanionEnv,
  quipKey: string,
  stateHash: string,
  context?: BankContext,
  language?: CompanionLanguage,
): Promise<QuipEntry[]> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv) return [];
  try {
    if (context?.available) {
      const entries = await loadEntryBank(
        env,
        quipKey,
        stateHash,
        context.keys,
        language,
      );
      return mergeEntries(entries, context.legacy)
        .filter((entry) => !language || matchesLanguage(entry.q, language))
        .slice(0, POOL_LIMIT);
    }
    const [legacy, entries] = await Promise.all([
      kv.get(BANK_KEY),
      loadEntryBank(env, quipKey, stateHash, undefined, language),
    ]);
    return mergeEntries(
      entries,
      entriesFromValue(legacy).filter(
        (entry) =>
          entry.k === quipKey && (!language || matchesLanguage(entry.q, language)),
      ),
    ).slice(0, POOL_LIMIT);
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
): Promise<boolean> {
  const kv = env.KANAREK_QUIP_KV;
  if (!kv || !entries.length) return false;
  try {
    const normalized = mergeEntries(entries);
    if (!normalized.length) return false;
    const current = await listBankKeys(env);
    let retainedAll = true;
    for (const entry of normalized) {
      const identity = await hash(`${entry.k}\u0000${entry.q}`);
      const keyName = `${ENTRY_PREFIX}${entry.k}:${identity}`;
      const existing = current.find((key) => key.name === keyName);
      const candidateKeys = existing ? current : [...current, { name: keyName }];
      if (!retainedBankNames(candidateKeys).has(keyName)) {
        retainedAll = false;
        continue;
      }
      if (!existing || existing.expiration !== undefined) {
        await kv.put(keyName, JSON.stringify([entry]));
        if (existing) existing.expiration = undefined;
        else current.push({ name: keyName });
      }
    }
    await pruneBank(kv, current);
    return retainedAll;
  } catch (error) {
    console.warn(
      `Kanarek quip bank update failed: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    return false;
  }
}

export async function pooledQuip(
  quipKey: string,
  stateHash: string,
  oldComments: IssueComment[],
  bank: QuipEntry[],
  excluded: string,
  language?: CompanionLanguage,
): Promise<string | null> {
  const candidates = [
    ...oldComments.flatMap((item) => quipsFromComment(item.body, quipKey)),
    ...bank.filter((entry) => entry.k === quipKey).map((entry) => entry.q),
  ];
  const unique = [...new Set(candidates)].filter(
    (candidate) =>
      candidate !== excluded && (!language || matchesLanguage(candidate, language)),
  );
  if (!unique.length) return null;
  const index =
    Number.parseInt((await hash(`${stateHash}:pool`)).slice(0, 8), 16) % unique.length;
  return unique[index];
}
