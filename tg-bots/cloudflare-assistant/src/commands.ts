export type BotekCommand = {
  command: string;
  usage: string;
  description: string;
};

export const BOTEK_COMMANDS: readonly BotekCommand[] = [
  { command: "start", usage: "/start", description: "Uruchom Botka i pokaż pomoc" },
  { command: "help", usage: "/help", description: "Pokaż dostępne komendy" },
  { command: "status", usage: "/status", description: "Pokaż aktualny łańcuch modeli" },
  { command: "draft", usage: "/draft <tekst>", description: "Przygotuj odpowiedź bez wysyłania" },
  { command: "task", usage: "/task <repo> <polecenie>", description: "Wyślij zadanie na Legiona" },
  { command: "poll", usage: "/poll pytanie | opcja 1 | opcja 2", description: "Wyślij natywną ankietę" },
  { command: "dice", usage: "/dice [🎲|🎯|🏀|⚽|🎳|🎰]", description: "Rzuć natywną kostką Telegrama" },
  { command: "sticker", usage: "/sticker", description: "Odeślij sticker z wiadomości, na którą odpowiadasz" },
  { command: "location", usage: "/location szerokość,długość", description: "Wyślij pinezkę na mapie" },
  { command: "venue", usage: "/venue lat,lon | nazwa | adres", description: "Wyślij natywne miejsce" },
  { command: "contact", usage: "/contact telefon | imię | nazwisko", description: "Wyślij natywny kontakt" },
  { command: "reset", usage: "/reset", description: "Wyczyść krótki kontekst rozmowy" },
];

export function botCommandPayload() {
  return BOTEK_COMMANDS.map(({ command, description }) => ({ command, description }));
}

export function botHelpLines(): string[] {
  return BOTEK_COMMANDS.map(({ usage, description }) => `${usage} - ${description}`);
}

export type BotekPollRequest = { question: string; options: string[] };
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
