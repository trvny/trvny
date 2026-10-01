import type { Env } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
const HEAL_INTERVAL_MINUTES = 10;

export type WebhookHealDeps = {
  fetcher: typeof fetch;
  setWebhook: (env: Env, url: string) => Promise<void>;
  setMenu: (env: Env, chatId: number, miniAppUrl: string) => Promise<void>;
};

// A Worker rename (or any URL move) leaves Telegram posting to a dead URL, and
// the /start self-sync can't run because no update reaches the Worker. The cron
// re-points the webhook, and the owner's Mini App button, to the configured URL.
export async function healTelegramWebhook(
  env: Env,
  scheduledTime: number,
  deps: WebhookHealDeps,
): Promise<"skipped" | "ok" | "healed"> {
  const expected = env.TELEGRAM_WEBHOOK_URL?.trim();
  if (!expected || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return "skipped";
  if (new Date(scheduledTime).getUTCMinutes() % HEAL_INTERVAL_MINUTES !== 0) return "skipped";

  const response = await deps.fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  if (!response.ok) throw new Error(`Telegram getWebhookInfo failed: HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: { url?: unknown } };
  if (payload.result?.url === expected) return "ok";

  await deps.setWebhook(env, expected);
  const owner = env.OWNER_TELEGRAM_USER_ID;
  if (owner && /^\d+$/.test(owner)) {
    await deps.setMenu(env, Number(owner), new URL("/mini-app", expected).href);
  }
  console.warn("Telegram webhook re-pointed", { url: expected });
  return "healed";
}
