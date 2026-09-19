export type BotekCommand = {
  command: string;
  usage: string;
  description: string;
  private?: boolean;
  groupMode?: "visible" | "ephemeral";
};

export const BOTEK_COMMANDS: readonly BotekCommand[] = [
  { command: "start", usage: "/start", description: "Uruchom Botka" },
  { command: "help", usage: "/help", description: "Pokaż dostępne komendy" },
  { command: "ask", usage: "/ask <pytanie>", description: "Zapytaj Botka jawnie, także w grupie", groupMode: "visible" },
  { command: "whisper", usage: "/whisper <pytanie>", description: "Zapytaj prywatnie w grupie", private: false, groupMode: "ephemeral" },
  { command: "status", usage: "/status", description: "Pokaż aktualny łańcuch modeli" },
  { command: "legion", usage: "/legion", description: "Pokaż status Legiona przez Pet Dispatcher" },
  { command: "tasks", usage: "/tasks", description: "Pokaż ostatnie zadania Pet Dispatchera" },
  { command: "remind", usage: "/remind 15m | tekst", description: "Ustaw jednorazowe przypomnienie" },
  { command: "reminders", usage: "/reminders", description: "Pokaż aktywne przypomnienia" },
  { command: "remind_cancel", usage: "/remind_cancel <id>", description: "Anuluj przypomnienie po ID" },
  { command: "watch", usage: "/watch <źródło> ...", description: "Powiadom, gdy zajdzie warunek" },
  { command: "watches", usage: "/watches", description: "Pokaż aktywne watchery" },
  { command: "watch_cancel", usage: "/watch_cancel <id>", description: "Anuluj watcher po ID" },
  { command: "remember", usage: "/remember <tekst>", description: "Zapisz coś w pamięci długoterminowej" },
  { command: "recall", usage: "/recall <pytanie>", description: "Przeszukaj pamięć długoterminową" },
  { command: "memory_status", usage: "/memory_status", description: "Sprawdź stan pamięci Engram" },
  { command: "draft", usage: "/draft <tekst>", description: "Przygotuj odpowiedź bez wysyłania" },
  { command: "task", usage: "/task <repo> [--net <profil>] <polecenie>", description: "Wyślij zadanie na Legiona" },
  { command: "task_status", usage: "/task_status <id>", description: "Odzyskaj stan i wynik zadania Legiona" },
  { command: "task_cancel", usage: "/task_cancel <id>", description: "Anuluj zadanie Legiona po ID" },
  { command: "poll", usage: "/poll pytanie | opcja 1 | opcja 2", description: "Wyślij natywną ankietę" },
  { command: "quiz", usage: "/quiz pytanie | +poprawna | błędna", description: "Wyślij natywny quiz" },
  { command: "topic", usage: "/topic <nazwa>", description: "Utwórz prywatny temat" },
  { command: "dice", usage: "/dice [🎲|🎯|🏀|⚽|🎳|🎰]", description: "Rzuć natywną kostką Telegrama" },
  { command: "sticker", usage: "/sticker", description: "Odeślij sticker z wiadomości, na którą odpowiadasz" },
  { command: "location", usage: "/location szerokość,długość", description: "Wyślij pinezkę na mapie" },
  { command: "venue", usage: "/venue lat,lon | nazwa | adres", description: "Wyślij natywne miejsce" },
  { command: "contact", usage: "/contact telefon | imię | nazwisko", description: "Wyślij natywny kontakt" },
  { command: "reset", usage: "/reset", description: "Wyczyść krótki kontekst rozmowy" },
];

export function botCommandPayload() {
  return BOTEK_COMMANDS
    .filter((command) => command.private !== false)
    .map(({ command, description }) => ({ command, description }));
}

export function botGroupCommandPayload() {
  return BOTEK_COMMANDS
    .filter((command) => command.groupMode)
    .map(({ command, description, groupMode }) => ({
      command,
      description,
      ...(groupMode === "ephemeral" ? { is_ephemeral: true } : {}),
    }));
}

export function botHelpLines(): string[] {
  return BOTEK_COMMANDS
    .filter((command) => command.private !== false)
    .map(({ usage, description }) => `${usage} - ${description}`);
}

export function botStartLines(): string[] {
  return [
    "🤖 Botek online.",
    "Napisz wiadomość albo wyślij głosówkę, zdjęcie lub plik.",
    "",
    "Na szybko: /status · /legion · /tasks · /watch",
    "Wszystkie komendy i możliwości: /help",
    "Inline: @trvny_bot <pytanie>",
  ];
}


