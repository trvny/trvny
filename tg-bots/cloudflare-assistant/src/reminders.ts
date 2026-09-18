import type { DurableObjectStateLike, Env } from "./types";

export type Reminder = {
  id: string;
  chatId: string | number;
  replyToMessageId: number;
  messageThreadId?: number;
  text: string;
  dueAt: string;
  createdAt: string;
  state: "pending" | "notifying";
};

const STORE_KEY = "reminders";
const MAX_REMINDERS = 64;
const DUE_LIMIT = 16;
const MAX_TEXT_CHARS = 1_500;
const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;
const RETAIN_OVERDUE_MS = 7 * 24 * 60 * 60 * 1_000;
const REMINDER_ID_RE = /^r[0-9a-z]{1,16}$/u;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function validReminder(value: unknown): value is Reminder {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const createdAt = typeof item.createdAt === "string" ? Date.parse(item.createdAt) : Number.NaN;
  const dueAt = typeof item.dueAt === "string" ? Date.parse(item.dueAt) : Number.NaN;
  return typeof item.id === "string" && REMINDER_ID_RE.test(item.id) &&
    (
      (typeof item.chatId === "string" && /^-?\d+$/u.test(item.chatId)) ||
      (typeof item.chatId === "number" && Number.isSafeInteger(item.chatId))
    ) &&
    typeof item.replyToMessageId === "number" && Number.isSafeInteger(item.replyToMessageId) &&
    item.replyToMessageId > 0 &&
    (item.messageThreadId === undefined ||
      (typeof item.messageThreadId === "number" && Number.isSafeInteger(item.messageThreadId) && item.messageThreadId > 0)) &&
    typeof item.text === "string" && item.text.length > 0 && item.text.length <= MAX_TEXT_CHARS &&
    Number.isFinite(createdAt) && Number.isFinite(dueAt) && dueAt >= createdAt &&
    dueAt - createdAt <= MAX_DELAY_MS + 60_000 &&
    (item.state === "pending" || item.state === "notifying");
}

function reminderId(value: unknown): value is { id: string } {
  return Boolean(
    value && typeof value === "object" &&
    typeof (value as Record<string, unknown>).id === "string" &&
    REMINDER_ID_RE.test((value as Record<string, string>).id),
  );
}

function prune(reminders: Reminder[], now = Date.now()): Reminder[] {
  return reminders.filter((reminder) => Date.parse(reminder.dueAt) + RETAIN_OVERDUE_MS >= now);
}

function sorted(reminders: Reminder[]): Reminder[] {
  return [...reminders].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export class TelegramReminderStore {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stored = (await this.state.storage.get<Reminder[]>(STORE_KEY)) ?? [];
    const current = prune(stored);
    if (current.length !== stored.length) await this.state.storage.put(STORE_KEY, current);

    if (request.method === "GET" && url.pathname === "/list") {
      return json(sorted(current));
    }
    if (request.method === "GET" && url.pathname === "/due") {
      const now = Date.now();
      return json(sorted(current.filter((item) =>
        item.state === "pending" && Date.parse(item.dueAt) <= now
      )).slice(0, DUE_LIMIT));
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const payload = await request.json();
    if (url.pathname === "/create") {
      if (!validReminder(payload)) return json({ error: "invalid_reminder" }, 400);
      const existing = current.find((item) => item.id === payload.id);
      if (existing) return json(existing);
      if (current.length >= MAX_REMINDERS) return json({ error: "reminder_limit" }, 409);
      const next = sorted([...current, payload]);
      await this.state.storage.put(STORE_KEY, next);
      return json(payload, 201);
    }

    if (!reminderId(payload)) return json({ error: "invalid_reminder_id" }, 400);
    const index = current.findIndex((item) => item.id === payload.id);

    if (url.pathname === "/reserve") {
      if (index < 0 || current[index].state !== "pending") return json({ reserved: false }, 409);
      const reserved = { ...current[index], state: "notifying" as const };
      await this.state.storage.put(
        STORE_KEY,
        current.map((item, itemIndex) => itemIndex === index ? reserved : item),
      );
      return json({ reserved: true, reminder: reserved });
    }

    if (url.pathname === "/release") {
      if (index >= 0) {
        await this.state.storage.put(
          STORE_KEY,
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: "pending" as const } : item
          ),
        );
      }
      return json({ ok: true });
    }

    if (url.pathname === "/finish" || url.pathname === "/cancel") {
      const removed = index >= 0;
      if (removed) {
        await this.state.storage.put(STORE_KEY, current.filter((item) => item.id !== payload.id));
      }
      return json({ ok: true, removed });
    }

    return json({ error: "not_found" }, 404);
  }
}

