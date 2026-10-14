import type { BotekTaskState } from "./tasks";
import type { TelegramInlineKeyboardMarkup } from "./types";

/** `/wake` controls the Legion's wakeguard (keeps it from idle-hibernating) through Pet Dispatcher's host tool
 *  `system.wakeguard`. Remote guards always expire; the cap matches the tool's schema (12 h). */
export const WAKE_MAX_MINUTES = 720;
export const WAKE_DEFAULT_MINUTES = 120;

export type WakeRequest =
  | { action: "status" }
  | { action: "off" }
  | { action: "on"; minutes: number };

export const WAKE_USAGE = [
  "/wake - czy Legion jest trzymany w gotowości",
  "/wake 3h | /wake 90m | /wake 45 - trzymaj go wybudzonego (max 12h)",
  "/wake off - zdejmij blokadę",
].join("\n");

/** Returns null for anything that is not a valid `/wake` form, so the caller can show the usage. */
export function parseWakeCommand(text: string): WakeRequest | null {
  const match = /^\/wake(?:@\w+)?(?:\s+(.+))?$/iu.exec(text.trim());
  if (!match) return null;
  const arg = match[1]?.trim().toLowerCase();
  if (!arg || arg === "status") return { action: "status" };
  if (arg === "off") return { action: "off" };
  if (arg === "on") return { action: "on", minutes: WAKE_DEFAULT_MINUTES };
  const duration = /^(\d{1,4})\s*([mh]?)$/u.exec(arg);
  if (!duration) return null;
  const minutes = Number(duration[1]) * (duration[2] === "h" ? 60 : 1);
  return minutes >= 1 && minutes <= WAKE_MAX_MINUTES ? { action: "on", minutes } : null;
}

type WakeState = {
  running?: unknown;
  until?: unknown;
  heartbeatAgeSeconds?: unknown;
  guards?: unknown;
};

export type WakeView = { plain: string; richHtml: string };

function escapeRichHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function warsawTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });
}

function wakePendingText(status: BotekTaskState["status"]): string {
  if (status === "leased") return "📥 Legion odebrał polecenie; wynik za moment.";
  if (status === "running") return "🦾 wykonuje; sprawdź wynik za moment.";
  if (status === "cancel_requested") return "🛑 trwa anulowanie.";
  return "🕓 czeka w kolejce. Legion sprawdza kolejkę maks. co ~60 s; sprawdź wynik za minutę.";
}

export function wakeView(task: BotekTaskState): WakeView {
  const done = task.status === "completed" && task.result?.data !== undefined;
  let line: string;
  if (done) {
    const data = task.result?.data as WakeState;
    if (data.running === true) {
      const until = typeof data.until === "string" ? `do ${warsawTime(data.until)}` : "bez limitu";
      const heartbeat = typeof data.heartbeatAgeSeconds === "number" ? `, puls ${data.heartbeatAgeSeconds}s temu` : "";
      line = `✅ Legion trzymany w gotowości ${until}${heartbeat}.`;
    } else {
      line = "💤 Wakeguard wyłączony - Legion może zahibernować po bezczynności.";
    }
  } else if (task.status === "failed" || task.status === "recovery_required") {
    line = `⚠️ ${task.result?.error ?? "Zadanie zakończyło się błędem."}`;
  } else if (task.status === "cancelled") {
    line = "Anulowane.";
  } else {
    line = wakePendingText(task.status);
  }
  return { plain: `Wakeguard: ${line}`, richHtml: `<p>Wakeguard: ${escapeRichHtml(line)}</p>` };
}

const WAKE_TASK_ID_RE = /^[0-9a-f-]{36}$/iu;

export function wakeKeyboard(taskId: string): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "🔄 Sprawdź wynik", style: "primary", callback_data: `wake:refresh:${taskId}` }]] };
}

export function wakeRefreshCallback(data: string | undefined): string | null {
  const match = data?.match(/^wake:refresh:([0-9a-f-]{36})$/iu);
  return match && WAKE_TASK_ID_RE.test(match[1]) ? match[1] : null;
}
