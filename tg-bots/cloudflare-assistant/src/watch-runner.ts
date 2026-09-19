import type { BotekWatchRequest } from "./commands";
import { chatWithInlineFallback } from "./providers.ts";
import { secretaryAutoReplyEnabled, secretaryAutoReplySystemPrompt } from "./secretary.ts";
import {
  cancelConditionWatch,
  claimConditionWatch,
  createConditionWatch,
  dueConditionWatches,
  listConditionWatches,
  releaseConditionWatch,
  updateConditionWatch,
  watchIdForUpdate,
  type ConditionWatch,
  type FeedseekConditionWatch,
  type GithubConditionWatch,
  type LegionConditionWatch,
  type SecretaryIdleWatch,
} from "./watches.ts";
import type { Env, TelegramMessage } from "./types";

const LEGION_INTERVAL_MS = 2 * 60_000;
const GITHUB_INTERVAL_MS = 3 * 60_000;
const FEEDSEEK_INTERVAL_MS = 5 * 60_000;
const FAILURE_RETRY_MS = 2 * 60_000;
const FEEDSEEK_OVERLAP_MS = 10 * 60_000;
const FEEDSEEK_SEED_LIMIT = 50;
const FEEDSEEK_NOTIFY_LIMIT = 5;
const FEEDSEEK_SEEN_LIMIT = 100;

type GithubSnapshot = {
  repository: string;
  number: number;
  title: string | null;
  state: string;
  merged: boolean;
  draft: boolean;
  ci: { total: number; pending: number; failed: number; passed: number };
};

type FeedseekEntry = {
  id: string;
  title: string;
  url?: string;
};

type WatchSender = (
  env: Env,
  chatId: string | number,
  text: string,
  options?: { messageThreadId?: number; replyToMessageId?: number; businessConnectionId?: string },
) => Promise<void>;

function nextAt(now: number, intervalMs: number): string {
  return new Date(now + intervalMs).toISOString();
}

function messageContext(message: TelegramMessage) {
  return {
    chatId: message.chat.id,
    replyToMessageId: message.message_id,
    ...(message.message_thread_id ? { messageThreadId: message.message_thread_id } : {}),
  };
}

function legionMatch(condition: LegionConditionWatch["condition"], stale: boolean): boolean {
  return condition === "offline" ? stale : !stale;
}

function githubMatch(condition: GithubConditionWatch["condition"], snapshot: GithubSnapshot): boolean {
  if (condition === "ci-failed") return snapshot.ci.failed > 0;
  if (condition === "ci-green") {
    return snapshot.ci.total > 0 && snapshot.ci.pending === 0 && snapshot.ci.failed === 0;
  }
  if (condition === "merged") return snapshot.merged;
  return snapshot.state === "closed" && !snapshot.merged;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid watch source response");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}

function githubSnapshot(value: unknown): GithubSnapshot {
  const raw = object(value);
  if (raw.ok !== true) throw new Error("GitHub watch source failed");
  const ci = object(raw.ci);
  const repository = typeof raw.repository === "string" ? raw.repository : "";
  const number = integer(raw.number, "pull request number");
  const state = typeof raw.state === "string" ? raw.state : "";
  if (!repository || number < 1 || !state || typeof raw.merged !== "boolean" || typeof raw.draft !== "boolean") {
    throw new Error("invalid GitHub watch snapshot");
  }
  return {
    repository,
    number,
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : null,
    state,
    merged: raw.merged,
    draft: raw.draft,
    ci: {
      total: integer(ci.total, "ci total"),
      pending: integer(ci.pending, "ci pending"),
      failed: integer(ci.failed, "ci failed"),
      passed: integer(ci.passed, "ci passed"),
    },
  };
}

function feedseekEntries(value: unknown): FeedseekEntry[] {
  const raw = object(value);
  if (raw.ok !== true || !Array.isArray(raw.entries)) {
    throw new Error("invalid Feedseek watch response");
  }
  return raw.entries.slice(0, FEEDSEEK_SEED_LIMIT).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || item.id.length > 200) return [];
    const title = typeof item.title === "string" && item.title.trim()
      ? item.title.trim().replace(/\s+/gu, " ").slice(0, 240)
      : "Nowy wpis";
    const url = typeof item.url === "string" && /^https?:\/\//iu.test(item.url)
      ? item.url.slice(0, 1000)
      : undefined;
    return [{ id: item.id, title, ...(url ? { url } : {}) }];
  });
}

