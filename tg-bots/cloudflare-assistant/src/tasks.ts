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
    commit?: string;
    exportedRef?: string;
    error?: string;
  };
};

export type BotekTaskControlRequest = {
  action: "status" | "cancel";
  taskId: string;
};

const TASK_ID_RE = /^[0-9a-f-]{36}$/iu;
const TERMINAL = new Set(["completed", "failed", "cancelled", "recovery_required"]);

function rpcBody<T>(result: { status: number; body: unknown }): T {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Pet Dispatcher RPC failed: HTTP ${result.status}`);
  }
  return result.body as T;
}

function dispatcher(env: Env) {
  if (!env.PET_DISPATCHER) throw new Error("PET_DISPATCHER binding is not configured");
  return env.PET_DISPATCHER;
}

function parseTaskState(value: unknown): BotekTaskState {
  if (!value || typeof value !== "object") throw new Error("Pet Dispatcher returned invalid task state");
  const raw = value as Record<string, unknown>;
  if (typeof raw.taskId !== "string" || !TASK_ID_RE.test(raw.taskId) || typeof raw.status !== "string") {
    throw new Error("Pet Dispatcher returned invalid task state");
  }
  return value as BotekTaskState;
}
export function parseTaskCommand(text: string): { repo: string; goal: string } | null {
  if (!text.startsWith("/task ")) return null;
  const rest = text.slice("/task ".length).trim();
  const separator = rest.indexOf(" ");
  if (separator <= 0) return null;
  const repo = rest.slice(0, separator);
  const goal = rest.slice(separator + 1).trim();
  if (!/^[A-Za-z0-9._/-]{1,128}$/u.test(repo) || !goal) return null;
  return { repo, goal: goal.slice(0, 20_000) };
}

export function parseTaskControlCommand(text: string): BotekTaskControlRequest | null {
  const match = text.trim().match(/^\/task_(status|cancel)\s+([0-9a-f-]{36})$/iu);
  if (!match || !TASK_ID_RE.test(match[2])) return null;
  return {
    action: match[1].toLowerCase() as BotekTaskControlRequest["action"],
    taskId: match[2].toLowerCase(),
  };
}

export async function delegateBotekTask(
  env: Env,
  repo: string,
  goal: string,
  updateId: number,
): Promise<BotekTaskState> {
  const result = await dispatcher(env).delegate({
    repo,
    baseRef: "main",
    goal,
    executor: "openrouter",
    profile: "code",
    capabilities: [],
    network: { mode: "none" },
    timeoutMinutes: 20,
  }, `telegram-update:${updateId}`);
  const body = rpcBody<{ taskId?: unknown; status?: unknown }>(result);
  if (typeof body.taskId !== "string" || !TASK_ID_RE.test(body.taskId)) {
    throw new Error("Pet Dispatcher returned an invalid task id");
  }
  return { taskId: body.taskId, status: typeof body.status === "string" ? body.status : "queued" };
}
export async function getBotekTask(env: Env, taskId: string): Promise<BotekTaskState> {
  if (!TASK_ID_RE.test(taskId)) throw new Error("Invalid task id");
  return parseTaskState(rpcBody<unknown>(await dispatcher(env).getTask(taskId)));
}

export async function cancelBotekTask(env: Env, taskId: string): Promise<BotekTaskState> {
  if (!TASK_ID_RE.test(taskId)) throw new Error("Invalid task id");
  return parseTaskState(rpcBody<unknown>(await dispatcher(env).cancelTask(taskId)));
}

export function taskKeyboard(task: BotekTaskState): TelegramInlineKeyboardMarkup {
  const refresh = { text: "🔄 Status", style: "primary", callback_data: `task:refresh:${task.taskId}` } as const;
  if (TERMINAL.has(task.status) || task.status === "cancel_requested") return { inline_keyboard: [[refresh]] };
  return {
    inline_keyboard: [[
      refresh,
      { text: "🛑 Anuluj", style: "danger", callback_data: `task:cancel:${task.taskId}` },
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
  if (task.result?.commit) lines.push(`Commit: ${task.result.commit}`);
  if (task.result?.exportedRef) lines.push(`Ref: ${task.result.exportedRef}`);
  if (task.result?.error) lines.push("", `Błąd: ${task.result.error.slice(0, 900)}`);
  return lines.join("\n").slice(0, 4_000);
}

export function taskCallback(data: string | undefined): { action: "refresh" | "cancel"; taskId: string } | null {
  const match = data?.match(/^task:(refresh|cancel):([0-9a-f-]{36})$/iu);
  if (!match || !match[1] || !match[2]) return null;
  return { action: match[1] as "refresh" | "cancel", taskId: match[2] };
}
