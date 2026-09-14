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
  { command: "reset", usage: "/reset", description: "Wyczyść krótki kontekst rozmowy" },
];

export function botCommandPayload() {
  return BOTEK_COMMANDS.map(({ command, description }) => ({ command, description }));
}

export function botHelpLines(): string[] {
  return BOTEK_COMMANDS.map(({ usage, description }) => `${usage} - ${description}`);
}