async function currentLegionStale(env: Env): Promise<boolean> {
  if (!env.PET_DISPATCHER) throw new Error("Pet Dispatcher binding unavailable");
  const meta = await env.PET_DISPATCHER.meta();
  if (typeof meta.stale !== "boolean") throw new Error("Legion freshness unavailable");
  return meta.stale;
}

async function currentGithub(env: Env, repository: string, number: number): Promise<GithubSnapshot> {
  if (!env.BOTEK_SPECIALISTS?.githubPullStatus) {
    throw new Error("GitHub watch source unavailable");
  }
  return githubSnapshot(await env.BOTEK_SPECIALISTS.githubPullStatus(repository, number));
}

async function currentFeedseek(
  env: Env,
  query: string,
  since?: string,
): Promise<FeedseekEntry[]> {
  if (!env.BOTEK_SPECIALISTS?.feedseekRecent) {
    throw new Error("Feedseek watch source unavailable");
  }
  return feedseekEntries(await env.BOTEK_SPECIALISTS.feedseekRecent({
    query,
    ...(since ? { since } : {}),
    limit: FEEDSEEK_SEED_LIMIT,
  }));
}

export async function initializeConditionWatch(
  env: Env,
  request: BotekWatchRequest,
  updateId: number,
  message: TelegramMessage,
  now = Date.now(),
): Promise<ConditionWatch> {
  const base = {
    id: watchIdForUpdate(updateId),
    ...messageContext(message),
    createdAt: new Date(now).toISOString(),
    nextCheckAt: nextAt(now, request.kind === "feedseek"
      ? FEEDSEEK_INTERVAL_MS
      : request.kind === "github" ? GITHUB_INTERVAL_MS : LEGION_INTERVAL_MS),
    status: "active" as const,
    failures: 0,
  };

  if (request.kind === "legion") {
    const stale = await currentLegionStale(env);
    return createConditionWatch(env, {
      ...base,
      kind: "legion",
      condition: request.condition,
      lastMatch: legionMatch(request.condition, stale),
    });
  }

  if (request.kind === "github") {
    const snapshot = await currentGithub(env, request.repository, request.number);
    return createConditionWatch(env, {
      ...base,
      kind: "github",
      repository: request.repository,
      number: request.number,
      condition: request.condition,
      lastMatch: githubMatch(request.condition, snapshot),
    });
  }

  const seed = await currentFeedseek(env, request.query);
  return createConditionWatch(env, {
    ...base,
    kind: "feedseek",
    query: request.query,
    cursorAt: new Date(now).toISOString(),
    seenIds: seed.map((entry) => entry.id).slice(-FEEDSEEK_SEEN_LIMIT),
  });
}

function legionNotification(watch: LegionConditionWatch): string {
  return watch.condition === "offline"
    ? "💀 Legion przestał raportować świeży stan przez Pet Dispatchera. Wygląda na offline."
    : "🟢 Legion znów raportuje świeży stan przez Pet Dispatchera.";
}

function githubNotification(watch: GithubConditionWatch, snapshot: GithubSnapshot): string {
  const title = snapshot.title ? ` · ${snapshot.title}` : "";
  const base = `🐙 ${watch.repository}#${watch.number}${title}`;
  if (watch.condition === "ci-failed") {
    return `${base}\n🔴 CI ma ${snapshot.ci.failed} nieudane checki/statusy.`;
  }
  if (watch.condition === "ci-green") {
    return `${base}\n🟢 CI jest zielone (${snapshot.ci.passed}/${snapshot.ci.total}).`;
  }
  if (watch.condition === "merged") return `${base}\n🟣 PR został zmergowany.`;
  return `${base}\n⚫ PR został zamknięty bez merge.`;
}

