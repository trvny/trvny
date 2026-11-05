import { BOTEK_COMMANDS, type BotekCommand } from "./commands.ts";
import type { TelegramInlineKeyboardMarkup } from "./types.ts";

export type BotekCapability = {
  id: string;
  title: string;
  icon: string;
  description: string;
  executor: "botek" | "specialist" | "dispatcher";
  surfaces: readonly ("chat" | "inline" | "mini-app")[];
  commands: readonly string[];
};

// Descriptive map only. Command handlers and API boundaries still own authorization.
export const BOTEK_CAPABILITIES: readonly BotekCapability[] = [
  { id: "conversation", title: "Rozmowa i szkice", icon: "💬", description: "Pytaj, twórz szkice i zarządzaj kontekstem rozmowy.", executor: "botek", surfaces: ["chat", "inline"], commands: ["ask", "whisper", "draft", "reset"] },
  { id: "fun", title: "Żarty i przygaduszki", icon: "🎭", description: "Wylosuj gotowy żart bez kosztu generowania.", executor: "botek", surfaces: ["chat"], commands: ["quip", "meme"] },
  { id: "news", title: "Feedseek News", icon: "📡", description: "Recent headlines with dates and source links, without an AI guess.", executor: "botek", surfaces: ["chat"], commands: ["news"] },
  { id: "media", title: "Radio", icon: "📻", description: "Live radio and now-playing details in Telegram.", executor: "botek", surfaces: ["chat", "mini-app"], commands: ["radio"] },
  { id: "documents", title: "Draft Studio", icon: "📄", description: "Create, export and send Markdown or text documents privately.", executor: "botek", surfaces: ["chat", "mini-app"], commands: ["doc"] },
  { id: "telegram", title: "Narzędzia Telegrama", icon: "🎛️", description: "Ankiety, quizy, tematy, stickery, lokalizacje, miejsca, kontakty i kostki.", executor: "botek", surfaces: ["chat"], commands: ["poll", "quiz", "topic", "dice", "sticker", "location", "venue", "contact"] },
  { id: "automations", title: "Przypomnienia i obserwatory", icon: "⏰", description: "Ustawiaj przypomnienia oraz obserwuj Legiona, GitHub i Feedseek.", executor: "botek", surfaces: ["chat", "mini-app"], commands: ["remind", "reminders", "remind_cancel", "watch", "watches", "watch_cancel"] },
  { id: "memory", title: "Pamięć długoterminowa", icon: "🧠", description: "Zapisuj i wyszukuj wspomnienia przez istniejącą usługę.", executor: "specialist", surfaces: ["chat"], commands: ["remember", "recall", "memory_status"] },
  { id: "machine", title: "Operacje na urządzeniach", icon: "🛠️", description: "Sprawdzaj urządzenia i deleguj zadania przez Pet Dispatcher.", executor: "dispatcher", surfaces: ["chat", "mini-app"], commands: ["legion", "wake", "tasks", "task", "task_status", "task_cancel"] },
  { id: "control", title: "Sterowanie i diagnostyka", icon: "🩺", description: "Sprawdzaj status Botka oraz dostępne polecenia.", executor: "botek", surfaces: ["chat"], commands: ["start", "help", "tools", "skill", "ping", "status"] },
];

const commandIndex = new Map(BOTEK_COMMANDS.map((command) => [command.command, command]));

export function capabilityById(id: string): BotekCapability | undefined {
  return BOTEK_CAPABILITIES.find((capability) => capability.id === id);
}

export function capabilityCommands(capability: BotekCapability): BotekCommand[] {
  return capability.commands.map((name) => {
    const command = commandIndex.get(name);
    if (!command) throw new Error(`Unregistered Botek command: ${name}`);
    return command;
  });
}

export function toolDeckSelection(data: unknown, audience: "owner" | "public" = "owner"): string | undefined {
  if (data === "tools:list") return "";
  if (typeof data !== "string" || !data.startsWith("tools:open:")) return undefined;
  const id = data.slice("tools:open:".length);
  return capabilityById(id) && (audience === "owner" || publicCapabilityIds().includes(id)) ? id : undefined;
}

const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export type ToolDeckView = { plain: string; richHtml: string; keyboard: TelegramInlineKeyboardMarkup };

export function publicCapabilityIds(): string[] {
  return BOTEK_CAPABILITIES.filter((capability) =>
    capabilityCommands(capability).some((command) => command.public === true)
  ).map((capability) => capability.id);
}

export function toolDeckView(id = "", audience: "owner" | "public" = "owner"): ToolDeckView {
  const visible = BOTEK_CAPABILITIES.filter((capability) =>
    audience === "owner" || publicCapabilityIds().includes(capability.id)
  );
  if (!id) {
    const buttons = visible.map((capability) => ({
      text: `${capability.icon} ${capability.title}`,
      callback_data: `tools:open:${capability.id}`,
    }));
    const rows: typeof buttons[] = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    return {
      plain: ["🧰 Narzędzia Botka", "", ...visible.map((c) => `${c.icon} ${c.title} · /tools ${c.id}`), "", "Pokazuję tylko istniejące funkcje. /help zawiera wszystkie komendy."].join("\n"),
      richHtml: ["🧰 <b>Narzędzia Botka</b>", "", ...visible.map((c) => `${c.icon} <b>${escaped(c.title)}</b> · <code>/tools ${c.id}</code>`), "", "<i>Pokazuję tylko istniejące funkcje. /help zawiera wszystkie komendy.</i>"].join("\n"),
      keyboard: { inline_keyboard: rows },
    };
  }
  const back: TelegramInlineKeyboardMarkup = { inline_keyboard: [[{ text: "⬅️ Wszystkie narzędzia", callback_data: "tools:list" }]] };
  const capability = visible.find((entry) => entry.id === id);
  if (!capability) {
    return { plain: "Nieznane narzędzie. Użyj /tools, aby zobaczyć możliwości.", richHtml: "Nieznane narzędzie. Użyj <code>/tools</code>, aby zobaczyć możliwości.", keyboard: back };
  }
  const executor = { botek: "Botek / Telegram", specialist: "Istniejąca usługa", dispatcher: "Pet Dispatcher" }[capability.executor];
  const commands = capabilityCommands(capability).filter((command) => audience === "owner" || command.public === true);
  return {
    plain: [
      `${capability.icon} ${capability.title}`, capability.description, "",
      `Wykonawca: ${executor}`, `Interfejsy: ${capability.surfaces.join(", ")}`, "",
      ...commands.map((command) => `${command.usage} · ${command.description}`), "",
      "Lista nie nadaje uprawnień. Usługi zewnętrzne mogą być niedostępne.",
    ].join("\n"),
    richHtml: [
      `${capability.icon} <b>${escaped(capability.title)}</b>`, escaped(capability.description), "",
      `<b>Wykonawca:</b> ${escaped(executor)}`, `<b>Interfejsy:</b> ${escaped(capability.surfaces.join(", "))}`, "",
      ...commands.map((command) => `<code>${escaped(command.usage)}</code> · ${escaped(command.description)}`), "",
      "<i>Lista nie nadaje uprawnień. Usługi zewnętrzne mogą być niedostępne.</i>",
    ].join("\n"),
    keyboard: back,
  };
}