function reminderStub(env: Env) {
  return env.TELEGRAM_REMINDERS.get(env.TELEGRAM_REMINDERS.idFromName("owner-reminders"));
}

async function post(env: Env, path: string, payload: unknown): Promise<Response> {
  return reminderStub(env).fetch(`https://reminders${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function reminderIdForUpdate(updateId: number): string {
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new RangeError("invalid Telegram update id");
  return `r${updateId.toString(36)}`;
}

export async function createReminder(
  env: Env,
  input: {
    updateId: number;
    chatId: string | number;
    replyToMessageId: number;
    messageThreadId?: number;
    text: string;
    delayMs: number;
  },
  now = Date.now(),
): Promise<Reminder> {
  if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 60_000 || input.delayMs > MAX_DELAY_MS) {
    throw new RangeError("invalid reminder delay");
  }
  const reminder: Reminder = {
    id: reminderIdForUpdate(input.updateId),
    chatId: input.chatId,
    replyToMessageId: input.replyToMessageId,
    ...(input.messageThreadId ? { messageThreadId: input.messageThreadId } : {}),
    text: input.text.trim().slice(0, MAX_TEXT_CHARS),
    createdAt: new Date(now).toISOString(),
    dueAt: new Date(now + input.delayMs).toISOString(),
    state: "pending",
  };
  const response = await post(env, "/create", reminder);
  if (!response.ok) throw new Error(`reminder create failed: HTTP ${response.status}`);
  return response.json() as Promise<Reminder>;
}

export async function listReminders(env: Env): Promise<Reminder[]> {
  const response = await reminderStub(env).fetch("https://reminders/list");
  if (!response.ok) throw new Error(`reminder list failed: HTTP ${response.status}`);
  return response.json() as Promise<Reminder[]>;
}

export async function dueReminders(env: Env): Promise<Reminder[]> {
  const response = await reminderStub(env).fetch("https://reminders/due");
  if (!response.ok) throw new Error(`reminder due read failed: HTTP ${response.status}`);
  return response.json() as Promise<Reminder[]>;
}

export async function cancelReminder(env: Env, id: string): Promise<boolean> {
  const response = await post(env, "/cancel", { id });
  if (!response.ok) throw new Error(`reminder cancel failed: HTTP ${response.status}`);
  const result = await response.json() as { removed?: boolean };
  return result.removed === true;
}

export async function reserveReminder(env: Env, id: string): Promise<Reminder | null> {
  const response = await post(env, "/reserve", { id });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`reminder reserve failed: HTTP ${response.status}`);
  const result = await response.json() as { reserved?: boolean; reminder?: Reminder };
  return result.reserved && result.reminder ? result.reminder : null;
}

export async function releaseReminder(env: Env, id: string): Promise<void> {
  const response = await post(env, "/release", { id });
  if (!response.ok) throw new Error(`reminder release failed: HTTP ${response.status}`);
}

export async function finishReminder(env: Env, id: string): Promise<void> {
  const response = await post(env, "/finish", { id });
  if (!response.ok) throw new Error(`reminder finish failed: HTTP ${response.status}`);
}

export function formatReminderDueAt(dueAt: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dueAt));
}

export function reminderListView(reminders: Reminder[]): string {
  if (!reminders.length) return "Brak aktywnych przypomnień.";
  return reminders.map((reminder) =>
    `⏰ ${reminder.id} · ${formatReminderDueAt(reminder.dueAt)}\n${reminder.text}`
  ).join("\n\n").slice(0, 4_000);
}