function feedseekNotification(watch: FeedseekConditionWatch, entries: FeedseekEntry[]): string {
  const lines = entries.slice(0, FEEDSEEK_NOTIFY_LIMIT).map((entry) =>
    `• ${entry.title}${entry.url ? `\n  ${entry.url}` : ""}`
  );
  const extra = entries.length > FEEDSEEK_NOTIFY_LIMIT
    ? `\n…i jeszcze ${entries.length - FEEDSEEK_NOTIFY_LIMIT} nowych.`
    : "";
  return [
    `📰 Feedseek złapał nowe rzeczy dla „${watch.query}”:`,
    "",
    ...lines,
    extra,
  ].filter(Boolean).join("\n").slice(0, 4_000);
}

function activeWatch<T extends ConditionWatch>(
  watch: T,
  now: number,
  intervalMs: number,
): T {
  const next = {
    ...watch,
    status: "active" as const,
    failures: 0,
    lastCheckedAt: new Date(now).toISOString(),
    nextCheckAt: nextAt(now, intervalMs),
  };
  delete next.leaseUntil;
  return next;
}

async function sendTransition(
  env: Env,
  watch: ConditionWatch,
  text: string,
  send: WatchSender,
): Promise<"sent" | "ambiguous" | "failed"> {
  try {
    await send(env, watch.chatId, text, {
      messageThreadId: watch.messageThreadId,
      replyToMessageId: watch.replyToMessageId,
    });
    return "sent";
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "ambiguous" in error &&
      (error as { ambiguous?: unknown }).ambiguous === true
    ) {
      return "ambiguous";
    }
    console.error("Condition watch Telegram delivery failed", watch.id, error);
    return "failed";
  }
}

async function processLegion(
  env: Env,
  watch: LegionConditionWatch,
  send: WatchSender,
  now: number,
): Promise<void> {
  const stale = await currentLegionStale(env);
  const match = legionMatch(watch.condition, stale);
  if (!watch.lastMatch && match) {
    const outcome = await sendTransition(env, watch, legionNotification(watch), send);
    if (outcome === "failed") {
      await releaseConditionWatch(env, watch.id, FAILURE_RETRY_MS);
      return;
    }
    await cancelConditionWatch(env, watch.id);
    return;
  }
  await updateConditionWatch(env, {
    ...activeWatch(watch, now, LEGION_INTERVAL_MS),
    lastMatch: match,
  });
}

async function processGithub(
  env: Env,
  watch: GithubConditionWatch,
  send: WatchSender,
  now: number,
): Promise<void> {
  const snapshot = await currentGithub(env, watch.repository, watch.number);
  const match = githubMatch(watch.condition, snapshot);
  if (!watch.lastMatch && match) {
    const outcome = await sendTransition(env, watch, githubNotification(watch, snapshot), send);
    if (outcome === "failed") {
      await releaseConditionWatch(env, watch.id, FAILURE_RETRY_MS);
      return;
    }
    await cancelConditionWatch(env, watch.id);
    return;
  }
  await updateConditionWatch(env, {
    ...activeWatch(watch, now, GITHUB_INTERVAL_MS),
    lastMatch: match,
  });
}

async function processFeedseek(
  env: Env,
  watch: FeedseekConditionWatch,
  send: WatchSender,
  now: number,
): Promise<void> {
  const overlapFrom = new Date(
    Math.max(Date.parse(watch.createdAt), Date.parse(watch.cursorAt) - FEEDSEEK_OVERLAP_MS),
  ).toISOString();
  const entries = await currentFeedseek(env, watch.query, overlapFrom);
  const seen = new Set(watch.seenIds);
  const fresh = entries.filter((entry) => !seen.has(entry.id));

  if (fresh.length) {
    const outcome = await sendTransition(env, watch, feedseekNotification(watch, fresh), send);
    if (outcome === "failed") {
      await releaseConditionWatch(env, watch.id, FAILURE_RETRY_MS);
      return;
    }
  }

  const nextSeen = [
    ...watch.seenIds,
    ...entries.map((entry) => entry.id),
  ].filter((id, index, all) => all.lastIndexOf(id) === index).slice(-FEEDSEEK_SEEN_LIMIT);

  await updateConditionWatch(env, {
    ...activeWatch(watch, now, FEEDSEEK_INTERVAL_MS),
    cursorAt: new Date(now).toISOString(),
    seenIds: nextSeen,
  });
}

