import telegramConfig from "../telegram-config.json";
import { readJsonWithLimit } from "./http";
import type {
  Env,
  TelegramInlineKeyboardMarkup,
  TelegramInlineQueryResultArticle,
  TelegramUpdate,
} from "./types";

const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;
export const TELEGRAM_ALLOWED_UPDATES = telegramConfig.allowedUpdates;
const TELEGRAM_UPDATE_MAX_BYTES = 256 * 1024;

type TelegramErrorPayload = {
  description?: string;
  parameters?: { retry_after?: number };
};

type TelegramFilePayload = {
  ok?: boolean;
  description?: string;
  result?: { file_path?: string; file_size?: number };
};

export class TelegramConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramConfigurationError";
  }
}

export class TelegramSendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "TelegramSendError";
  }
}

export function isTelegramWebhook(request: Request, env: Env): boolean {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return Boolean(expected && actual && actual === expected);
}

export async function parseTelegramUpdate(request: Request): Promise<TelegramUpdate> {
  return readJsonWithLimit<TelegramUpdate>(request, TELEGRAM_UPDATE_MAX_BYTES);
}

export async function downloadTelegramFile(
  env: Env,
  fileId: string,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }

  const metadataResponse = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const metadata = (await metadataResponse.json()) as TelegramFilePayload;
  const filePath = metadata.result?.file_path;
  if (!metadataResponse.ok || !metadata.ok || !filePath) {
    throw new Error(`Telegram getFile failed: ${metadata.description ?? `HTTP ${metadataResponse.status}`}`);
  }
  if ((metadata.result?.file_size ?? 0) > maxBytes) {
    throw new RangeError(`Telegram file exceeds ${maxBytes} bytes`);
  }

  const fileResponse = await fetch(`${TELEGRAM_API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileResponse.ok) {
    throw new Error(`Telegram file download failed: HTTP ${fileResponse.status}`);
  }
  const contentLength = Number(fileResponse.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RangeError(`Telegram file exceeds ${maxBytes} bytes`);
  }
  const buffer = await fileResponse.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new RangeError(`Telegram file exceeds ${maxBytes} bytes`);
  }
  return buffer;
}

export async function syncTelegramCommandMenu(
  env: Env,
  chatId: number,
  commands: Array<{ command: string; description: string }>,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }

  const calls = [
    {
      method: "setMyCommands",
      body: { commands, scope: { type: "chat", chat_id: chatId } },
    },
    {
      method: "setChatMenuButton",
      body: { chat_id: chatId, menu_button: { type: "commands" } },
    },
  ] as const;

  for (const call of calls) {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${call.method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(call.body),
    });
    if (!response.ok) {
      throw new Error(`Telegram ${call.method} failed: HTTP ${response.status}`);
    }
  }
}

export async function syncTelegramWebhook(env: Env, webhookUrl: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    throw new TelegramConfigurationError("Telegram webhook credentials are not configured");
  }

  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram setWebhook failed: HTTP ${response.status}`);
  }
}

export async function setTelegramMessageReaction(
  env: Env,
  chatId: string | number,
  messageId: number,
  emoji: string,
  isBig = false,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/setMessageReaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
        is_big: isBig,
      }),
    });
    if (!response.ok) {
      console.warn(`Telegram setMessageReaction failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn("Telegram setMessageReaction failed", error);
  }
}

export async function sendTelegramTyping(env: Env, chatId: string | number): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
    if (!response.ok) {
      console.warn(`Telegram sendChatAction failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn("Telegram sendChatAction failed", error);
  }
}
export async function sendTelegramThinking(
  env: Env,
  chatId: string | number,
  draftId: number,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessageDraft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        draft_id: draftId === 0 ? 1 : draftId,
        text: "",
      }),
    });
    if (response.ok) return;
    console.warn(`Telegram sendMessageDraft failed: HTTP ${response.status}; falling back to typing`);
  } catch (error) {
    console.warn("Telegram sendMessageDraft failed; falling back to typing", error);
  }
  await sendTelegramTyping(env, chatId);
}

async function telegramDelivery(
  env: Env,
  method: "sendMessage" | "sendRichMessage" | "editMessageText",
  body: Record<string, unknown>,
  acceptNotModified = false,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new TelegramSendError(
      0,
      `Telegram network failure: ${error instanceof Error ? error.message : String(error)}`,
      true,
      undefined,
      true,
    );
  }

  if (response.ok) return;

  const raw = await response.text();
  let payload: TelegramErrorPayload | null = null;
  try {
    payload = JSON.parse(raw) as TelegramErrorPayload;
  } catch {
    // Keep the bounded raw response in the error below.
  }
  if (
    acceptNotModified &&
    response.status === 400 &&
    payload?.description?.toLowerCase().includes("message is not modified")
  ) {
    return;
  }
  const retryAfter = payload?.parameters?.retry_after;
  const retryable = response.status === 429 || response.status >= 500;
  throw new TelegramSendError(
    response.status,
    `Telegram ${method} failed: ${response.status} ${(payload?.description ?? raw).slice(0, 240)}`,
    retryable,
    typeof retryAfter === "number" && Number.isFinite(retryAfter)
      ? Math.max(1, Math.ceil(retryAfter))
      : undefined,
  );
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string | number,
  text: string,
  options: { replyToMessageId?: number; replyMarkup?: TelegramInlineKeyboardMarkup } = {},
): Promise<void> {
  await telegramDelivery(env, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, TELEGRAM_MESSAGE_MAX_CHARS),
    disable_web_page_preview: true,
    ...(options.replyToMessageId !== undefined
      ? {
          reply_parameters: {
            message_id: options.replyToMessageId,
            allow_sending_without_reply: true,
          },
        }
      : {}),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function sendTelegramRichMessage(
  env: Env,
  chatId: string | number,
  markdown: string,
  options: { replyToMessageId?: number; replyMarkup?: TelegramInlineKeyboardMarkup } = {},
): Promise<void> {
  const text = markdown.slice(0, TELEGRAM_MESSAGE_MAX_CHARS);
  try {
    await telegramDelivery(env, "sendRichMessage", {
      chat_id: chatId,
      rich_message: { markdown: text },
      ...(options.replyToMessageId !== undefined
        ? {
            reply_parameters: {
              message_id: options.replyToMessageId,
              allow_sending_without_reply: true,
            },
          }
        : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  } catch (error) {
    if (
      error instanceof TelegramSendError &&
      error.status === 400 &&
      !error.retryable &&
      !error.ambiguous
    ) {
      console.warn("Telegram rejected rich Markdown; falling back to plain sendMessage");
      await sendTelegramMessage(env, chatId, text, options);
      return;
    }
    throw error;
  }
}

export async function answerTelegramInlineQuery(
  env: Env,
  inlineQueryId: string,
  results: TelegramInlineQueryResultArticle[],
  button?: { text: string; start_parameter: string },
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/answerInlineQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inline_query_id: inlineQueryId,
      results,
      cache_time: 0,
      is_personal: true,
      next_offset: "",
      ...(button ? { button } : {}),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Telegram answerInlineQuery failed: HTTP ${response.status} ${detail}`);
  }
}

export async function answerTelegramCallbackQuery(
  env: Env,
  callbackQueryId: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
    if (!response.ok) {
      console.warn(`Telegram answerCallbackQuery failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn("Telegram answerCallbackQuery failed", error);
  }
}

export async function editTelegramMessage(
  env: Env,
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  await telegramDelivery(
    env,
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, TELEGRAM_MESSAGE_MAX_CHARS),
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
    true,
  );
}