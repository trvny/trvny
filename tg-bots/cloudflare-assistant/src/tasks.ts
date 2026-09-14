import type { Env, TelegramInlineKeyboardMarkup } from "./types";

export type BotekTaskState = {
  taskId: string;
  deviceId?: string;
  status: string;
  updatedAt?: string;
  heartbeatAt?: string;
  result?: {
    status?: string;
    summary?: string;
    output?: string;
    error?: string;
  };
};

const TASK_ID_RE = /^[0-9a-f-]{36}$/iu;
const TERMINAL = new Set(["completed", "failed", "cancelled", "recovery_required"]);

function rpcBody<T>(result: { status: number; body: unknown }): T {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Pet Dispatcher RPC failed: HTTP ${result.status}`);
  }
  return result.body as T;
}
export function parseTaskCommand(text: string): { repo: string; goal: string } | null {
  const match = text.match(/^\/task\s+(\S+)\s+([\s\S]+)$/u);
  if (!match) return null;
  const repo = match[1]?.trim() ?? "";
  const goal = match[2]?.trim() ?? "";
  if (!/^[A-Za-z0-9._/-]{1,128}$/u.test(repo) || !goal) return null;
  return { repo, goal: goal.slice(0, 20_000) };
}

export async function delegateBotekTask(env: Env, repo: string, goal: string): Promise<BotekTaskState> {
  const result = await env.PET_DISPATCHER.delegate({
    repo,
    baseRef: "main",
    goal,
    executor: "openrouter",
    profile: "code",
    capabilities: [],
    network: { mode: "none" },
    timeoutMinutes: 20,
  });
  const body = rpcBody<{ taskId?: unknown; status?: unknown }>(result);
  if (typeof body.taskId !== "string" || !TASK_ID_RE.test(body.taskId)) {
    throw new Error("Pet Dispatcher returned an invalid task id");
  }
  return { taskId: body.taskId, status: typeof body.status === "string" ? body.status : "queued" };
}
export async function getBotekTask(env: Env, taskId: string): Promise<BotekTaskState> {
  if (!TASK_ID_RE.test(taskId)) throw new Error("Invalid task id");
  return rpcBody<BotekTaskState>(await env.PET_DISPATCHER.getTask(taskId));
}

export async function cancelBotekTask(env: Env, taskId: string): Promise<BotekTaskState> {
  if (!TASK_ID_RE.test(taskId)) throw new Error("Invalid task id");
  return rpcBody<BotekTaskState>(await env.PET_DISPATCHER.cancelTask(taskId));
}

export function taskKeyboard(task: BotekTaskState): TelegramInlineKeyboardMarkup {
  const refresh = { text: "🔄 Status", callback_data: `task:refresh:${task.taskId}` } as const;
  if (TERMINAL.has(task.status) || task.status === "cancel_requested") return { inline_keyboard: [[refresh]] };
  return {
    inline_keyboard: [[
      refresh,
      { text: "🛑 Anuluj", callback_data: `task:cancel:${task.taskId}` },
    ]],
  };
}

function taskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "🕓 queued",
    running: "🦾 running",
    cancel_requested: "🛑 cancel requested",
    completed: "✅ completed",
    failed: "❌ failed",
    cancelled: "🛑 cancelled",
    recovery_required: "⚠️ recovery required",
  };
  return labels[status] ?? `ℹ️ ${status}`;
}

export function taskText(task: BotekTaskState, repo?: string, goal?: string): string {
  const lines = [
    `Legion: ${taskStatusLabel(task.status)}`,
    `Task: ${task.taskId}`,
    ...(repo ? [`Repo: ${repo}`] : []),
    ...(goal ? ["", goal.slice(0, 700)] : []),
  ];
  if (task.result?.summary) lines.push("", task.result.summary.slice(0, 2_000));
  if (task.result?.error) lines.push("", `Błąd: ${task.result.error.slice(0, 900)}`);
  return lines.join("\n").slice(0, 4_000);
}

export function taskCallback(data: string | undefined): { action: "refresh" | "cancel"; taskId: string } | null {
  const match = data?.match(/^task:(refresh|cancel):([0-9a-f-]{36})$/iu);
  if (!match || !match[1] || !match[2]) return null;
  return { action: match[1] as "refresh" | "cancel", taskId: match[2] };
}
