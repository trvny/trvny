import { getBotekTask, isTerminalTaskStatus, taskView, type BotekTaskState } from "./tasks";
import {
  finishTaskWatch,
  pendingTaskWatches,
  releaseTaskWatch,
  reserveTaskWatch,
  type TaskWatch,
} from "./task-watch";
import { sendTelegramRichHtml, TelegramSendError } from "./telegram";
import type { Env } from "./types";

export function taskNotificationView(
  watch: Pick<TaskWatch, "repo" | "goal">,
  task: BotekTaskState,
): { plain: string; richHtml: string } {
  const view = taskView(task, watch.repo, watch.goal);
  return {
    plain: `🔔 Legion zakończył zadanie.\n\n${view.plain}`.slice(0, 4_000),
    richHtml: `<p><b>🔔 Legion zakończył zadanie.</b></p>${view.richHtml}`,
  };
}

type NotificationSender = (
  env: Env,
  chatId: string | number,
  richHtml: string,
  fallbackText: string,
  options?: { messageThreadId?: number; replyToMessageId?: number },
) => Promise<void>;

export async function processTaskNotifications(
  env: Env,
  send: NotificationSender = sendTelegramRichHtml,
): Promise<void> {
  if (!env.PET_DISPATCHER) return;

  let watches: TaskWatch[];
  try {
    watches = await pendingTaskWatches(env);
  } catch (error) {
    console.error("Task notification watch read failed", error);
    return;
  }

  for (const watch of watches) {
    let task: BotekTaskState;
    try {
      task = await getBotekTask(env, watch.taskId);
    } catch (error) {
      console.warn("Task notification status lookup failed", watch.taskId, error);
      continue;
    }
    if (!isTerminalTaskStatus(task.status)) continue;

    let reserved: TaskWatch | null;
    try {
      reserved = await reserveTaskWatch(env, watch.taskId);
    } catch (error) {
      console.error("Task notification reserve failed", watch.taskId, error);
      continue;
    }
    if (!reserved) continue;

    const view = taskNotificationView(reserved, task);
    try {
      await send(env, reserved.chatId, view.richHtml, view.plain, {
        messageThreadId: reserved.messageThreadId,
        replyToMessageId: reserved.replyToMessageId,
      });
    } catch (error) {
      if (error instanceof TelegramSendError && error.ambiguous) {
        await finishTaskWatch(env, reserved.taskId).catch((finishError) => {
          console.error("Ambiguous task notification finalization failed", finishError);
        });
      } else {
        await releaseTaskWatch(env, reserved.taskId).catch((releaseError) => {
          console.error("Task notification release failed", releaseError);
        });
      }
      continue;
    }

    await finishTaskWatch(env, reserved.taskId).catch((error) => {
      // Keep the watch in "notifying" if cleanup fails. That favors at-most-once
      // delivery over sending a duplicate completion message on the next cron tick.
      console.error("Task notification finalization failed", reserved.taskId, error);
    });
  }
}
