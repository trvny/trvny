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
  { command: "reset", usage: "/reset", description: "Wyczyść krótki kontekst rozmowy" },
];

export function botCommandPayload() {
  return BOTEK_COMMANDS.map(({ command, description }) => ({ command, description }));
}

export function botHelpLines(): string[] {
  return BOTEK_COMMANDS.map(({ usage, description }) => `${usage} - ${description}`);
}

export type BotekPollRequest = { question: string; options: string[] };

export function parsePollCommand(text: string): BotekPollRequest | null {
  if (!text.startsWith("/poll ")) return null;
  const [questionRaw, ...optionParts] = text.slice("/poll ".length).split("|");
  const question = questionRaw?.trim() ?? "";
  const options = optionParts.map((option) => option.trim()).filter(Boolean);
  if (!question || question.length > 300 || options.length < 2 || options.length > 12) return null;
  if (options.some((option) => option.length > 100)) return null;
  return { question, options };
}