export type BotekWatchRequest =
  | { kind: "legion"; condition: "offline" | "online" }
  | {
      kind: "github";
      repository: string;
      number: number;
      condition: "ci-failed" | "ci-green" | "merged" | "closed";
    }
  | { kind: "feedseek"; query: string };

const WATCH_ID_RE = /^w[0-9a-z]{1,16}$/u;

export function parseWatchCommand(text: string): BotekWatchRequest | null {
  const trimmed = text.trim();
  const prefix = "/watch ";
  if (!trimmed.toLowerCase().startsWith(prefix)) return null;

  const payload = trimmed.slice(prefix.length).trim();
  const separator = payload.indexOf(" ");
  if (separator <= 0) return null;
  const source = payload.slice(0, separator).toLowerCase();
  const rest = payload.slice(separator + 1).trim();

  if (source === "legion") {
    const condition = rest.toLowerCase();
    return condition === "offline" || condition === "online"
      ? { kind: "legion", condition }
      : null;
  }

  if (source === "feedseek") {
    return rest && rest.length <= 500 ? { kind: "feedseek", query: rest } : null;
  }

  if (source !== "github") return null;
  const conditionSeparator = rest.lastIndexOf(" ");
  if (conditionSeparator <= 0) return null;
  const target = rest.slice(0, conditionSeparator).trim();
  const condition = rest.slice(conditionSeparator + 1).trim().toLowerCase();
  if (!["ci-failed", "ci-green", "merged", "closed"].includes(condition)) return null;

  const hash = target.lastIndexOf("#");
  if (hash <= 0 || hash === target.length - 1) return null;
  const repository = target.slice(0, hash);
  const numberText = target.slice(hash + 1);
  const [owner, name, extra] = repository.split("/");
  if (
    extra ||
    !name ||
    !["trvny", "travnie"].includes(owner?.toLowerCase() ?? "") ||
    name.length > 100 ||
    !/^[A-Za-z0-9_.-]+$/u.test(name) ||
    !/^\d{1,7}$/u.test(numberText)
  ) {
    return null;
  }

  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) return null;
  return {
    kind: "github",
    repository: `${owner}/${name}`,
    number,
    condition: condition as "ci-failed" | "ci-green" | "merged" | "closed",
  };
}

export function parseWatchCancelCommand(text: string): string | null {
  const match = text.trim().toLowerCase().match(/^\/watch_cancel\s+(w[0-9a-z]{1,16})$/u);
  return match && WATCH_ID_RE.test(match[1]) ? match[1] : null;
}

export type BotekReminderRequest = { delayMs: number; text: string };

const REMINDER_MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;
const REMINDER_ID_RE = /^r[0-9a-z]{1,16}$/u;

export function parseReminderCommand(text: string): BotekReminderRequest | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/remind ")) return null;
  const payload = trimmed.slice("/remind ".length);
  const separator = payload.indexOf("|");
  if (separator <= 0) return null;
  const duration = payload.slice(0, separator).trim();
  const reminderText = payload.slice(separator + 1).trim();
  const match = duration.match(/^(\d{1,5})(m|min|h|g|d)$/iu);
  if (!match || !reminderText || reminderText.length > 1_500) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "m" || unit === "min"
    ? 60_000
    : unit === "h" || unit === "g"
      ? 60 * 60_000
      : 24 * 60 * 60_000;
  const delayMs = amount * multiplier;
  if (!Number.isSafeInteger(delayMs) || delayMs < 60_000 || delayMs > REMINDER_MAX_DELAY_MS) return null;
  return { delayMs, text: reminderText };
}

export function parseReminderCancelCommand(text: string): string | null {
  const match = text.trim().toLowerCase().match(/^\/remind_cancel\s+(r[0-9a-z]{1,16})$/u);
  return match && REMINDER_ID_RE.test(match[1]) ? match[1] : null;
}

export function parseRememberCommand(text: string): string | null {
  if (!text.startsWith("/remember ")) return null;
  const value = text.slice("/remember ".length).trim();
  return value && value.length <= 2_000 ? value : null;
}

export function parseRecallCommand(text: string): string | null {
  if (!text.startsWith("/recall ")) return null;
  const value = text.slice("/recall ".length).trim();
  return value && value.length <= 2_000 ? value : null;
}

export function parseAskCommand(text: string): string | null {
  const trimmed = text.trim();
  const space = trimmed.indexOf(" ");
  const command = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  if (command !== "/ask" && !/^\/ask@[a-z0-9_]{5,32}$/u.test(command)) return null;
  return space < 0 ? "" : trimmed.slice(space + 1).trim();
}

export function parseAskMessageCommand(text?: string, caption?: string): string | null {
  const source = text?.trim() || caption?.trim() || "";
  return parseAskCommand(source);
}

