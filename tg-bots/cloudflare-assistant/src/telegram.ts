import type { Env, TelegramUpdate } from "./types";

const TELEGRAM_API = "https://api.telegram.org";

export function isTelegramWebhook(request: Request, env: Env): boolean {
  return (
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") ===
    env.TELEGRAM_WEBHOOK_SECRET
  );
}

export async function parseTelegramUpdate(request: Request): Promise<TelegramUpdate> {
  return (await request.json()) as TelegramUpdate;
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string | number,
  text: string,
): Promise<void> {
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
    throw new Error(`Telegram sendMessage failed: ${response.status} ${await response.text()}`);
  }
}
