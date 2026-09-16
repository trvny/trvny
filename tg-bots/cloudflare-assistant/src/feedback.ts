import type { TelegramCallbackQuery, TelegramInlineKeyboardMarkup } from "./types";

export type TelegramReplyFeedback = {
  messageId: number;
  messageThreadId?: number;
  rating: "up" | "down";
};

export function replyFeedbackKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "👍 Pomogło", style: "success", callback_data: "feedback:up" },
      { text: "👎 Słabo", style: "danger", callback_data: "feedback:down" },
    ]],
  };
}

export function replyFeedbackRequest(
  callback: TelegramCallbackQuery,
  ownerUserId: string | undefined,
): TelegramReplyFeedback | null {
  const message = callback.message;
  if (!ownerUserId || !message || message.chat.type !== "private") return null;
  if (String(callback.from.id) !== ownerUserId) return null;
  if (callback.data !== "feedback:up" && callback.data !== "feedback:down") return null;
  return {
    messageId: message.message_id,
    ...(message.message_thread_id === undefined ? {} : { messageThreadId: message.message_thread_id }),
    rating: callback.data === "feedback:up" ? "up" : "down",
  };
}
