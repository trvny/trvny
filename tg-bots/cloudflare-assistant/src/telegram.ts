import telegramConfig from "../telegram-config.json";
import { readJsonWithLimit } from "./http";
import { telegramMiniAppMenuButton } from "./mini-app-menu";
import type {
  Env,
  TelegramInlineKeyboardMarkup,
  TelegramInlineQueryResultArticle,
  TelegramUpdate,
} from "./types";

const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;
export const TELEGRAM_RICH_MESSAGE_MAX_CHARS = 32768;
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

type TelegramThreadOptions = { messageThreadId?: number };
type TelegramEphemeralOptions = {
  receiverUserId: number;
  replyEphemeralMessageId: number;
};
type TelegramMessageOptions = TelegramThreadOptions & {
  replyToMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  ephemeral?: TelegramEphemeralOptions;
  businessConnectionId?: string;
};
type TelegramBotCommand = { command: string; description: string; is_ephemeral?: boolean };

export function escapeTelegramRichHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function telegramThreadFields(messageThreadId?: number): Record<string, number> {
  return Number.isSafeInteger(messageThreadId) && (messageThreadId ?? 0) > 0
    ? { message_thread_id: messageThreadId as number }
    : {};
}

function telegramReplyFields(options: TelegramMessageOptions): Record<string, unknown> {
  if (options.ephemeral) {
    return {
      ephemeral_message_parameters: {
        receiver_user_id: options.ephemeral.receiverUserId,
      },
      reply_parameters: {
        ephemeral_message_id: options.ephemeral.replyEphemeralMessageId,
      },
    };
  }
  if (options.replyToMessageId !== undefined) {
    return {
      reply_parameters: {
        message_id: options.replyToMessageId,
        allow_sending_without_reply: true,
      },
    };
  }
  return {};
}

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
  commands: TelegramBotCommand[],
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, scope: { type: "chat", chat_id: chatId } }),
  });
  if (!response.ok) {
    throw new Error(`Telegram setMyCommands failed: HTTP ${response.status}`);
  }
}

export async function syncTelegramMiniAppMenu(
  env: Env,
  chatId: number,
  miniAppUrl: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: telegramMiniAppMenuButton(miniAppUrl),
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram setChatMenuButton failed: HTTP ${response.status}`);
  }
}

export async function syncTelegramGroupCommandMenu(
  env: Env,
  chatId: number,
  userId: number,
  commands: TelegramBotCommand[],
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands,
      scope: { type: "chat_member", chat_id: chatId, user_id: userId },
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram setMyCommands for group member failed: HTTP ${response.status}`);
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

export async function sendTelegramTyping(
  env: Env,
  chatId: string | number,
  messageThreadId?: number,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        ...telegramThreadFields(messageThreadId),
        action: "typing",
      }),
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
  messageThreadId?: number,
  canStop = false,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessageDraft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        ...telegramThreadFields(messageThreadId),
        draft_id: draftId === 0 ? 1 : draftId,
        text: "",
        ...(canStop ? { can_stop: true, keep_on_stop: true } : {}),
      }),
    });
    if (response.ok) return;
    console.warn(`Telegram sendMessageDraft failed: HTTP ${response.status}; falling back to typing`);
  } catch (error) {
    console.warn("Telegram sendMessageDraft failed; falling back to typing", error);
  }
  await sendTelegramTyping(env, chatId, messageThreadId);
}

async function telegramDelivery(
  env: Env,
  method: "sendMessage" | "sendMessageDraft" | "sendRichMessage" | "sendRichMessageDraft" | "sendPoll" | "sendDice" | "sendSticker" | "sendLocation" | "sendVenue" | "sendContact" | "createForumTopic" | "editMessageText" | "answerGuestQuery",
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

export type TelegramStreamingDraftMode = "rich" | "plain";

export async function sendTelegramStreamingDraft(
  env: Env,
  chatId: string | number,
  draftId: number,
  markdown: string,
  messageThreadId?: number,
  mode: TelegramStreamingDraftMode = "rich",
): Promise<TelegramStreamingDraftMode> {
  const richText = markdown.slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS);
  const plainText = markdown.slice(0, TELEGRAM_MESSAGE_MAX_CHARS);
  if (!richText || !env.TELEGRAM_BOT_TOKEN) return mode;
  const bodyBase = {
    chat_id: chatId,
    ...telegramThreadFields(messageThreadId),
    draft_id: draftId === 0 ? 1 : draftId,
    can_stop: true,
    keep_on_stop: true,
  };

  if (mode === "rich") {
    try {
      await telegramDelivery(env, "sendRichMessageDraft", {
        ...bodyBase,
        rich_message: { markdown: richText },
      });
      return "rich";
    } catch (error) {
      if (
        error instanceof TelegramSendError &&
        error.status === 400 &&
        !error.retryable &&
        !error.ambiguous
      ) {
        console.warn("Telegram rejected a partial rich draft; switching this stream to plain drafts");
      } else {
        console.warn("Telegram rich draft update failed", error);
        return mode;
      }
    }
  }

  try {
    await telegramDelivery(env, "sendMessageDraft", { ...bodyBase, text: plainText });
  } catch (error) {
    console.warn("Telegram plain draft update failed", error);
  }
  return "plain";
}

export async function createTelegramForumTopic(
  env: Env,
  chatId: string | number,
  name: string,
): Promise<void> {
  await telegramDelivery(env, "createForumTopic", {
    chat_id: chatId,
    name,
  });
}

