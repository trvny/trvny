import { chatWithFallback } from "./providers";
import {
  isTelegramWebhook,
  parseTelegramUpdate,
  sendTelegramMessage,
} from "./telegram";
import type { Env, ExecutionContextLike, RssDecision, RssItem, TelegramUpdate } from "./types";

const ASSISTANT_SYSTEM = `You are a private Telegram assistant for one owner.
Be concise, practical and friendly. Prefer Polish unless the user writes in another language.
Never claim that you executed actions you did not actually execute.`;

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
  });
}

function ownerConfigured(env: Env): boolean {
  return /^-?\d+$/.test(env.OWNER_TELEGRAM_USER_ID);
}

async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || !message.from) return;

  if (!ownerConfigured(env) || String(message.from.id) !== env.OWNER_TELEGRAM_USER_ID) {
    return;
  }

  const text = message.text.trim();
  if (!text) return;

  if (text === "/start" || text === "/help") {
    await sendTelegramMessage(
      env,
      message.chat.id,
      [
        "Cloudflare assistant online.",
        "",
        "/status — provider chain",
        "/draft <tekst> — przygotuj odpowiedź, niczego nie wysyłaj",
        "Każdy inny tekst — zwykła rozmowa z asystentem.",
      ].join("\n"),
    );
    return;
  }

  if (text === "/status") {
    const configured = [
      env.ORCAROUTER_API_KEY && `OrcaRouter:${env.ORCAROUTER_MODEL}`,
      env.OLLAMA_API_KEY && `Ollama:${env.OLLAMA_MODEL}`,
      env.OPENROUTER_API_KEY && `OpenRouter:${env.OPENROUTER_MODEL}`,
      `WorkersAI:${env.WORKERS_AI_MODEL}`,
    ].filter(Boolean);
    await sendTelegramMessage(env, message.chat.id, `Fallback chain:\n${configured.join("\n")}`);
    return;
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
    await sendTelegramMessage(
      env,
      message.chat.id,
      `${result.text}\n\n[${result.provider} · ${result.model}]`,
    );
  } catch (error) {
    console.error("All chat providers failed", error);
    await sendTelegramMessage(
      env,
      message.chat.id,
      "Nie udało się uzyskać odpowiedzi z żadnego providera. Spróbuj za chwilę.",
    );
  }
}

function validIngestAuth(request: Request, env: Env): boolean {
  return request.headers.get("Authorization") === `Bearer ${env.INGEST_SECRET}`;
}

function isRssItem(value: unknown): value is RssItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === "string" && typeof item.url === "string";
}

async function curateRss(env: Env, item: RssItem): Promise<Response> {
  const result = await chatWithFallback(env, [
    {
      role: "system",
      content:
        "You curate a private RSS inbox. Score the item 0-100 for usefulness or interestingness. " +
        "Return STRICT JSON only: {\"score\":number,\"reason\":string,\"summary\":string}. " +
        "Be selective; routine marketing and trivial changelogs should score low.",
    },
    {
      role: "user",
      content: JSON.stringify(item),
    },
  ]);

  let decision: RssDecision;
  try {
    decision = JSON.parse(result.text) as RssDecision;
  } catch {
    throw new Error(`Curator returned invalid JSON: ${result.text.slice(0, 300)}`);
  }

  if (
    typeof decision.score !== "number" ||
    typeof decision.reason !== "string" ||
    typeof decision.summary !== "string"
  ) {
    throw new Error("Curator response is missing score/reason/summary");
  }

  const threshold = Number(env.RSS_MIN_SCORE || "75");
  const selected = decision.score >= threshold;

  if (selected) {
    await sendTelegramMessage(
      env,
      env.TELEGRAM_OWNER_CHAT_ID,
      [
        `RSS ${decision.score}/100${item.source ? ` · ${item.source}` : ""}`,
        item.title,
        decision.summary,
        decision.reason,
        item.url,
      ].join("\n\n"),
    );
  }

  return json({ selected, threshold, decision, provider: result.provider, model: result.model });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "travny-tg-assistant" });
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      if (!isTelegramWebhook(request, env)) return new Response("Forbidden", { status: 403 });
      const update = await parseTelegramUpdate(request);
      ctx.waitUntil(
        handleTelegramUpdate(env, update).catch((error) =>
          console.error("Telegram update failed", error),
        ),
      );
      return new Response("OK");
    }

    if (request.method === "POST" && url.pathname === "/ingest/rss") {
      if (!validIngestAuth(request, env)) return new Response("Forbidden", { status: 403 });
      const body = await request.json();
      if (!isRssItem(body)) return json({ error: "title and url are required" }, { status: 400 });
      return curateRss(env, body);
    }

    return new Response("Not found", { status: 404 });
  },
};
