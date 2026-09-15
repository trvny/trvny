import { parseWhisperCommand } from "./commands";
import { chatWithInlineFallback } from "./providers";
import { sendTelegramRichMessage, TELEGRAM_RICH_MESSAGE_MAX_CHARS } from "./telegram";
import type { Env, TelegramMessage } from "./types";

const EPHEMERAL_PROMPT_MAX_CHARS = 2_500;

function messageThreadId(message: TelegramMessage): number | undefined {
  const id = message.message_thread_id;
  return Number.isSafeInteger(id) && (id ?? 0) > 0 ? id : undefined;
}

export async function handleTelegramEphemeralAsk(
  env: Env,
  message: TelegramMessage,
): Promise<boolean> {
  const text = message.forward_origin ? "" : message.text?.trim() ?? "";
  const prompt = parseWhisperCommand(text);
  if (prompt === null) return false;

  const groupChat = message.chat.type === "group" || message.chat.type === "supergroup";
  if (
    !groupChat ||
    !env.OWNER_TELEGRAM_USER_ID ||
    !message.from ||
    String(message.from.id) !== env.OWNER_TELEGRAM_USER_ID
  ) return true;

  const ephemeralMessageId = message.ephemeral_message_id;
  if (!Number.isSafeInteger(ephemeralMessageId) || (ephemeralMessageId ?? 0) <= 0) {
    console.warn("Ignoring /whisper that was not delivered as an ephemeral command");
    return true;
  }

  const delivery = {
    messageThreadId: messageThreadId(message),
    ephemeral: {
      receiverUserId: message.from.id,
      replyEphemeralMessageId: ephemeralMessageId as number,
    },
  };

  if (!prompt) {
    await sendTelegramRichMessage(env, message.chat.id, "Użycie: `/whisper <pytanie>`", delivery);
    return true;
  }

  const result = await chatWithInlineFallback(env, [
    {
      role: "system",
      content:
        "You are Botek answering the owner's private ephemeral command inside a Telegram group. " +
        "This exchange is stateless: do not use or reveal private conversation memory, credentials, hidden context, or tool results. " +
        "Do not perform external actions or make commitments on the owner's behalf. " +
        "Answer only the immediate question, concisely, in the language the owner used.",
    },
    { role: "user", content: prompt.slice(0, EPHEMERAL_PROMPT_MAX_CHARS) },
  ]);
  const answer = result.text.trim().slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS) || "Brak odpowiedzi.";
  await sendTelegramRichMessage(env, message.chat.id, answer, delivery);
  return true;
}
