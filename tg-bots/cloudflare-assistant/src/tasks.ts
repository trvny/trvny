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
    data?: unknown;
  };
};

export type BotekTaskControlRequest = {
  action: "status" | "cancel";
  taskId: string;
};

export type BotekTaskView = {
  plain: string;
  richHtml: string;
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

function escapeRichHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function richLines(value: string, maxChars: number): string {
  return escapeRichHtml(value.slice(0, maxChars)).replaceAll("\n", "<br>");
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

/** Placeholder repo name for direct tools that don't touch a workspace (e.g. system.status) -
 *  remoteTaskSchema always requires a repo string, but this tool never dereferences it. */
const LEGION_STATUS_REPO = "legion";

export async function delegateLegionStatus(env: Env, updateId: number): Promise<BotekTaskState> {
  const result = await dispatcher(env).delegate({
    repo: LEGION_STATUS_REPO,
    baseRef: "main",
    executor: "direct",
    direct: { tool: "system.status" },
    profile: "inspect",
    capabilities: ["workspace.read", "git.read"],
    network: { mode: "none" },
    timeoutMinutes: 2,
  }, `telegram-legion-status:${updateId}`);
  const body = rpcBody<{ taskId?: unknown; status?: unknown }>(result);
  if (typeof body.taskId !== "string" || !TASK_ID_RE.test(body.taskId)) {
    throw new Error("Pet Dispatcher returned an invalid task id");
  }
  return { taskId: body.taskId, status: typeof body.status === "string" ? body.status : "queued" };
}

/** Never waits/polls - the Telegram update queue consumer is max_concurrency: 1 and processes a
 *  batch of messages sequentially (wrangler.jsonc), so blocking inside a handler stalls the whole
 *  bot for every other chat, not just this one caller. Legion's remote worker also backs its
 *  Queue pull interval off up to pollMaxIntervalMs (60s default, src/config.ts) when idle, so even
 *  a bounded wait would routinely time out during ordinary steady-state idle - there's no wait
 *  budget that's both safe for the consumer and long enough to usually see a real answer. Instead,
 *  same pattern as /task: return immediately, let legion:refresh (a separate, cheap consumer
 *  invocation per tap) check again.
 *
 *  `initial` never carries a result (delegate()'s response is bare {taskId,status}), except that
 *  an idempotent redelivery hitting an already-terminal task also returns just {taskId,status}
 *  with no result attached (control-plane/entry.ts's enqueueTask early-return) - so a terminal
 *  status here still needs exactly one follow-up fetch to show real data instead of a blank
 *  "completed" view. That's the only case this makes an extra call; the common "just submitted,
 *  still queued" case returns immediately with zero extra RPCs. */
export async function resolveLegionStatus(env: Env, initial: BotekTaskState): Promise<BotekTaskState> {
  if (!TERMINAL.has(initial.status) || initial.result) return initial;
  return getBotekTask(env, initial.taskId);
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

export function taskView(task: BotekTaskState, repo?: string, goal?: string): BotekTaskView {
  const plainLines = [
    `Legion: ${taskStatusLabel(task.status)}`,
    `Task: ${task.taskId}`,
    ...(repo ? [`Repo: ${repo}`] : []),
    ...(task.deviceId ? [`Device: ${task.deviceId}`] : []),
    ...(task.updatedAt ? [`Updated: ${task.updatedAt}`] : []),
    ...(task.heartbeatAt ? [`Heartbeat: ${task.heartbeatAt}`] : []),
    ...(goal ? ["", goal.slice(0, 700)] : []),
  ];
  if (task.result?.summary) plainLines.push("", task.result.summary.slice(0, 2_000));
  if (task.result?.commit) plainLines.push(`Commit: ${task.result.commit}`);
  if (task.result?.exportedRef) plainLines.push(`Ref: ${task.result.exportedRef}`);
  if (task.result?.output) plainLines.push("", `Output: ${task.result.output.slice(0, 1_200)}`);
  if (task.result?.error) plainLines.push("", `Błąd: ${task.result.error.slice(0, 900)}`);

  const rows = [
    ["Status", taskStatusLabel(task.status)],
    ["Task", task.taskId],
    ...(repo ? [["Repo", repo]] : []),
    ...(task.deviceId ? [["Device", task.deviceId]] : []),
    ...(task.updatedAt ? [["Updated", task.updatedAt]] : []),
    ...(task.heartbeatAt ? [["Heartbeat", task.heartbeatAt]] : []),
  ].map(([label, value]) => `<tr><td>${escapeRichHtml(label)}</td><td>${escapeRichHtml(value)}</td></tr>`).join("");

  const result = task.result;
  const richHtml = [
    "<h2>Legion task</h2>",
    `<table>${rows}</table>`,
    ...(goal ? [`<details><summary>Goal</summary><p>${richLines(goal, 1_200)}</p></details>`] : []),
    ...(result?.summary ? [`<h3>Result</h3><p>${richLines(result.summary, 4_000)}</p>`] : []),
    ...(result?.commit ? [`<p><b>Commit:</b> <code>${escapeRichHtml(result.commit.slice(0, 200))}</code></p>`] : []),
    ...(result?.exportedRef ? [`<p><b>Ref:</b> <code>${escapeRichHtml(result.exportedRef.slice(0, 500))}</code></p>`] : []),
    ...(result?.output ? [`<details><summary>Output</summary><p>${richLines(result.output, 6_000)}</p></details>`] : []),
    ...(result?.error ? [`<details><summary>Error</summary><p>${richLines(result.error, 2_000)}</p></details>`] : []),
  ].join("");

  return { plain: plainLines.join("\n").slice(0, 4_000), richHtml };
}

export function taskText(task: BotekTaskState, repo?: string, goal?: string): string {
  return taskView(task, repo, goal).plain;
}

export function taskCallback(data: string | undefined): { action: "refresh" | "cancel"; taskId: string } | null {
  const match = data?.match(/^task:(refresh|cancel):([0-9a-f-]{36})$/iu);
  if (!match || !match[1] || !match[2]) return null;
  return { action: match[1] as "refresh" | "cancel", taskId: match[2] };
}
