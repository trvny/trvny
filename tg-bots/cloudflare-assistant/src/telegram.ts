import { readJsonWithLimit } from "./http";
import type { Env, TelegramUpdate } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_UPDATE_MAX_BYTES = 256 * 1024;

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

export async function sendTelegramMessage(
  env: Env,
  chatId: string | number,
  text: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new TelegramSendError(
      response.status,
      `Telegram sendMessage failed: ${response.status} ${await response.text()}`,
    );
  }
}