async function processSecretary(
  env: Env,
  watch: SecretaryIdleWatch,
  send: WatchSender,
): Promise<void> {
  if (!secretaryAutoReplyEnabled(env.SECRETARY_AUTO_REPLY_SCOPE)) {
    await cancelConditionWatch(env, watch.id);
    return;
  }

  const result = await chatWithInlineFallback(env, [
    { role: "system", content: secretaryAutoReplySystemPrompt() },
    {
      role: "user",
      content: [
        watch.contextBlock,
        `The final contact is ${watch.sender}. The owner still has not replied after about 12 hours. Write Botek's automatic reply now.`,
      ].join("\n\n"),
    },
  ]);
  const text = result.text.trim().slice(0, 400);
  if (!text) {
    await cancelConditionWatch(env, watch.id);
    return;
  }

  try {
    await send(env, watch.chatId, text, {
      replyToMessageId: watch.replyToMessageId,
      businessConnectionId: watch.connectionId,
    });
  } catch (error) {
    const delivery = error as { ambiguous?: unknown; retryable?: unknown };
    if (delivery.ambiguous === true || delivery.retryable === false) {
      await cancelConditionWatch(env, watch.id);
      return;
    }
    console.error("Secretary idle auto-reply delivery failed", watch.id, error);
    await releaseConditionWatch(env, watch.id, FAILURE_RETRY_MS);
    return;
  }

  await cancelConditionWatch(env, watch.id);
}

async function processClaimedWatch(
  env: Env,
  watch: ConditionWatch,
  send: WatchSender,
  now: number,
): Promise<void> {
  try {
    if (watch.kind === "legion") {
      await processLegion(env, watch, send, now);
    } else if (watch.kind === "github") {
      await processGithub(env, watch, send, now);
    } else if (watch.kind === "secretary") {
      await processSecretary(env, watch, send);
    } else {
      await processFeedseek(env, watch, send, now);
    }
  } catch (error) {
    console.warn("Condition watch source check failed", watch.id, error);
    await releaseConditionWatch(env, watch.id, FAILURE_RETRY_MS).catch((releaseError) => {
      console.error("Condition watch release failed", watch.id, releaseError);
    });
  }
}

export async function processConditionWatches(
  env: Env,
  send: WatchSender,
  now = Date.now(),
): Promise<void> {
  let due: ConditionWatch[];
  try {
    due = await dueConditionWatches(env);
  } catch (error) {
    console.error("Condition watch due read failed", error);
    return;
  }

  const claimed = (await Promise.all(
    due.slice(0, 8).map((watch) =>
      claimConditionWatch(env, watch.id).catch((error) => {
        console.warn("Condition watch claim failed", watch.id, error);
        return null;
      })
    ),
  )).filter((watch): watch is ConditionWatch => watch !== null);

  await Promise.allSettled(
    claimed.map((watch) => processClaimedWatch(env, watch, send, now)),
  );
}

export function conditionWatchListView(watches: ConditionWatch[]): string {
  if (!watches.length) return "Brak aktywnych watcherów.";

  return watches.map((watch) => {
    if (watch.kind === "legion") {
      return `👁️ ${watch.id} · Legion · ${watch.condition}`;
    }
    if (watch.kind === "github") {
      return `👁️ ${watch.id} · GitHub ${watch.repository}#${watch.number} · ${watch.condition}`;
    }
    if (watch.kind === "secretary") {
      return `👁️ ${watch.id} · Sekretarz · ${watch.sender} · idle 12 h`;
    }
    return `👁️ ${watch.id} · Feedseek · „${watch.query}”`;
  }).join("\n").slice(0, 4_000);
}

export async function activeConditionWatchList(env: Env): Promise<string> {
  return conditionWatchListView(await listConditionWatches(env));
}
