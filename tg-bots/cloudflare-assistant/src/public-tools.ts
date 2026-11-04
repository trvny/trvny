import { BOTEK_COMMANDS, parseDiceCommand, type BotekCommand, type TelegramDiceEmoji } from "./commands.ts";
import type { TelegramMessage, TelegramReply } from "./types.ts";
import { toolDeckView } from "./capability-catalog.ts";

export type PublicAction =
  | { kind: "start" | "help" | "skill" }
  | { kind: "tools"; section: string }
  | { kind: "dice"; emoji: TelegramDiceEmoji | null }
  | { kind: "ping"; nonce: string | null };

const BOT_USERNAME = "trvny_bot";
const PUBLIC_ACTIONS = new Set(BOTEK_COMMANDS.filter((command) =>
  command.public === true
).map((command) => command.command));

// Explicit commands only. Unsolicited bot chatter and ordinary group text stay ignored.
export function parsePublicAction(message: TelegramMessage): PublicAction | null {
  if (!message.from || message.forward_origin || !message.text) return null;
  const privateChat = message.chat.type === "private";
  const groupChat = message.chat.type === "group" || message.chat.type === "supergroup";
  if (!privateChat && !groupChat) return null;

  const text = message.text.trim();
  const match = /^\/([a-z_]+)(?:@([a-z0-9_]{5,32}))?(?=\s|$)/iu.exec(text);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!PUBLIC_ACTIONS.has(command)) return null;
  if ((match[2] && match[2].toLowerCase() !== BOT_USERNAME) || (groupChat && !match[2])) return null;
  const payload = text.slice(match[0].length).trim();
  const normalized = `/${command}${payload ? ` ${payload}` : ""}`;
  switch (command) {
    case "start": return payload ? null : { kind: "start" };
    case "help": return payload ? null : { kind: "help" };
    case "skill": return payload ? null : { kind: "skill" };
    case "tools": return { kind: "tools", section: payload.toLowerCase().slice(0, 32) };
    case "ping": return {
      kind: "ping",
      nonce: !payload ? "" : /^[A-Za-z0-9_-]{1,32}$/u.test(payload) ? payload : null,
    };
    case "dice": return { kind: "dice", emoji: parseDiceCommand(normalized) };
    default: return null;
  }
}

export function publicCommands(): BotekCommand[] {
  return BOTEK_COMMANDS.filter((command) => command.public === true);
}

export function skillDocument(): string {
  return [
    "---",
    "name: botek-telegram-tools",
    "description: Discover and invoke Botek's public Telegram-native tools.",
    "---",
    "",
    "# Botek public skills",
    "",
    "Telegram bot: @trvny_bot. This document describes only public capabilities.",
    "Send commands in a private chat, or use /command@trvny_bot in a shared group.",
    "Bot-to-bot communication in private chats requires BotFather Bot-to-Bot Mode on both bots.",
    "Bot-to-bot group commands require Telegram delivery rules; do not assume a message was received.",
    "Round-trip test: /ping <nonce> in private chat, or /ping@trvny_bot <nonce> in a group.",
    "Expected: BOTEK/1 PONG <nonce>. Match the nonce and reply target; never automatically ping back.",
    "",
    "## Commands",
    "",
    ...publicCommands().map((command) => `- \`${command.usage}\`: ${command.description}`),
    "",
    "## Boundaries",
    "",
    "Send only explicit commands. Do not auto-reply to Botek replies or build bot loops.",
    "Requests are rate-limited, deduplicated by Telegram update ID, and may be silently dropped if excessive.",
    "Owner-only memory, private accounts, automation controls and machine tasks are unavailable to visitors and peer bots.",
    "No direct HTTP command-execution API is exposed by this document. Use Telegram's authenticated delivery.",
    "No command grants permissions to act for another user or bot.",
    "",
  ].join("\n");
}

export function skillManifest(): Record<string, unknown> {
  return {
    name: "botek-telegram-tools",
    bot: "@trvny_bot",
    version: 1,
    transport: "telegram",
    visibility: "public",
    commands: publicCommands().map(({ command, usage, description }) => ({ command, usage, description })),
    bot_to_bot: { private: "BotFather mode required on both peers", group: "explicit @trvny_bot commands" },
    handshake: { command: "/ping <nonce>", response: "BOTEK/1 PONG <nonce>", max_nonce_length: 32 },
    requires_owner_authorization: false,
  };
}

export function publicReply(message: TelegramMessage, action: PublicAction, skillUrl: string): TelegramReply {
  const base = { chatId: message.chat.id, replyToMessageId: message.message_id };
  if (action.kind === "tools") {
    const view = toolDeckView(action.section, "public");
    return { ...base, text: view.plain, richHtml: view.richHtml, replyMarkup: view.keyboard };
  }
  if (action.kind === "ping") {
    return {
      ...base,
      text: action.nonce === null
        ? "Użycie: /ping [nonce: 1-32 znaków A-Z a-z 0-9 _ -]"
        : `BOTEK/1 PONG${action.nonce ? ` ${action.nonce}` : ""}`,
    };
  }
  if (action.kind === "dice") {
    return action.emoji
      ? { ...base, text: "🎲", dice: { emoji: action.emoji } }
      : { ...base, text: "Użycie: /dice [🎲|🎯|🏀|⚽|🎳|🎰]" };
  }
  if (action.kind === "skill") {
    return { ...base, text: `🤖 Publiczny skill Botka: ${skillUrl}\nNarzędzia: /tools` };
  }
  if (action.kind === "start") {
    return { ...base, text: "🤖 Botek do usług!\n/tools · publiczne narzędzia\n/skill · instrukcja dla innych botów\n/help · komendy\n\nPrywatne operacje wymagają osobnych uprawnień." };
  }
  return {
    ...base,
    text: ["🤖 Publiczne komendy Botka:", "", ...publicCommands().map((command) =>
      `${command.usage} · ${command.description}`
    )].join("\n"),
  };
}

export function skillUrlFromEnv(webhookUrl?: string): string {
  try {
    if (webhookUrl) {
      const url = new URL(webhookUrl);
      if (url.protocol === "https:") return `${url.origin}/botek/skill.md`;
    }
  } catch { /* Invalid configuration: fixed canonical origin below. */ }
  return "https://tg-assistant.travny.workers.dev/botek/skill.md";
}