export function parseWhisperCommand(text: string): string | null {
  const trimmed = text.trim();
  const space = trimmed.indexOf(" ");
  const command = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  if (command !== "/whisper" && !/^\/whisper@[a-z0-9_]{5,32}$/u.test(command)) return null;
  return space < 0 ? "" : trimmed.slice(space + 1).trim();
}

export type BotekPollRequest = { question: string; options: string[] };
export type BotekQuizRequest = BotekPollRequest & { correctOptionIds: number[] };
export const TELEGRAM_DICE_EMOJIS = ["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"] as const;
export type TelegramDiceEmoji = (typeof TELEGRAM_DICE_EMOJIS)[number];

export function parseDiceCommand(text: string): TelegramDiceEmoji | null {
  if (text === "/dice") return "🎲";
  if (!text.startsWith("/dice ")) return null;
  const emoji = text.slice("/dice ".length).trim();
  return (TELEGRAM_DICE_EMOJIS as readonly string[]).includes(emoji)
    ? emoji as TelegramDiceEmoji
    : null;
}

export function parsePollCommand(text: string): BotekPollRequest | null {
  if (!text.startsWith("/poll ")) return null;
  const [questionRaw, ...optionParts] = text.slice("/poll ".length).split("|");
  const question = questionRaw?.trim() ?? "";
  const options = optionParts.map((option) => option.trim()).filter(Boolean);
  if (!question || question.length > 300 || options.length < 2 || options.length > 12) return null;
  if (options.some((option) => option.length > 100)) return null;
  return { question, options };
}

export function parseTopicCommand(text: string): string | null {
  if (!text.startsWith("/topic ")) return null;
  const name = text.slice("/topic ".length).trim().replace(/\s+/gu, " ");
  return name && name.length <= 128 ? name : null;
}

export function parseQuizCommand(text: string): BotekQuizRequest | null {
  if (!text.startsWith("/quiz ")) return null;
  const [questionRaw, ...optionParts] = text.slice("/quiz ".length).split("|");
  const question = questionRaw?.trim() ?? "";
  const markedOptions = optionParts.map((option) => option.trim()).filter(Boolean);
  if (!question || question.length > 300 || markedOptions.length < 2 || markedOptions.length > 12) return null;

  const options: string[] = [];
  const correctOptionIds: number[] = [];
  for (const marked of markedOptions) {
    const escapedPlus = marked.startsWith("\\+");
    const correct = marked.startsWith("+");
    const option = (escapedPlus ? marked.slice(1) : correct ? marked.slice(1) : marked).trim();
    if (!option || option.length > 100) return null;
    if (correct) correctOptionIds.push(options.length);
    options.push(option);
  }
  if (!correctOptionIds.length) return null;
  return { question, options, correctOptionIds };
}

export type BotekLocationRequest = { latitude: number; longitude: number };
export type BotekVenueRequest = BotekLocationRequest & { title: string; address: string };
export type BotekContactRequest = { phoneNumber: string; firstName: string; lastName?: string };

function parseCoordinates(value: string): BotekLocationRequest | null {
  if (value.length > 80) return null;
  const parts = value.trim().replaceAll(",", " ").replaceAll(";", " ").split(" ").filter(Boolean);
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function parseLocationCommand(text: string): BotekLocationRequest | null {
  if (!text.startsWith("/location ")) return null;
  return parseCoordinates(text.slice("/location ".length));
}

export function parseVenueCommand(text: string): BotekVenueRequest | null {
  if (!text.startsWith("/venue ")) return null;
  const [coordinatesRaw, titleRaw, addressRaw, ...rest] = text.slice("/venue ".length).split("|");
  if (rest.length) return null;
  const coordinates = parseCoordinates(coordinatesRaw ?? "");
  const title = titleRaw?.trim() ?? "";
  const address = addressRaw?.trim() ?? "";
  if (!coordinates || !title || !address || title.length > 256 || address.length > 512) return null;
  return { ...coordinates, title, address };
}

export function parseContactCommand(text: string): BotekContactRequest | null {
  if (!text.startsWith("/contact ")) return null;
  const [phoneRaw, firstNameRaw, lastNameRaw, ...rest] = text.slice("/contact ".length).split("|");
  if (rest.length) return null;
  const phoneNumber = phoneRaw?.trim() ?? "";
  const firstName = firstNameRaw?.trim() ?? "";
  const lastName = lastNameRaw?.trim() || undefined;
  if (!phoneNumber || !firstName || phoneNumber.length > 64 || firstName.length > 128 || (lastName?.length ?? 0) > 128) return null;
  return { phoneNumber, firstName, ...(lastName ? { lastName } : {}) };
}
