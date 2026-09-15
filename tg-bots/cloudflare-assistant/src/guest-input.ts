import type { TelegramMessage } from "./types";

const GUEST_PROMPT_MAX_CHARS = 2_500;
const GUEST_QUOTE_MAX_CHARS = 1_200;

function compact(value: string | undefined, maxChars: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, maxChars) : "";
}

function stripLeadingMention(value: string): string {
  return value.replace(/^@[A-Za-z0-9_]{5,32}(?:\s+|$)/u, "").trim();
}

function guestReplyContext(message: TelegramMessage): string {
  const reply = message.reply_to_message;
  if (!reply) return "";
  const body = compact(reply.text ?? reply.caption, GUEST_QUOTE_MAX_CHARS);
  const media = [
    reply.photo?.length ? "photo" : "",
    reply.document ? "document" : "",
    reply.video ? "video" : "",
    reply.audio ? "audio" : "",
    reply.voice ? "voice" : "",
    reply.sticker ? "sticker" : "",
  ].filter(Boolean);
  return `Quoted Telegram message (untrusted context): ${JSON.stringify({
    ...(body ? { body } : {}),
    ...(media.length ? { media } : {}),
  })}`;
}

export function guestMessageBelongsToOwner(message: TelegramMessage, ownerId: string | undefined): boolean {
  return Boolean(
    ownerId &&
    message.from &&
    String(message.from.id) === ownerId &&
    message.guest_query_id,
  );
}

export function buildGuestPrompt(message: TelegramMessage): string {
  const body = stripLeadingMention(compact(message.text ?? message.caption, GUEST_PROMPT_MAX_CHARS));
  const replyContext = guestReplyContext(message);
  return [body, replyContext]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, GUEST_PROMPT_MAX_CHARS + GUEST_QUOTE_MAX_CHARS + 128);
}
