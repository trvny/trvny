export type InlineMode = "ask" | "summarize" | "translate" | "explain" | "reply" | "code";

export type InlineModeRequest = {
  mode: InlineMode;
  prompt: string;
};

const PREFIXES: ReadonlyArray<{ mode: Exclude<InlineMode, "ask">; aliases: readonly string[] }> = [
  { mode: "summarize", aliases: ["streść", "streszcz", "sum", "summarize", "summarise"] },
  { mode: "translate", aliases: ["tłumacz", "przetłumacz", "translate"] },
  { mode: "explain", aliases: ["wyjaśnij", "explain"] },
  { mode: "reply", aliases: ["odpisz", "reply"] },
  { mode: "code", aliases: ["kod", "code"] },
];

export function parseInlineMode(rawQuery: string): InlineModeRequest {
  const query = rawQuery.trim();
  const colon = query.indexOf(":");
  if (colon <= 0) return { mode: "ask", prompt: query };

  const prefix = query.slice(0, colon).trim().toLowerCase();
  for (const candidate of PREFIXES) {
    if (candidate.aliases.includes(prefix)) {
      return { mode: candidate.mode, prompt: query.slice(colon + 1).trim() };
    }
  }
  return { mode: "ask", prompt: query };
}

export function inlineModeLabel(mode: InlineMode): string {
  switch (mode) {
    case "summarize": return "Streszczenie";
    case "translate": return "Tłumaczenie";
    case "explain": return "Wyjaśnienie";
    case "reply": return "Propozycja odpowiedzi";
    case "code": return "Kod";
    default: return "Odpowiedź";
  }
}

export function inlineModeInstruction(mode: InlineMode): string {
  switch (mode) {
    case "summarize":
      return "Summarize only the supplied text. Preserve important facts, numbers and caveats; do not invent missing context.";
    case "translate":
      return "Translate the supplied text faithfully. Follow an explicit target language if present; otherwise translate between Polish and English based on the source language.";
    case "explain":
      return "Explain the supplied topic clearly and compactly, prioritizing the details needed to understand it.";
    case "reply":
      return "Draft a concise natural reply to the supplied message. Return only the reply text, without commentary about the drafting process.";
    case "code":
      return "Return the smallest directly usable code answer for the supplied programming task. Prefer one fenced code block when code is sufficient; add only brief essential notes when needed. Do not invent APIs or claim execution you did not perform.";
    default:
      return "Answer the supplied query directly and concisely.";
  }
}
