import { TelegramUpdateDedup } from "./dedup";
import { PayloadTooLargeError, readJsonWithLimit } from "./http";
import {
  AllProvidersFailedError,
  chatWithFallback,
  completeWithFallback,
} from "./providers";
import {
  isTelegramWebhook,
  parseTelegramUpdate,
  sendTelegramMessage,
  TelegramConfigurationError,
  TelegramSendError,
} from "./telegram";
import type {
  Env,
  QueueBatch,
  RssDecision,
  RssItem,
  TelegramDeadLetter,
  TelegramReply,
  TelegramUpdate,
  TelegramUpdateRecord,
} from "./types";

export { TelegramUpdateDedup };

const RSS_BODY_MAX_BYTES = 64 * 1024;
const DEFAULT_RSS_MIN_SCORE = 75;
const CURATOR_SUMMARY_MAX_CHARS = 800;
const CURATOR_REASON_MAX_CHARS = 400;
const DEFAULT_RETRY_DELAY_SECONDS = 5;

const ASSISTANT_SYSTEM = `You are a private Telegram assistant for one owner.
Be concise, practical and friendly. Prefer Polish unless the user writes in another language.
Never claim that you executed actions you did not actually execute.`;

class AssistantConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantConfigurationError";
  }
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
  });
}

function ownerConfigured(env: Env): boolean {
  return Boolean(env.OWNER_TELEGRAM_USER_ID && /^-?\d+$/.test(env.OWNER_TELEGRAM_USER_ID));
}

async function buildTelegramReply(env: Env, update: TelegramUpdate): Promise<TelegramReply | null> {
  const message = update.message;
  if (!message?.text || !message.from) return null;

  if (
    !ownerConfigured(env) ||
    message.chat.type !== "private" ||
    String(message.from.id) !== env.OWNER_TELEGRAM_USER_ID
  ) {
    return null;
  }

  const text = message.text.trim();
  if (!text) return null;

  if (text === "/start" || text === "/help") {
    return {
      chatId: message.chat.id,
      text: [
        "Cloudflare assistant online.",
        "",
        "/status — provider chain",
        "/draft <tekst> — przygotuj odpowiedź, niczego nie wysyłaj",
        "Każdy inny tekst — zwykła rozmowa z asystentem.",
      ].join("\n"),
    };
  }

  if (text === "/status") {
    const router = env.KANAREK_REVIEW_ROUTER_TOKEN
      ? "Kanarek free router: OpenRouter → OrcaRouter → AIHubMix → Workers AI"
      : "Kanarek free router: token not configured";
    return {
      chatId: message.chat.id,
      text: `Provider chain:\n${router}\nEmergency fallback: Workers AI (${env.WORKERS_AI_MODEL})`,
    };
  }

  const isDraft = text.startsWith("/draft ");
  const prompt = isDraft ? text.slice("/draft ".length).trim() : text;
  const system = isDraft
    ? `${ASSISTANT_SYSTEM}\nDraft a reply to the message supplied by the owner. Return only the suggested reply. Never send it yourself.`
    : ASSISTANT_SYSTEM;

  try {
    const result = await chatWithFallback(env, [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ]);
    return {
      chatId: message.chat.id,
      text: `${result.text}\n\n[${result.provider} · ${result.model}]`,
    };
  } catch (error) {
    console.error("All chat providers failed", error);
    return {
      chatId: message.chat.id,
      text: "Nie udało się uzyskać odpowiedzi z żadnego providera. Spróbuj za chwilę.",
    };
  }
}

function validIngestAuth(request: Request, env: Env): boolean {
  const secret = env.INGEST_SECRET;
  return Boolean(secret && request.headers.get("Authorization") === `Bearer ${secret}`);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRssItem(value: unknown): value is RssItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;

  if (
    typeof item.title !== "string" ||
    item.title.length === 0 ||
    item.title.length > 500 ||
    typeof item.url !== "string" ||
    item.url.length === 0 ||
    item.url.length > 2048 ||
    !isHttpUrl(item.url)
  ) {
    return false;
  }

  if (item.summary !== undefined && (typeof item.summary !== "string" || item.summary.length > 8_000)) {
    return false;
  }
  if (item.source !== undefined && (typeof item.source !== "string" || item.source.length > 200)) {
    return false;
  }

  return true;
}

