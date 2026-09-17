import type { BotekTaskState } from "./tasks";
import type { TelegramInlineKeyboardMarkup } from "./types";

export type LegionStatusView = { plain: string; richHtml: string };

type LegionVitals = {
  hostname?: unknown;
  uptimeSeconds?: unknown;
  freeMemBytes?: unknown;
  totalMemBytes?: unknown;
  activeSessions?: unknown;
  activeProcesses?: unknown;
};

function escapeRichHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`].filter(Boolean).join(" ");
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`;
}

/** Shown for any non-terminal status (queued/leased/running/cancel_requested) - deliberately
 *  doesn't guess whether Legion is asleep. There's no wait/poll before this renders (see
 *  resolveLegionStatus's doc: blocking the single-concurrency Telegram queue consumer to find
 *  out would stall the whole bot), so "still queued" here says nothing about whether Legion is
 *  actually reachable - only a refresh a few seconds later can tell. */
export const LEGION_STATUS_PENDING_TEXT =
  "Zapytanie wysłane do Legiona - odśwież za chwilę, żeby zobaczyć wynik.";

export function legionStatusView(task: BotekTaskState): LegionStatusView {
  if (task.status !== "completed" || !task.result?.data) {
    const reason = task.status === "failed" || task.status === "recovery_required"
      ? (task.result?.error ?? "Zadanie zakończyło się błędem.")
      : task.status === "cancelled"
        ? "Zapytanie anulowane."
        : LEGION_STATUS_PENDING_TEXT;
    return {
      plain: `Legion: ${reason}`,
      richHtml: `<p>Legion: ${escapeRichHtml(reason)}</p>`,
    };
  }

  const data = task.result.data as LegionVitals;
  const rows: [string, string][] = [
    ["Host", typeof data.hostname === "string" ? data.hostname : "?"],
    ["Uptime", typeof data.uptimeSeconds === "number" ? formatUptime(data.uptimeSeconds) : "?"],
    [
      "RAM wolne/całość",
      typeof data.freeMemBytes === "number" && typeof data.totalMemBytes === "number"
        ? `${formatBytes(data.freeMemBytes)} / ${formatBytes(data.totalMemBytes)}`
        : "?",
    ],
    ["Aktywne sesje", typeof data.activeSessions === "number" ? String(data.activeSessions) : "?"],
    ["Aktywne procesy", typeof data.activeProcesses === "number" ? String(data.activeProcesses) : "?"],
  ];

  const plain = ["Legion: ✅ online", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const bodyRows = rows
    .map(([label, value]) => `<tr><td>${escapeRichHtml(label)}</td><td>${escapeRichHtml(value)}</td></tr>`)
    .join("");
  const richHtml = ["<h2>Legion</h2>", `<table>${bodyRows}</table>`].join("");
  return { plain, richHtml };
}

const LEGION_TASK_ID_RE = /^[0-9a-f-]{36}$/iu;

export function legionStatusKeyboard(taskId: string): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "🔄 Odśwież", style: "primary", callback_data: `legion:refresh:${taskId}` }]] };
}

export function legionRefreshCallback(data: string | undefined): string | null {
  const match = data?.match(/^legion:refresh:([0-9a-f-]{36})$/iu);
  return match && LEGION_TASK_ID_RE.test(match[1]) ? match[1] : null;
}
