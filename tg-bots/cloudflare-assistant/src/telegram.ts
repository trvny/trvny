import { readJsonWithLimit } from "./http";
import type { Env, TelegramUpdate } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;
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

export async function sendTelegramMessage(
  env: Env,
  chatId: string | number,
  text: string,
  options: { replyToMessageId?: number } = {},
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
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
  const retryAfter = payload?.parameters?.retry_after;
  const retryable = response.status === 429 || response.status >= 500;
  throw new TelegramSendError(
    response.status,
    `Telegram sendMessage failed: ${response.status} ${(payload?.description ?? raw).slice(0, 240)}`,
    retryable,
    typeof retryAfter === "number" && Number.isFinite(retryAfter)
      ? Math.max(1, Math.ceil(retryAfter))
      : undefined,
  );
}