function parseRssDecision(text: string): RssDecision {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let decision: RssDecision;
  try {
    decision = JSON.parse(normalized) as RssDecision;
  } catch {
    throw new Error(`invalid curator JSON: ${text.slice(0, 240)}`);
  }

  if (
    typeof decision.score !== "number" ||
    !Number.isFinite(decision.score) ||
    decision.score < 0 ||
    decision.score > 100 ||
    typeof decision.reason !== "string" ||
    decision.reason.length > CURATOR_REASON_MAX_CHARS ||
    typeof decision.summary !== "string" ||
    decision.summary.length > CURATOR_SUMMARY_MAX_CHARS
  ) {
    throw new Error("curator response has an invalid score/reason/summary");
  }

  return decision;
}

function rssThreshold(env: Env): number {
  const configured = Number(env.RSS_MIN_SCORE);
  if (Number.isFinite(configured) && configured >= 0 && configured <= 100) {
    return configured;
  }

  console.warn(`Invalid RSS_MIN_SCORE=${env.RSS_MIN_SCORE}; using ${DEFAULT_RSS_MIN_SCORE}`);
  return DEFAULT_RSS_MIN_SCORE;
}

function rssTelegramText(item: RssItem, decision: RssDecision): string {
  const body = [
    `RSS ${decision.score}/100${item.source ? ` · ${item.source}` : ""}`,
    item.title,
    decision.summary,
    decision.reason,
  ].join("\n\n");
  const bodyLimit = Math.max(0, 4096 - item.url.length - 2);
  return `${body.slice(0, bodyLimit)}\n\n${item.url}`;
}

async function curateRss(env: Env, item: RssItem): Promise<Response> {
  const result = await completeWithFallback(
    env,
    [
      {
        role: "system",
        content:
          "You curate a private RSS inbox. Score the item 0-100 for usefulness or interestingness. " +
          `Keep summary under ${CURATOR_SUMMARY_MAX_CHARS} characters and reason under ${CURATOR_REASON_MAX_CHARS} characters. ` +
          "Return STRICT JSON only: {\"score\":number,\"reason\":string,\"summary\":string}. " +
          "Be selective; routine marketing and trivial changelogs should score low.",
      },
      { role: "user", content: JSON.stringify(item) },
    ],
    parseRssDecision,
  );

  const decision = result.value;
  const threshold = rssThreshold(env);
  const selected = decision.score >= threshold;

  if (selected) {
    if (!env.TELEGRAM_OWNER_CHAT_ID) {
      throw new AssistantConfigurationError("TELEGRAM_OWNER_CHAT_ID is not configured");
    }
    await sendTelegramMessage(env, env.TELEGRAM_OWNER_CHAT_ID, rssTelegramText(item, decision));
  }

  return json({ selected, threshold, decision, provider: result.provider, model: result.model });
}

function invalidBody(error: unknown): Response {
  if (error instanceof PayloadTooLargeError) {
    return json({ error: error.message }, { status: 413 });
  }
  return json({ error: "invalid JSON body" }, { status: 400 });
}

