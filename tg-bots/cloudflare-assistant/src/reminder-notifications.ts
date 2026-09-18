import {
  dueReminders,
  finishReminder,
  releaseReminder,
  reserveReminder,
  type Reminder,
} from "./reminders";
import { sendTelegramMessage, TelegramSendError } from "./telegram";
import type { Env } from "./types";

type ReminderSender = (
  env: Env,
  chatId: string | number,
  text: string,
  options?: { messageThreadId?: number; replyToMessageId?: number },
) => Promise<void>;

export function reminderNotificationText(reminder: Pick<Reminder, "text">): string {
  return `⏰ Przypomnienie\n\n${reminder.text}`.slice(0, 4_000);
}

export async function processDueReminders(
  env: Env,
  send: ReminderSender = sendTelegramMessage,
): Promise<void> {
  let due: Reminder[];
  try {
    due = await dueReminders(env);
  } catch (error) {
    console.error("Reminder due read failed", error);
    return;
  }

  for (const reminder of due) {
    let reserved: Reminder | null;
    try {
      reserved = await reserveReminder(env, reminder.id);
    } catch (error) {
      console.error("Reminder reserve failed", reminder.id, error);
      continue;
    }
    if (!reserved) continue;

    try {
      await send(env, reserved.chatId, reminderNotificationText(reserved), {
        messageThreadId: reserved.messageThreadId,
        replyToMessageId: reserved.replyToMessageId,
      });
    } catch (error) {
      if (error instanceof TelegramSendError && error.ambiguous) {
        await finishReminder(env, reserved.id).catch((finishError) => {
          console.error("Ambiguous reminder finalization failed", finishError);
        });
      } else {
        await releaseReminder(env, reserved.id).catch((releaseError) => {
          console.error("Reminder release failed", releaseError);
        });
      }
      continue;
    }

    await finishReminder(env, reserved.id).catch((error) => {
      console.error("Reminder finalization failed", reserved.id, error);
    });
  }
}