export async function sendTelegramLocation(
  env: Env,
  chatId: string | number,
  latitude: number,
  longitude: number,
  options: TelegramThreadOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendLocation", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    latitude,
    longitude,
  });
}

export async function sendTelegramVenue(
  env: Env,
  chatId: string | number,
  latitude: number,
  longitude: number,
  title: string,
  address: string,
  options: TelegramThreadOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendVenue", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    latitude,
    longitude,
    title,
    address,
  });
}

export async function sendTelegramContact(
  env: Env,
  chatId: string | number,
  phoneNumber: string,
  firstName: string,
  lastName?: string,
  options: TelegramThreadOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendContact", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    phone_number: phoneNumber,
    first_name: firstName,
    ...(lastName ? { last_name: lastName } : {}),
  });
}

export async function sendTelegramSticker(
  env: Env,
  chatId: string | number,
  fileId: string,
  emoji?: string,
  options: TelegramThreadOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendSticker", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    sticker: fileId,
    ...(emoji ? { emoji } : {}),
  });
}

export async function sendTelegramDice(
  env: Env,
  chatId: string | number,
  emoji: string,
  options: TelegramThreadOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendDice", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    emoji,
  });
}

export async function sendTelegramPoll(
  env: Env,
  chatId: string | number,
  question: string,
  options: string[],
  correctOptionIds: number[] = [],
  deliveryOptions: TelegramThreadOptions = {},
): Promise<void> {
  const quiz = correctOptionIds.length > 0;
  const validCorrectOptionIds = [...new Set(correctOptionIds)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < options.length)
    .sort((a, b) => a - b);
  if (quiz && validCorrectOptionIds.length !== correctOptionIds.length) {
    throw new RangeError("Telegram quiz has invalid correct option indexes");
  }

  await telegramDelivery(env, "sendPoll", {
    chat_id: chatId,
    ...telegramThreadFields(deliveryOptions.messageThreadId),
    question,
    options: options.map((text) => ({ text })),
    is_anonymous: false,
    type: quiz ? "quiz" : "regular",
    ...(quiz ? {
      correct_option_ids: validCorrectOptionIds,
      allows_multiple_answers: validCorrectOptionIds.length > 1,
    } : {}),
  });
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string | number,
  text: string,
  options: TelegramMessageOptions = {},
): Promise<void> {
  await telegramDelivery(env, "sendMessage", {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    ...(options.businessConnectionId ? { business_connection_id: options.businessConnectionId } : {}),
    text: text.slice(0, TELEGRAM_MESSAGE_MAX_CHARS),
    disable_web_page_preview: true,
    ...telegramReplyFields(options),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function sendTelegramRichMessage(
  env: Env,
  chatId: string | number,
  markdown: string,
  options: TelegramMessageOptions = {},
): Promise<void> {
  const text = markdown.slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS);
  const bodyBase = {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    ...telegramReplyFields(options),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  };
  try {
    await telegramDelivery(env, "sendRichMessage", {
      ...bodyBase,
      rich_message: { markdown: text },
    });
    return;
  } catch (error) {
    if (!(
      error instanceof TelegramSendError &&
      error.status === 400 &&
      !error.retryable &&
      !error.ambiguous
    )) throw error;
  }

  console.warn("Telegram rejected rich Markdown; retrying as escaped Rich HTML");
  try {
    await telegramDelivery(env, "sendRichMessage", {
      ...bodyBase,
      rich_message: { html: escapeTelegramRichHtml(text) },
    });
    return;
  } catch (error) {
    if (!(
      error instanceof TelegramSendError &&
      error.status === 400 &&
      !error.retryable &&
      !error.ambiguous
    )) throw error;
  }

  console.warn("Telegram rejected both rich formats; falling back to bounded plain sendMessage");
  await sendTelegramMessage(env, chatId, text, options);
}

export async function sendTelegramRichHtml(
  env: Env,
  chatId: string | number,
  html: string,
  fallbackText: string,
  options: TelegramMessageOptions = {},
): Promise<void> {
  const bodyBase = {
    chat_id: chatId,
    ...telegramThreadFields(options.messageThreadId),
    ...telegramReplyFields(options),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  };
  try {
    await telegramDelivery(env, "sendRichMessage", {
      ...bodyBase,
      rich_message: { html: html.slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS) },
    });
  } catch (error) {
    if (!(
      error instanceof TelegramSendError &&
      error.status === 400 &&
      !error.retryable &&
      !error.ambiguous
    )) throw error;
    console.warn("Telegram rejected structured Rich HTML; falling back to plain text");
    await sendTelegramMessage(env, chatId, fallbackText, options);
  }
}

export async function editTelegramRichHtml(
  env: Env,
  chatId: string | number,
  messageId: number,
  html: string,
  fallbackText: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  try {
    await telegramDelivery(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      rich_message: { html: html.slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS) },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }, true);
  } catch (error) {
    if (!(
      error instanceof TelegramSendError &&
      error.status === 400 &&
      !error.retryable &&
      !error.ambiguous
    )) throw error;
    console.warn("Telegram rejected edited Rich HTML; falling back to plain edit");
    await editTelegramMessage(env, chatId, messageId, fallbackText, replyMarkup);
  }
}
export async function answerTelegramGuestQuery(
  env: Env,
  guestQueryId: string,
  result: TelegramInlineQueryResultArticle,
): Promise<void> {
  await telegramDelivery(env, "answerGuestQuery", {
    guest_query_id: guestQueryId,
    result,
  });
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