function rssFailure(error: unknown): Response {
  if (error instanceof AllProvidersFailedError) {
    return json({ error: "providers_unavailable", retryable: true }, { status: 503 });
  }
  if (error instanceof AssistantConfigurationError || error instanceof TelegramConfigurationError) {
    return json({ error: "configuration_error", retryable: false }, { status: 500 });
  }
  if (error instanceof TelegramSendError) {
    return json(
      {
        error: "telegram_delivery_failed",
        retryable: error.retryable,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      { status: error.retryable ? 502 : 500 },
    );
  }

  return json({ error: "internal_error", retryable: false }, { status: 500 });
}

function dedupStub(env: Env, updateId: number) {
  return env.TELEGRAM_DEDUP.get(env.TELEGRAM_DEDUP.idFromName(String(updateId)));
}

async function dedupState(env: Env, updateId: number): Promise<TelegramUpdateRecord | null> {
  const response = await dedupStub(env, updateId).fetch("https://dedup/state");
  if (!response.ok) throw new Error(`dedup state read failed: HTTP ${response.status}`);
  return (await response.json()) as TelegramUpdateRecord | null;
}

async function dedupTransition(
  env: Env,
  updateId: number,
  action: "prepare" | "sending" | "retry" | "sent" | "failed" | "ambiguous",
  reply?: TelegramReply,
  detail?: string,
): Promise<TelegramUpdateRecord> {
  const response = await dedupStub(env, updateId).fetch(`https://dedup/${action}`, {
    method: "POST",
    headers: detail ? { "x-detail": detail.slice(0, 240), "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: action === "prepare" ? JSON.stringify({ reply }) : "{}",
  });
  if (!response.ok) throw new Error(`dedup ${action} failed: HTTP ${response.status}`);
  return (await response.json()) as TelegramUpdateRecord;
}

async function deadLetter(
  env: Env,
  update: TelegramUpdate,
  reason: string,
  detail?: string,
): Promise<void> {
  const record: TelegramDeadLetter = {
    update,
    reason,
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
    createdAt: new Date().toISOString(),
  };
  await env.TELEGRAM_DLQ.send(record);
}

function terminalDedup(state: TelegramUpdateRecord | null): boolean {
  return Boolean(state && (state.status === "sent" || state.status === "failed" || state.status === "ambiguous"));
}

async function processQueuedTelegram(
  env: Env,
  message: QueueBatch<TelegramUpdate>["messages"][number],
): Promise<void> {
  const update = message.body;
  let state = await dedupState(env, update.update_id);

  if (terminalDedup(state)) {
    message.ack();
    return;
  }

  if (state?.status === "sending") {
    await dedupTransition(env, update.update_id, "ambiguous", undefined, "recovered from interrupted send window");
    await deadLetter(env, update, "ambiguous_delivery", "previous attempt stopped while sending");
    message.ack();
    return;
  }

  let reply = state?.reply;
  if (!reply) {
    reply = await buildTelegramReply(env, update) ?? undefined;
    if (!reply) {
      await dedupTransition(env, update.update_id, "sent", undefined, "ignored update");
      message.ack();
      return;
    }
    state = await dedupTransition(env, update.update_id, "prepare", reply);
  }

  await dedupTransition(env, update.update_id, "sending");
  try {
    await sendTelegramMessage(env, reply.chatId, reply.text);
  } catch (error) {
    if (error instanceof TelegramSendError) {
      if (error.ambiguous) {
        await dedupTransition(env, update.update_id, "ambiguous", undefined, error.message);
        await deadLetter(env, update, "ambiguous_delivery", error.message);
        message.ack();
        return;
      }
      if (error.retryable) {
        await dedupTransition(env, update.update_id, "retry", undefined, error.message);
        message.retry({
          delaySeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
        });
        return;
      }
      await dedupTransition(env, update.update_id, "failed", undefined, error.message);
      await deadLetter(env, update, "telegram_rejected", error.message);
      message.ack();
      return;
    }

    if (error instanceof TelegramConfigurationError) {
      await dedupTransition(env, update.update_id, "failed", undefined, error.message);
      await deadLetter(env, update, "configuration_error", error.message);
      message.ack();
      return;
    }

    await dedupTransition(env, update.update_id, "retry", undefined, String(error));
    message.retry({ delaySeconds: DEFAULT_RETRY_DELAY_SECONDS });
    return;
  }

  try {
    await dedupTransition(env, update.update_id, "sent");
  } catch (error) {
    const detail = `Telegram accepted the reply but the sent-state commit failed: ${String(error)}`;
    try {
      await dedupTransition(env, update.update_id, "ambiguous", undefined, detail);
      await deadLetter(env, update, "sent_state_commit_failed", detail);
    } catch (recoveryError) {
      console.error("Failed to persist ambiguous Telegram delivery", recoveryError);
    }
    message.ack();
    return;
  }
  message.ack();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "travny-tg-assistant" });
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      if (!isTelegramWebhook(request, env)) return new Response("Forbidden", { status: 403 });

      let update: TelegramUpdate;
      try {
        update = await parseTelegramUpdate(request);
      } catch (error) {
        return invalidBody(error);
      }

      try {
        await env.TELEGRAM_UPDATES.send(update);
      } catch (error) {
        console.error("Failed to enqueue Telegram update", error);
        return new Response("Service unavailable", { status: 503 });
      }
      return new Response("OK");
    }

    if (request.method === "POST" && url.pathname === "/ingest/rss") {
      if (!validIngestAuth(request, env)) return new Response("Forbidden", { status: 403 });

      let body: unknown;
      try {
        body = await readJsonWithLimit<unknown>(request, RSS_BODY_MAX_BYTES);
      } catch (error) {
        return invalidBody(error);
      }

      if (!isRssItem(body)) return json({ error: "invalid RSS item" }, { status: 400 });

      try {
        return await curateRss(env, body);
      } catch (error) {
        console.error("RSS processing failed", error);
        return rssFailure(error);
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: QueueBatch<TelegramUpdate>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processQueuedTelegram(env, message);
      } catch (error) {
        console.error("Telegram queue processing failed", error);
        message.retry({ delaySeconds: DEFAULT_RETRY_DELAY_SECONDS });
      }
    }
  },
};
